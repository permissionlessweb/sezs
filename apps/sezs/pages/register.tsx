import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'

import { Frame } from '../src/ui/Frame'
import { Movement } from '../src/ui/primitives'
import { addressFromQrText, getConnectedAddresses, randomizeConnectedAddresses } from '../src/frost/zafu-addresses.mjs'
import { looksShieldedZec, looksUmBech32 } from '../src/pay/bech32.mjs'

const RegisterPage = () => {
  const router = useRouter()
  const initialKey = typeof router.query.c === 'string' ? router.query.c : ''
  const [keyValue, setKeyValue] = useState(initialKey)
  const [displayName, setDisplayName] = useState('')
  const [zec, setZec] = useState('')
  const [um, setUm] = useState('')
  const [note, setNote] = useState('Enter the one-time key you were given, plus the addresses you want to be paid at.')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (initialKey) setKeyValue(initialKey)
  }, [initialKey])

  useEffect(() => {
    void (async () => {
      const found = await getConnectedAddresses()
      if (!found.ok) return
      setConnected(true)
      if (found.zec) setZec((cur) => cur || found.zec)
      if (found.um) setUm((cur) => cur || found.um)
      if (found.zec || found.um) {
        setNote('Addresses filled from the connected Zafu. You can randomize a fresh diversified address, or scan one from a Zigner.')
      }
    })()
  }, [])

  const umOk = useMemo(() => !um || looksUmBech32(um), [um])
  const zecOk = useMemo(() => !zec || looksShieldedZec(zec), [zec])

  const onRandomize = async () => {
    const next = await randomizeConnectedAddresses()
    if (!next.ok) {
      setNote(next.error === 'zafu_not_connected'
        ? 'Connect Zafu first to pick a fresh diversified address.'
        : 'This wallet does not expose a diversify helper yet.')
      return
    }
    if (next.zec) setZec(next.zec)
    if (next.um) setUm(next.um)
    setNote('Using a fresh diversified address from Zafu.')
  }

  const applyQr = (text: string) => {
    const parsed = addressFromQrText(text)
    if (!parsed.ok) {
      setNote('That QR did not contain a UM (penumbra1…) or shielded ZEC address.')
      return
    }
    if (parsed.kind === 'um') setUm(parsed.address)
    if (parsed.kind === 'zec') setZec(parsed.address)
    setNote(parsed.kind === 'um' ? 'UM address filled from the Zigner QR.' : 'ZEC address filled from the QR.')
  }

  const onScanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const Detector = (globalThis as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector
      if (Detector) {
        const bmp = await createImageBitmap(file)
        const codes = await new Detector({ formats: ['qr_code'] }).detect(bmp)
        const text = codes.map((c) => c.rawValue || '').find(Boolean)
        if (text) {
          applyQr(text)
          return
        }
      }
      setNote('Could not read a QR from that image. Paste the address if you can see it on the Zigner.')
    } catch {
      setNote('QR scan failed. Paste the address from the Zigner if needed.')
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setNote('Submitting…')
    try {
      const res = await fetch('/sezs/payroll/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ registrationKey: keyValue, displayName, zec, um }),
      })
      const data = await res.json()
      if (!data.ok) {
        const errors: Record<string, string> = {
          key_consumed: 'That key was already used. Ask the coordinator for a new one.',
          bad_zec: 'Enter a shielded or unified ZEC address.',
          bad_um: 'Enter a UM address as a valid penumbra1… bech32 string.',
          unknown_key: 'That key is not recognised.',
          bad_key: 'That key looks wrong. Check the link or QR you were sent.',
        }
        setNote(errors[data.error] || 'Registration was refused.')
        return
      }
      setNote(`Registered as ${data.participant.displayName || 'participant'}. Keep a copy of the addresses you submitted.`)
      setKeyValue('')
    } catch {
      setNote('The event backend could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title="Register to take part">
      <div className="register-stage">
        <div className="register-veil" aria-hidden="true" />
        <div className="register-card">
      <Movement n={1} title="Registration" lede="One-time key, payout addresses, and the name we should show." align="left">
        <form className="stack-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="stack">
            One-time registration key
            <input className="field" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} autoComplete="off" spellCheck={false} name="registrationKey" />
          </label>
          <label className="stack">
            Name or act
            <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} name="displayName" />
          </label>
          <label className="stack">
            ZEC unified or shielded address
            <input className="field" value={zec} onChange={(e) => setZec(e.target.value)} spellCheck={false} name="zec" aria-invalid={zec && !zecOk ? true : undefined} />
          </label>
          <label className="stack">
            UM address (penumbra1…)
            <input className="field" value={um} onChange={(e) => setUm(e.target.value)} spellCheck={false} name="um" aria-invalid={um && !umOk ? true : undefined} />
          </label>
          {um && !umOk ? <p className="honest">That UM address is not valid penumbra1… bech32.</p> : null}
          <div className="row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="pix-btn ghost" type="button" onClick={() => void onRandomize()} disabled={!connected && typeof (globalThis as { zafu?: unknown }).zafu === 'undefined'}>
              Randomize diversified address
            </button>
            <button className="pix-btn ghost" type="button" onClick={() => fileRef.current?.click()}>
              Scan a Zigner QR
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label="Scan a Zigner QR"
              onChange={(e) => void onScanFile(e)}
            />
          </div>
          <button className="pix-btn" type="submit" disabled={busy || !keyValue || !zec || !um || !umOk || !zecOk}>Register</button>
          <p className="honest">{note}</p>
        </form>
      </Movement>
        </div>
      </div>
    </Frame>
  )
}

export default RegisterPage
