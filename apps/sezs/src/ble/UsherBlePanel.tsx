import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { encodeGrant, newDeviceKey, newNonce, hex, parseUsherPayload } from './messages.mjs'
import { useEvent } from '../event/useEvent'
import {
  registerGrant,
  renameDevice,
  revokeDevice,
  shortPub,
  formatSeen,
  listRoles,
  type DeviceRecord,
  type EventRoles,
} from './api'
import { zafuExecute, updateMembersMsg } from '../chain/zafuExecute'
import { useBle } from './BleContext'
import { TRANSPORTS } from './transport.mjs'
import { webBluetoothAvailable } from './web-bluetooth.mjs'
import { QrCapture } from './QrCapture'

const CAP_LABEL: Record<string, string> = { 'scan-ticket': 'scan tickets' }

const zafuOf = () =>
  (window as unknown as { zafu?: { enable: Function; getKey: Function; signArbitrary?: Function } }).zafu

const chainOf = (ev: unknown) => {
  const data = (ev as { data?: { event?: { chainId?: string }; chainId?: string } | null } | undefined)?.data
  return data?.event?.chainId || data?.chainId || ''
}

const roleId = (u: { terp?: string }) => u.terp || ''

export const UsherBlePanel = () => {
  const { session } = useAuth()
  const ev = useEvent()
  const { devices, refresh, transportId, setTransportId } = useBle()
  const [roles, setRoles] = useState<EventRoles | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [paste, setPaste] = useState('')
  const eventId = ev.data?.event.id || 'speakez-sessions'
  const shot = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bleShot') === '1'
  const visible: DeviceRecord[] = shot && devices.length === 0 ? shotDevices(eventId) : devices.filter((d) => d.status !== 'revoked')
  const selectedDevice = visible.find((d) => d.hash === selected) || null
  const ushers = roles?.ushers || []

  const loadRoles = async () => {
    const r = await listRoles()
    if (r.ok) setRoles(r)
  }

  useEffect(() => { void refresh(); void loadRoles() }, [refresh])

  const signAsCoordinator = async (text: string) => {
    const zafu = zafuOf()
    const chainId = chainOf(ev)
    if (!zafu?.signArbitrary) throw new Error('Zafu is not available.')
    await zafu.enable(chainId)
    const key = await zafu.getKey(chainId)
    const admin = key.bech32Address || key.address
    const signed = await zafu.signArbitrary(chainId, admin, text)
    return { admin, signed: { typ: 'zafu-adr36', signature: signed.signature, pub_key: signed.pub_key, signer: admin } }
  }

  const onAuthorize = async (raw?: string) => {
    const src = String(raw || paste).trim()
    const parsed = parseUsherPayload(src)
    if (!parsed.ok) {
      setNote(parsed.error || 'That key could not be read.')
      return
    }
    const usher = parsed.terp || parsed.usher
    const group = roles?.usherGroup
    if (!group) {
      setNote('The usher group is not on this event yet.')
      return
    }
    setBusy(true)
    setNote('')
    try {
      const exec = await zafuExecute(group, updateMembersMsg([usher]))
      setPaste('')
      setNote(exec.txhash ? `Usher added. ${exec.txhash.slice(0, 8)}…` : 'Usher added.')
      await loadRoles()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Authorization failed.')
    } finally {
      setBusy(false)
    }
  }


  const onRemoveUsher = async (usher: string) => {
    if (!usher) return
    const group = roles?.usherGroup
    if (!group) {
      setNote('The usher group is not on this event yet.')
      return
    }
    setBusy(true)
    setNote('')
    try {
      const exec = await zafuExecute(group, updateMembersMsg([], [usher]))
      setNote(exec.txhash ? `Usher removed. ${exec.txhash.slice(0, 8)}…` : 'Usher removed.')
      await loadRoles()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  const pairSimulated = async () => {
    setBusy(true)
    setNote('')
    try {
      const device = newDeviceKey()
      const noise = hex(crypto.getRandomValues(new Uint8Array(32)))
      const usher = ushers[0]?.terp || String(session?.wallet?.address || '')
      if (!usher) {
        setNote('Register an usher first.')
        setBusy(false)
        return
      }
      const grant = encodeGrant({
        deviceSignPubkey: device.publicHex,
        deviceNoiseStatic: noise,
        usher,
        eventId,
        expiry: Math.floor(Date.now() / 1000) + 12 * 3600,
        nonce: newNonce(),
      })
      const { admin, signed } = await signAsCoordinator(grant.text)
      const r = await registerGrant({ grantText: grant.text, adminSig: signed, admin, label: 'simulated phone' })
      if (!r.ok) setNote(String(r.error || 'The grant was refused.'))
      else await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Pairing failed.')
    } finally {
      setBusy(false)
    }
  }

  const onRename = async () => {
    if (!selectedDevice || !label.trim()) return
    setBusy(true)
    const r = await renameDevice(selectedDevice.hash, label.trim())
    setBusy(false)
    setEditing(false)
    if (!r.ok) setNote(String(r.error || 'Rename failed.'))
    await refresh()
  }

  const onRevoke = async () => {
    if (!selectedDevice) return
    setBusy(true)
    const r = await revokeDevice(selectedDevice.hash)
    setBusy(false)
    if (!r.ok) setNote(String(r.error || 'Revoke failed.'))
    else setSelected(null)
    await refresh()
  }

  const groups = useMemo(() => groupByUsher(visible), [visible])

  return (
    <div className="ble-panel">
      <div className="ble-toolbar">
        <div className="ble-segment" role="radiogroup" aria-label="Transport">
          <button type="button" role="radio" aria-checked={transportId === TRANSPORTS.loopbackHelper} className={transportId === TRANSPORTS.loopbackHelper ? 'is-on' : ''} onClick={() => setTransportId(TRANSPORTS.loopbackHelper)}>Loopback</button>
          <button type="button" role="radio" aria-checked={transportId === TRANSPORTS.simulated} className={transportId === TRANSPORTS.simulated ? 'is-on' : ''} onClick={() => setTransportId(TRANSPORTS.simulated)}>Simulated</button>
          <button type="button" role="radio" aria-checked={transportId === TRANSPORTS.webBluetooth} className={transportId === TRANSPORTS.webBluetooth ? 'is-on' : ''} onClick={() => setTransportId(TRANSPORTS.webBluetooth)} disabled={!webBluetoothAvailable()}>Web Bluetooth</button>
        </div>
      </div>

      <section className="ble-onboard" aria-label="Ushers">
        <div className="ble-onboard-row">
          <input
            className="field"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Usher key"
            spellCheck={false}
            aria-label="Usher key"
          />
          <QrCapture onRead={(v) => { setPaste(v); void onAuthorize(v) }} label="Scan key" />
          <button type="button" className="pix-btn" disabled={busy || !paste.trim()} onClick={() => void onAuthorize()}>
            Authorize
          </button>
        </div>
        {ushers.length ? (
          <ul className="ble-usher-pills">
            {ushers.map((u) => (
              <li key={roleId(u)}>
                <strong>{u.label || shortPub(roleId(u))}</strong>
                <span className="mono">{shortPub(roleId(u))}</span>
                <button type="button" className="pix-link" disabled={busy} onClick={() => void onRemoveUsher(roleId(u))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {groups.map((g) => (
        <section key={g.key} className="ble-carousel-block">
          <p className="kicker">{g.title}</p>
          <ul className="ble-carousel" aria-label={g.title}>
            {g.devices.map((d) => (
              <li key={d.hash}>
                <button
                  type="button"
                  className={'ble-card' + (selected === d.hash ? ' is-on' : '') + (d.connected ? ' is-live' : '')}
                  onClick={() => { setSelected(d.hash); setEditing(false); setLabel(d.label || '') }}
                >
                  <strong>{d.label || shortPub(d.deviceSignPubkey)}</strong>
                  <span className={'ble-status' + (d.connected ? ' is-ok' : '')}>{d.connected ? 'connected' : 'paired'}</span>
                  <span className="muted">{formatSeen(d.lastSeen)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!visible.length ? <p className="ble-empty">No phones.</p> : null}

      {selectedDevice ? (
        <DeviceDetail
          device={selectedDevice}
          editing={editing}
          label={label}
          busy={busy}
          onLabel={setLabel}
          onEdit={() => { setEditing(true); setLabel(selectedDevice.label || '') }}
          onCancel={() => setEditing(false)}
          onRename={() => void onRename()}
          onRevoke={() => void onRevoke()}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <div className="cta-row">
        <button type="button" className="pix-btn ghost" disabled={busy} onClick={() => void pairSimulated()}>
          Simulated phone
        </button>
        <button type="button" className="pix-btn ghost" disabled={busy} onClick={() => { void refresh(); void loadRoles() }}>
          Refresh
        </button>
      </div>
      {note ? <p className="door-note">{note}</p> : null}
    </div>
  )
}

const DeviceDetail = ({
  device: d,
  editing,
  label,
  busy,
  onLabel,
  onEdit,
  onCancel,
  onRename,
  onRevoke,
  onClose,
}: {
  device: DeviceRecord
  editing: boolean
  label: string
  busy: boolean
  onLabel: (s: string) => void
  onEdit: () => void
  onCancel: () => void
  onRename: () => void
  onRevoke: () => void
  onClose: () => void
}) => (
  <article className="ble-detail" aria-label={d.label || 'Phone'}>
    <div className="ble-device-top">
      <strong>{d.label || shortPub(d.deviceSignPubkey)}</strong>
      <button type="button" className="pix-link" onClick={onClose}>close</button>
    </div>
    <dl className="ble-kv">
      <div><dt>Status</dt><dd>{d.connected ? 'connected' : 'paired'}</dd></div>
      <div><dt>Sign</dt><dd className="mono break">{d.deviceSignPubkey}</dd></div>
      <div><dt>Noise</dt><dd className="mono break">{d.deviceNoiseStatic}</dd></div>
      <div><dt>Grant</dt><dd className="mono break">{d.hash}</dd></div>
      <div><dt>Expiry</dt><dd>{d.expiry ? new Date(d.expiry * 1000).toLocaleString() : '—'}</dd></div>
      <div><dt>Capability</dt><dd>{String(d.capabilities || '').split(',').map((c) => CAP_LABEL[c.trim()] || c).join(', ') || '—'}</dd></div>
      <div><dt>Last seq</dt><dd>{d.lastSeq || 0}</dd></div>
      <div><dt>Last seen</dt><dd>{formatSeen(d.lastSeen)}</dd></div>
      <div><dt>Usher</dt><dd className="mono break">{d.usher}</dd></div>
      <div><dt>Admin</dt><dd className="mono break">{d.admin || '—'}</dd></div>
    </dl>
    {editing ? (
      <form className="ble-rename" onSubmit={(e) => { e.preventDefault(); onRename() }}>
        <input value={label} onChange={(e) => onLabel(e.target.value)} aria-label="Device name" autoFocus />
        <button type="submit" className="pix-btn" disabled={busy}>Save</button>
        <button type="button" className="pix-btn ghost" onClick={onCancel}>Cancel</button>
      </form>
    ) : (
      <div className="cta-row">
        <button type="button" className="pix-btn ghost" disabled={busy} onClick={onEdit}>Rename</button>
        <button type="button" className="pix-btn ghost" disabled={busy} onClick={onRevoke}>Revoke</button>
      </div>
    )}
  </article>
)

const groupByUsher = (devices: DeviceRecord[]) => {
  const map = new Map<string, DeviceRecord[]>()
  for (const d of devices) {
    const key = d.usher || 'phones'
    const arr = map.get(key) || []
    arr.push(d)
    map.set(key, arr)
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    title: key === 'phones' ? 'Phones' : shortPub(key),
    devices: list,
  }))
}

const shotDevices = (eventId: string): DeviceRecord[] => [
  {
    hash: '11'.repeat(32),
    label: 'Door north',
    status: 'active',
    usher: 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    eventId,
    capabilities: 'scan-ticket',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    deviceSignPubkey: 'aa'.repeat(32),
    deviceNoiseStatic: 'bb'.repeat(32),
    lastSeen: Math.floor(Date.now() / 1000) - 12,
    lastSeq: 4,
    connected: true,
  },
  {
    hash: '22'.repeat(32),
    label: 'Garden gate',
    status: 'active',
    usher: 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    eventId,
    capabilities: 'scan-ticket',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    deviceSignPubkey: 'cc'.repeat(32),
    deviceNoiseStatic: 'dd'.repeat(32),
    lastSeen: Math.floor(Date.now() / 1000) - 90,
    lastSeq: 1,
    connected: false,
  },
]
