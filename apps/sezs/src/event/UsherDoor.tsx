import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { fetchLeaves } from '../pay/invoice'
import { fromHex, toHex } from '../ticket'
import { eventTagMatches, parseGuestQr } from '../ticket/v2/guest-qr.mjs'
import { doorAuthPubkeyString } from '../ticket/v2/door-auth.mjs'
import { createProver, loadTicketV2 } from '../ticket/v2/index.mjs'
import { encodeAuthMessage, proofHash, DEFAULT_TTL_SEC } from '../ticket/v2/usher-auth.mjs'
import { encodeConsumeDevice } from '../ble/messages.mjs'
import { useBleFrames } from '../ble/useBleFrames'
import { eventOrigin } from './api'
import { fetchDoorV2Config, prepareConsumeV3, submitConsumeV3, type DoorV2Config } from './door-v3'
import { zafuExecute } from '../chain/zafuExecute'
import { useEvent } from './useEvent'

type Stage = 'scan' | 'proving' | 'authorize' | 'done'

type ZafuSigner = {
  enable: (chainId: string) => Promise<void>
  getKey: (chainId: string) => Promise<{ bech32Address?: string; pubKey?: Uint8Array }>
  signArbitrary?: (
    chainId: string,
    signer: string,
    data: string | Uint8Array,
  ) => Promise<{ signature: string; pub_key: { type?: string; value?: string } }>
  signAmino?: (chainId: string, signer: string, signDoc: unknown) => Promise<{ signature: { signature?: string; pub_key?: { value?: string } } }>
  signDirect?: (chainId: string, signer: string, signDoc: unknown) => Promise<unknown>
}

const zafuOf = (): ZafuSigner | null => {
  if (typeof window === 'undefined') return null
  const z = (window as unknown as { zafu?: ZafuSigner }).zafu
  return z && typeof z.enable === 'function' && typeof z.getKey === 'function' ? z : null
}

const scanFile = async (file: File) => {
  const text = await file.text().catch(() => '')
  if (text && /sezs3|sezs1:\/\/ticket/.test(text)) return text.trim()
  if (!('BarcodeDetector' in window)) return ''
  const bmp = await createImageBitmap(file)
  const Detector = (
    window as unknown as {
      BarcodeDetector: new (opts: { formats: string[] }) => { detect: (s: ImageBitmap) => Promise<{ rawValue?: string }[]> }
    }
  ).BarcodeDetector
  const det = new Detector({ formats: ['qr_code'] })
  const codes = await det.detect(bmp)
  return codes[0]?.rawValue || ''
}

export const UsherDoor = () => {
  const ev = useEvent()
  const { session } = useAuth()
  const [v2, setV2] = useState<DoorV2Config | null>(null)
  const [stage, setStage] = useState<Stage>('scan')
  const [note, setNote] = useState('Scan the guest’s ticket. The proof is built on this device.')
  const [admitted, setAdmitted] = useState(false)
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proveMs, setProveMs] = useState<number | null>(null)
  const [payload, setPayload] = useState<{ consume: any; authText: string; usher: string; expiresAt: number; ble?: { frameText: string; frameSig: string; grantHash: string } } | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanTimer = useRef<number | null>(null)
  const domain = eventOrigin(ev.data?.event)
  const eventId = ev.data?.event.id || 'speakez-sessions'
  const doorAuth = ev.data?.event.doorAuthPubkey || ev.data?.consume?.doorAuthPubkey || ''
  const usherAddr = String(session?.wallet?.address || v2?.usher || '')
  const bleRef = useRef<{ frameText: string; frameSig: string; grantHash: string } | null>(null)

  useEffect(() => {
    let live = true
    fetchDoorV2Config()
      .then((c) => {
        if (live) setV2(c)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const reset = () => {
    setStage('scan')
    setAdmitted(false)
    setRefused(false)
    setProveMs(null)
    setPayload(null)
    setNote('Scan the guest’s ticket. The proof is built on this device.')
  }

  const refusedNote = (err?: string) => {
    const s = err || ''
    if (/nullifier already spent|already admitted|replay/i.test(s)) return 'Already admitted.'
    if (/unknown or historical root|not on the guest list|unknown root/i.test(s)) return 'Not on the guest list.'
    if (/Admitted/i.test(s)) return s
    return s && /^(Already admitted|Not on the guest list|Please try again|Admitted)\b/.test(s)
      ? s
      : (s ? 'Please try again.' : 'Please try again.')
  }

  const onPayload = async (raw: string, ble?: { frameText: string; frameSig: string; grantHash?: string }) => {
    const parsed = parseGuestQr(raw)
    if (!parsed.ok) {
      setNote('That code is not a ticket.')
      return
    }
    if (parsed.eventTag && !parsed.eventId && !eventTagMatches(eventId, parsed.eventTag)) {
      setNote('This ticket is for a different event.')
      return
    }
    if (parsed.eventId && parsed.eventId !== eventId) {
      setNote('This ticket is for a different event.')
      return
    }
    const sku = parsed.sku
    const secret = parsed.secret
    if (ble?.frameText && ble?.frameSig) bleRef.current = { frameText: ble.frameText, frameSig: ble.frameSig, grantHash: ble.grantHash || '' }
    else bleRef.current = null
    setBusy(true)
    setStage('proving')
    setNote('Fetching the guest list and building the door proof on this device…')
    const prover = createProver()
    try {
      const leaves = await fetchLeaves()
      if (!leaves.ok || !leaves.leaves?.length) {
        setStage('scan')
        setNote('No published guest-list leaves yet.')
        return
      }
      const t0 = performance.now()
      const p = await prover.prove({ secret, sku, eventId, domain, leaves: leaves.leaves })
      const ms = Number(p.ms || Math.round(performance.now() - t0))
      setProveMs(ms)
      const circuit = p.bundle as Uint8Array
      const t = await loadTicketV2()
      const N = t.nullifier(secret, eventId)
      const f = t.consumeFields(circuit) as { proof: string; root: string; nullifier: string; rk_x: string; rk_y: string }
      const printedSig = doorAuth
        ? t.signPrinted({
            secret,
            eventId,
            domain,
            alphaNonce: p.alphaNonce,
            nullifier: N,
            doorAuthPubkey: doorAuthPubkeyString(doorAuth),
          })
        : null
      if (!printedSig) {
        setStage('scan')
        setNote('This event has no door authorization key yet, so a consume cannot be built.')
        return
      }
      const consume = {
        proof: f.proof,
        root: f.root,
        nullifier: f.nullifier,
        event_id: ev.data?.consume?.eventIdFp,
        domain: ev.data?.consume?.domainFp,
        rk_x: f.rk_x,
        rk_y: f.rk_y,
        consent: { printed: { sig: btoa(String.fromCharCode(...(printedSig as Uint8Array))) } },
        eventId,
        proofHash: proofHash(circuit),
      }
      const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC
      const usher = usherAddr || v2?.usher || ''
      const bleEnv = bleRef.current
      let text
      if (bleEnv?.frameText && bleEnv?.frameSig) {
        const { decodeFrame } = await import('../ble/messages.mjs')
        const frame = decodeFrame(bleEnv.frameText)
        const dev = encodeConsumeDevice({
          usher: usher || 'terp1pendingusherauthorization00000000000',
          eventId,
          nullifier: f.nullifier,
          root: f.root,
          proofHash: consume.proofHash,
          expiry: expiresAt,
          grantHash: bleEnv.grantHash || frame.grantHash,
          frameHash: frame.hash,
          frameSig: bleEnv.frameSig,
          frameSeq: frame.seq,
        })
        text = dev.text
        bleEnv.grantHash = bleEnv.grantHash || frame.grantHash
      } else {
        text = encodeAuthMessage({
          usher: usher || 'terp1pendingusherauthorization00000000000',
          eventId,
          nullifier: f.nullifier,
          root: f.root,
          proofHash: consume.proofHash,
          expiry: expiresAt,
        }).text
      }
      setPayload({ consume, authText: text, usher, expiresAt, ble: bleEnv || undefined })
      setStage('authorize')
      setNote(`Proof ready in ${ms} ms. Authorize this consume with Zafu.`)
    } catch (e) {
      setStage('scan')
      setNote(e instanceof Error ? e.message : 'The proof could not be built.')
    } finally {
      prover.terminate()
      setBusy(false)
    }
  }

  const authorize = async () => {
    if (!payload) return
    setBusy(true)
    try {
      const zafu = zafuOf()
      if (!zafu || !v2?.chainId) {
        setAdmitted(false)
        setRefused(true)
        setStage('done')
        setNote('Zafu is required to authorize this consume.')
        return
      }
      await zafu.enable(v2.chainId)
      const key = await zafu.getKey(v2.chainId)
      const signer = key.bech32Address || payload.usher
      const prepared = await prepareConsumeV3({ ...payload.consume, usher: signer, eventId, proofHash: payload.consume.proofHash, ...(payload.ble || {}) })
      const authText = prepared.authText || payload.authText
      if (!zafu.signArbitrary || !authText) {
        setAdmitted(false)
        setRefused(true)
        setStage('done')
        setNote('Zafu could not sign this consume.')
        return
      }
      const signed = await zafu.signArbitrary(v2.chainId, signer, authText)
      const auth: any = {
        typ: 'zafu-adr36',
        signature: signed?.signature || '',
        pubKey: signed?.pub_key || { type: 'tendermint/PubKeySecp256k1', value: '' },
        signer,
        message: authText,
        expiresAt: payload.expiresAt,
      }
      const contract = v2.contract
      if (!contract) {
        setAdmitted(false)
        setRefused(true)
        setStage('done')
        setNote('The event contract is not configured.')
        return
      }
      const c = payload.consume
      const exec = await zafuExecute(contract, {
        consume_ticket: {
          proof: String(c.proof).length === 8384 ? c.proof : c.proof,
          root: c.root,
          nullifier: c.nullifier,
          event_id: c.event_id,
          domain: c.domain,
          rk_x: c.rk_x,
          rk_y: c.rk_y,
          consent: c.consent,
        },
      })
      const data = await submitConsumeV3({ consume: payload.consume, auth, signedTx: exec.signedTx, ...(payload.ble || {}) })
      setStage('done')
      if (!data.ok) {
        setAdmitted(false)
        setRefused(true)
        setNote(refusedNote(data.error))
        return
      }
      setAdmitted(true)
      setRefused(false)
      setNote(data.message || 'Admitted on chain. A second scan will be refused.')
    } catch (e) {
      setStage('done')
      setAdmitted(false)
      setRefused(true)
      setNote(e instanceof Error ? e.message : 'The door did not answer.')
    } finally {
      setBusy(false)
    }
  }


  useBleFrames(stage === 'scan', (raw, envelope) => {
    void onPayload(raw, envelope)
  })

  const startCamera = async () => {
    if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
      setNote('This device has no camera. Use the scan button to take a photo of the ticket.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      if (!('BarcodeDetector' in window)) return
      const Detector = (
        window as unknown as {
          BarcodeDetector: new (opts: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue?: string }[]> }
        }
      ).BarcodeDetector
      const det = new Detector({ formats: ['qr_code'] })
      const tick = async () => {
        if (!videoRef.current) return
        try {
          const codes = await det.detect(videoRef.current)
          if (codes[0]?.rawValue) {
            stopCamera()
            await onPayload(codes[0].rawValue)
            return
          }
        } catch {
          /* keep scanning */
        }
        scanTimer.current = window.setTimeout(tick, 250)
      }
      tick()
    } catch {
      setNote('The camera could not be opened. Use the scan button instead.')
    }
  }

  const stopCamera = () => {
    if (scanTimer.current) window.clearTimeout(scanTimer.current)
    scanTimer.current = null
    const el = videoRef.current
    const stream = el?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    if (el) el.srcObject = null
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div className={'card usher-door checkin-mobile' + (admitted ? ' is-admitted' : '') + (refused ? ' is-refused' : '')}>
      <strong>Door</strong>
      {stage === 'scan' || stage === 'done' ? (
        <>
          <video ref={videoRef} className="usher-cam" playsInline muted />
          <div className="cta-row">
            <button className="pix-btn" type="button" disabled={busy} onClick={() => void startCamera()}>
              Open camera
            </button>
            <label className="pix-btn ghost scan-label">
              Scan a ticket photo
              <input
                type="file"
                accept="image/*,text/plain"
                capture="environment"
                aria-label="Scan guest ticket QR"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void scanFile(f).then((v) => (v ? onPayload(v) : setNote('The QR could not be read from that image.')))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </>
      ) : null}
      {stage === 'proving' ? <p className="muted">Building the door proof…</p> : null}
      {stage === 'authorize' && payload ? (
        <p className="halo-act">
          <button className="pix-btn" type="button" disabled={busy} onClick={() => void authorize()} data-usher-authorize>
            Authorize with Zafu
          </button>
        </p>
      ) : null}
      {proveMs != null ? <p className="muted">Proved in {proveMs} ms on this device.</p> : null}
      {stage === 'done' ? (
        <button className="pix-btn ghost" type="button" onClick={reset}>
          Next guest
        </button>
      ) : null}
      <p className={'door-note' + (admitted ? ' is-ok' : '') + (refused ? ' is-no' : '')} data-door-note>
        {note}
      </p>
    </div>
  )
}
