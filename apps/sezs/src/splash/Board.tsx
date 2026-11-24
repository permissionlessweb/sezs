/**
 * Splash board (DEV ONLY). Curates e2e test-event scenarios against the
 * loopback mock in dev/splash/server.mjs. Shows public facts only: test
 * private keys stay in apps/sezs/.splash/keys and never reach this page.
 */
import { useRouter } from 'next/router'
import { CSSProperties, useCallback, useEffect, useState } from 'react'

import { createPasskey } from '../auth/webauthn'
import { withBasePath } from '../ui/basePath'
import { Frame } from '../ui/Frame'
import { Halo, Ledger, Movement, Orbit } from '../ui/primitives'
import s from './Board.module.css'

type Identity = { id: string; kind: 'zafu' | 'zid' | 'ephemeral'; role: 'admin' | 'usher' | 'guest'; address: string; credId: string }
type Ticket = { id: string; holder: string; rail: string; status: 'pending' | 'paid' | 'used'; usedBy: string | null; attempts: number }
type Step = { name: string; ok: boolean; detail: string }
type State = {
  ok: boolean
  scenario: string | null
  scenarioLabel: string | null
  event: { name: string; capacity: number }
  identities: Identity[]
  tickets: Ticket[]
  qr: 'auto' | 'missing' | 'present'
  dregg: { zec: string; funded: boolean }
  log: { t: number; kind: string; msg: string }[]
  checklist: null | { at: number; pass: number; total: number; steps: Step[] }
  active: string | null
  activeRole: string | null
  scenarios: { id: string; label: string; note: string }[]
  keys: { id: string; kind: string; mode: string }[]
}

const API = '/__splash/api'
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(API + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-sezs-splash': '1' },
    body: JSON.stringify(body),
  })
  return r.json()
}
const short = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a)
const hhmmss = (t: number) => new Date(t).toTimeString().slice(0, 8)
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

const LINKS: Record<Identity['role'], { to: string; label: string; passkey?: boolean }[]> = {
  admin: [
    { to: '/admin/', label: 'admin', passkey: true },
    { to: '/door/', label: 'door' },
  ],
  usher: [
    { to: '/check-in/', label: 'check-in' },
    { to: '/door/', label: 'door' },
  ],
  guest: [
    { to: '/tickets/', label: 'tickets' },
    { to: '/keys/', label: 'keys' },
    { to: '/door/', label: 'door' },
  ],
}
const asLink = (id: string, to: string, passkey?: boolean) =>
  `/splash/?as=${encodeURIComponent(id)}&to=${encodeURIComponent(to)}${passkey ? '&passkey=1' : ''}`

/** Handles /splash/?as=<id>&to=<path>: set the dev cookie, seed this tab, go. */
const useActAs = () => {
  const { query, isReady } = useRouter()
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!isReady || typeof query.as !== 'string') return
    const to = typeof query.to === 'string' && query.to.startsWith('/') && !query.to.startsWith('//') ? query.to : '/'
    void (async () => {
      setMsg(`Acting as ${query.as}…`)
      const r = await post('/act', { id: query.as })
      if (!r.ok) return setMsg(`Unknown test identity: ${query.as}`)
      const session = r.session
      if (query.passkey === '1') {
        try {
          const credId = await createPasskey(String(query.as))
          session.credId = credId
          session.authenticators = [{ credId, label: 'splash-test', addedAt: Date.now() }]
        } catch (e) {
          setMsg(`Passkey not created (${e instanceof Error ? e.message : 'cancelled'}). Continuing without one; /admin will ask.`)
        }
      }
      sessionStorage.setItem('sezs-auth-v1-device', JSON.stringify(session))
      sessionStorage.setItem('sezs-usher-book', JSON.stringify(r.usherBook))
      sessionStorage.setItem('sezs-splash-as', String(query.as))
      location.replace(to)
    })()
  }, [isReady, query.as, query.to, query.passkey])
  return msg
}

const Tag = ({ v }: { v: string }) => <span className={`${s.tag} ${s['t_' + v] || ''}`}>{v}</span>

export default function Board() {
  const acting = useActAs()
  const [st, setSt] = useState<State | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [tabAs, setTabAs] = useState<string | null>(null)
  const [holder, setHolder] = useState('')
  const [rail, setRail] = useState('zec')
  const [pending, setPending] = useState(false)
  const [usher, setUsher] = useState('')
  const [ticket, setTicket] = useState('')
  const [door, setDoor] = useState<{ ok: boolean; text: string } | null>(null)
  const [qrFile, setQrFile] = useState<boolean | null>(null)
  const loop = typeof window !== 'undefined' && LOOPBACK.has(location.hostname)

  const load = useCallback(async () => {
    try {
      const r = await fetch(API + '/state', { cache: 'no-store' })
      setSt(await r.json())
    } catch {
      setNote('The splash mock on 127.0.0.1:3052 is not answering. Start it with pnpm dev:splash.')
    }
  }, [])

  useEffect(() => {
    if (!loop) return
    setTabAs(sessionStorage.getItem('sezs-splash-as'))
    void load()
    const t = setInterval(load, 1500)
    fetch('/cashapp-qr.png', { method: 'HEAD' }).then((r) => setQrFile(r.ok)).catch(() => setQrFile(false))
    return () => clearInterval(t)
  }, [load, loop])

  const run = async (label: string, path: string, body?: unknown) => {
    setBusy(label)
    try {
      const r = await post(path, body)
      setNote(r.ok ? `${label}: done.` : `${label}: ${r.message || r.error}`)
      await load()
      return r
    } finally {
      setBusy('')
    }
  }

  if (!loop) {
    return (
      <Frame title="Splash · dev only" shape="cube" core={[0.5, 0.3]}>
        <Halo kicker="Dev only" title="Loopback only" sub="Open this board on 127.0.0.1:3051 or localhost:3051." />
      </Frame>
    )
  }
  if (acting) {
    return (
      <Frame title="Splash · dev only" shape="cube" core={[0.5, 0.3]}>
        <Halo kicker="Splash · test identity" title="Switching" sub={acting} />
      </Frame>
    )
  }

  const ids = st?.identities || []
  const ushers = ids.filter((i) => i.role === 'usher')
  const tickets = st?.tickets || []
  const used = tickets.filter((t) => t.status === 'used').length
  const qrShown = st?.qr === 'present' || (st?.qr === 'auto' && qrFile)
  const ck = st?.checklist

  return (
    <Frame title="Splash board · dev only" shape="icosa" core={[0.5, 0.26]} intensity={0.55}>
      <Halo
        kicker="Dev only · loopback · test data"
        title="Splash"
        sub="Seed a test night, hand out test keys and tickets, and walk them through the door. Everything here is local: no chain, no funds, no real credentials."
      >
        <p className={s.status}>
          <span>scenario <b>{st?.scenarioLabel || 'none'}</b></span>
          <span>browser acts as <b>{st?.active || 'nobody'}</b>{st?.activeRole ? ` · ${st.activeRole}` : ''}</span>
          <span>this tab <b>{tabAs || '—'}</b></span>
          <span>tickets <b>{tickets.length}/{st?.event.capacity ?? '—'}</b> · used <b>{used}</b></span>
        </p>
      </Halo>

      <Movement n={1} title="Scenario" lede="One click seeds a fresh test night. Reset keeps the test keys; teardown removes them too.">
        <div className={s.presets}>
          {(st?.scenarios || []).map((p) => (
            <button key={p.id} type="button" className={`${s.preset} ${st?.scenario === p.id ? s.on : ''}`} disabled={!!busy} onClick={() => void run(p.label, '/scenario', { id: p.id })} title={p.note}>
              <i>{p.id === st?.scenario ? '◉' : '○'}</i>
              {p.label}
              <small>{p.note}</small>
            </button>
          ))}
        </div>
        <div className="inline-form">
          <button type="button" className="pix-btn ghost btn-sm" disabled={!!busy} onClick={() => void run('Reset', '/reset', { mode: 'reset' })}>Reset</button>
          <button type="button" className="pix-btn ghost btn-sm" disabled={!!busy} onClick={() => confirm('Teardown removes state, the dev allowlist and every test key. Continue?') && void run('Teardown', '/reset', { mode: 'teardown' })}>Teardown</button>
        </div>
      </Movement>

      <Movement n={2} title="Test identities" lede="Keys are generated on this machine, stored 0600 in apps/sezs/.splash/keys (gitignored), and never shown. Admins and ushers land in the dev allowlist.">
        {ids.length ? (
          <Orbit
            label="Test identities"
            items={ids.slice(0, 12).map((i) => ({ key: i.id, title: i.id, note: `${i.role} · ${i.kind}` }))}
            center={<span className="orbit-center-t">{st?.active || 'no one'}</span>}
          />
        ) : (
          <p className="fine">No test identities yet. Seed a scenario or generate one.</p>
        )}
        <ul className={s.ids}>
          {ids.map((i) => (
            <li key={i.id} className={st?.active === i.id ? s.on : ''}>
              <span className={s.who}>
                <b>{i.id}</b> <Tag v={i.role} /> <Tag v={i.kind} />
              </span>
              <span className="mono" title={i.address}>{short(i.address)}</span>
              <span className={s.links}>
                {LINKS[i.role].map((l) => (
                  <a key={l.to} href={asLink(i.id, l.to, l.passkey)} className="pix-link">
                    → {l.label}
                  </a>
                ))}
                <button type="button" className="pix-link" onClick={() => void run(`Act as ${i.id}`, '/act', { id: i.id })}>act</button>
              </span>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          {(['admin', 'usher', 'guest'] as const).map((role) => (
            <button key={role} type="button" className="pix-btn ghost btn-sm" disabled={!!busy} onClick={() => void run(`New ${role}`, '/keys', { role, kind: role === 'admin' ? 'zafu' : 'ephemeral' })}>
              + {role} key
            </button>
          ))}
          <button type="button" className="pix-btn ghost btn-sm" disabled={!!busy} onClick={() => void run('Load stored keys', '/keys', { action: 'load' })}>Load stored keys</button>
          <button type="button" className="pix-link" onClick={() => void run('Clear', '/act', { id: null })}>clear acting identity</button>
        </div>
        <p className="fine">
          {st?.keys.length || 0} key file(s) on disk · modes {Array.from(new Set((st?.keys || []).map((k) => k.mode))).join(', ') || '—'} · dev allowlist apps/sezs/.splash/admin-allowlist.dev.json · /admin asks for a passkey on this device, so its link creates a test passkey first.
        </p>
      </Movement>

      <Movement n={3} title="Tickets" lede="Test tickets on mock rails. Pending tickets wait for a loopback watcher fact.">
        <Ledger
          rows={
            tickets.length
              ? tickets.map((t) => ({
                  k: (
                    <>
                      <span className="mono">{t.id}</span> · {t.holder}
                    </>
                  ),
                  v: (
                    <>
                      <span className={s.rail}>{t.rail}</span> <Tag v={t.status} />
                      {t.status === 'pending' ? (
                        <button type="button" className={`pix-link ${s.act}`} onClick={() => void run('Watcher fact', '/tickets/pay', { ticket: t.id })}>mark paid</button>
                      ) : null}
                      {t.status === 'paid' ? (
                        <button type="button" className={`pix-link ${s.act}`} onClick={() => setTicket(t.id)}>to door</button>
                      ) : null}
                    </>
                  ),
                  tone: t.status === 'used' ? ('dim' as const) : t.status === 'paid' ? ('ok' as const) : undefined,
                }))
              : [{ k: 'no tickets', v: '—', tone: 'dim' as const }]
          }
        />
        <form
          className={`inline-form ${s.form}`}
          onSubmit={(e) => {
            e.preventDefault()
            void run('Issue', '/tickets', { holder: holder || ids.find((i) => i.role === 'guest')?.id, rail, status: pending ? 'pending' : 'paid' })
          }}
        >
          <select aria-label="Holder" value={holder} onChange={(e) => setHolder(e.target.value)}>
            <option value="">first guest</option>
            {ids.map((i) => (
              <option key={i.id} value={i.id}>{i.id}</option>
            ))}
          </select>
          <select aria-label="Rail" value={rail} onChange={(e) => setRail(e.target.value)}>
            {['zec', 'eth', 'base', 'penumbra'].map((r) => (
              <option key={r} value={r}>{r} (test)</option>
            ))}
          </select>
          <label className={s.check}>
            <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> pending
          </label>
          <button className="pix-btn btn-sm" type="submit" disabled={!!busy || !ids.length}>Issue test ticket</button>
        </form>
      </Movement>

      <Movement n={4} title="Door" lede="Same rule as /check-in: an usher on the list, a paid ticket, once.">
        <form
          className={`inline-form ${s.form}`}
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await run('Check-in', '/door', { usher: usher || ushers[0]?.id, ticket })
            setDoor({ ok: !!r.ok, text: r.message || r.error })
          }}
        >
          <select aria-label="Usher" value={usher} onChange={(e) => setUsher(e.target.value)}>
            <option value="">{ushers[0]?.id || 'no usher'}</option>
            {ids.filter((i) => i.id !== ushers[0]?.id).map((i) => (
              <option key={i.id} value={i.id}>{i.id} ({i.role})</option>
            ))}
          </select>
          <input aria-label="Ticket id" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="tkt-test-…" spellCheck={false} />
          <button className="pix-btn btn-sm" type="submit" disabled={!!busy || !ticket}>Check in</button>
        </form>
        {door ? <p className={`${s.door} ${door.ok ? s.pass : s.fail}`}>{door.ok ? '✓ ' : '✕ '}{door.text}</p> : null}
        <p className="fine">The real page works too: open an usher’s → check-in link and enter a ticket id.</p>
      </Movement>

      <Movement n={5} title="Rails & door QR" lede="Loopback states only. The funded ZEC path is optional and not wired here.">
        <div className={s.rails}>
          <div>
            <p className={s.k}>ZEC / DREGG loopback</p>
            <div className={s.seg}>
              {['idle', 'pending', 'confirmed', 'unreachable'].map((z) => (
                <button key={z} type="button" className={st?.dregg.zec === z ? s.on : ''} onClick={() => void run('DREGG', '/dregg', { zec: z })}>{z}</button>
              ))}
            </div>
            <p className="fine">funded test minter · optional · {st?.dregg.funded ? 'on' : 'off (needs a funded test ZEC minter)'}</p>
          </div>
          <div>
            <p className={s.k}>Cash App door QR preview</p>
            <div className={s.seg}>
              {(['auto', 'missing', 'present'] as const).map((q) => (
                <button key={q} type="button" className={st?.qr === q ? s.on : ''} onClick={() => void run('QR', '/qr', { mode: q })}>{q}</button>
              ))}
            </div>
            <div className={s.qr}>
              {qrShown && qrFile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={withBasePath("/cashapp-qr.png")} alt="Cash App door QR" />
              ) : (
                <span className={s.qrph} aria-label="QR not loaded">
                  QR not loaded
                  <small>{qrShown ? 'present selected, but public/cashapp-qr.png is missing' : 'cashapp-qr.png is user-supplied'}</small>
                </span>
              )}
            </div>
          </div>
        </div>
      </Movement>

      <Movement n={6} title="Checklist" lede="Runs the happy path through the dev server and reports each step. It reseeds a clean event.">
        <div className="inline-form">
          <button type="button" className="pix-btn" disabled={!!busy} onClick={() => void run('Checklist', '/checklist')}>{busy === 'Checklist' ? 'Running…' : 'Run e2e checklist'}</button>
        </div>
        {ck ? (
          <>
            <p className={s.score} style={{ '--p': ck.pass / ck.total } as CSSProperties}>
              <b>{ck.pass}/{ck.total}</b> passed · {hhmmss(ck.at)}
            </p>
            <ol className={s.steps}>
              {ck.steps.map((x, i) => (
                <li key={i} className={x.ok ? s.pass : s.fail}>
                  <span className={s.mark}>{x.ok ? 'PASS' : 'FAIL'}</span>
                  <span>{x.name}</span>
                  <small>{x.detail}</small>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </Movement>

      <Movement n={7} title="Event log" lede="Live, newest first. Ids and public addresses only.">
        <ol className={s.log} aria-live="polite">
          {(st?.log || []).slice().reverse().map((l, i) => (
            <li key={i}>
              <time>{hhmmss(l.t)}</time>
              <i>{l.kind}</i>
              <span>{l.msg}</span>
            </li>
          ))}
        </ol>
        {note ? <p className="fine">{note}</p> : null}
      </Movement>
    </Frame>
  )
}
