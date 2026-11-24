/**
 * Splash board mock backend. DEV ONLY, loopback only.
 *
 * Next (splash dev mode) rewrites /__splash/api/* and /sezs/* here, so the real
 * pages (/admin, /door, /check-in) talk to this mock instead of the FROST inbox.
 * Refuses to start unless SEZS_SPLASH=1 and NODE_ENV !== 'production'.
 * Binds 127.0.0.1 only. No chain, no funds, no real credentials.
 * Ticket secret policy: apps/sezs/docs/BACKEND-ROLE.md.
 */
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as L from './lib.mjs'
import { refuseSecretFields } from './guards.mjs'
import { attachZafuState, makeZafuHandlers } from './zafu-routes.mjs'
import { ensureEnvelopes } from './envelopes.mjs'
import * as V2 from './ticket-v2.mjs'
import { publisherFromEnv } from './root-publisher.mjs'
import { pollPayments, applyHits } from './chain-watchers.mjs'
import { addrOf, chainEnv, executeAs } from './chain-tx.mjs'
import { makeConsumeHandlers } from './consume-routes.mjs'
import { makeBleHandlers } from './ble-routes.mjs'
import { resolveLiveRole } from './live-roles.mjs'
import { openGrantStore } from './ble-grants.mjs'
import { makeRoleHandlers } from './event-role-routes.mjs'
import { makeSessionLogin, staffMeBody } from './session-login.mjs'
import { emailMeBody, makeEmailAuth } from './email-auth.mjs'
import { makeFileSink } from './email-sink.mjs'
import { makeFrostAdminHandlers } from './frost-admin-routes.mjs'
import { requireStaff } from './staff-guard.mjs'
import { makePayrollHandlers, resetPayrollFile } from './payroll-routes.mjs'

if (process.env.NODE_ENV === 'production' || process.env.SEZS_SPLASH !== '1') {
  console.error('splash: refusing to start (needs SEZS_SPLASH=1 and a non-production NODE_ENV)')
  process.exit(2)
}

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = process.env.SEZS_SPLASH_DIR || join(APP, '.splash')
const KEYS = join(DIR, 'keys')
const STATE = join(DIR, 'state.json')
const ALLOW = join(DIR, 'admin-allowlist.dev.json')
const PORT = Number(process.env.SEZS_SPLASH_PORT || 3052)
const APP_BASE = process.env.SEZS_SPLASH_APP || 'http://127.0.0.1:3051'
const PAGE_HOSTS = new Set(['127.0.0.1:3051', 'localhost:3051'])
const ORIGINS = new Set(['http://127.0.0.1:3051', 'http://localhost:3051'])
const SELF_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const LOOP = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const COOKIE = 'sezs_splash'

mkdirSync(KEYS, { recursive: true, mode: 0o700 })
chmodSync(DIR, 0o700)
chmodSync(KEYS, 0o700)

// ── persistence ─────────────────────────────────────────────────
const atomic = (path, data, mode = 0o600) => {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, path)
  chmodSync(path, mode)
}
let S = (() => {
  try {
    return attachZafuState(L.ensurePay({ ...L.emptyState(), ...JSON.parse(readFileSync(STATE, 'utf8')) }))
  } catch {
    return L.emptyState()
  }
})()
V2.hydrateV2(S)
const save = () => {
  atomic(STATE, JSON.stringify(S, null, 1))
  atomic(ALLOW, JSON.stringify(L.allowlistOf(S), null, 1))
}

// ── TEST keys: stored 0600, read back only to derive public facts ─────────
const keyPath = (id) => join(KEYS, `${id}.json`)
const identityFor = ({ id, kind, role }) => {
  if (!L.SEAT.test(id) || !L.KINDS.includes(kind) || !L.ROLES.includes(role)) throw new Error('bad_identity')
  let pub, createdAt
  if (existsSync(keyPath(id))) {
    const k = JSON.parse(readFileSync(keyPath(id), 'utf8'))
    pub = L.publicOf(k.secretHex)
    createdAt = k.createdAt
  } else {
    const k = L.newTestKey()
    createdAt = Date.now()
    atomic(keyPath(id), JSON.stringify({ test: true, id, kind, role, curve: 'secp256k1', secretHex: k.secretHex, createdAt }))
    pub = { pubHex: k.pubHex, address: k.address }
  }
  return { id, kind, role, address: pub.address, pubHex: pub.pubHex, credId: `splash-${id}`, createdAt }
}
const storedKeys = () =>
  readdirSync(KEYS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const k = JSON.parse(readFileSync(join(KEYS, f), 'utf8'))
      return { id: k.id, kind: k.kind, mode: (statSync(join(KEYS, f)).mode & 0o777).toString(8) }
    })

// ── http helpers ────────────────────────────────────────────────
const cookieOf = (req) => {
  const m = /(?:^|;\s*)sezs_splash=([A-Za-z0-9._-]{1,640})/.exec(req.headers.cookie || '')
  return m ? m[1] : null
}
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 64_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })

/** Loopback socket, our own Host, and (when proxied) a loopback page host. */
const guard = (req) => {
  if (!LOOP.has(req.socket.remoteAddress)) return 'not_loopback'
  if (!SELF_HOSTS.has(String(req.headers.host || ''))) return 'bad_host'
  const fwdHost = req.headers['x-forwarded-host']
  if (fwdHost && !String(fwdHost).split(',').every((h) => PAGE_HOSTS.has(h.trim()))) return 'bad_forwarded_host'
  const fwdFor = req.headers['x-forwarded-for']
  if (fwdFor && !String(fwdFor).split(',').every((h) => LOOP.has(h.trim()))) return 'not_loopback'
  if (req.method === 'POST') {
    const o = req.headers.origin
    if (o && !ORIGINS.has(o)) return 'bad_origin'
  }
  return null
}

// ── checklist: the happy path through the real proxy on :3051 ────────
const viaApp = async (path, { method = 'GET', as, body } = {}) => {
  const r = await fetch(APP_BASE + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(as ? { cookie: `${COOKIE}=${as}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-sezs-frost': '1',
      'x-sezs-splash': '1',
      origin: 'http://127.0.0.1:3051',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* html */
  }
  return { status: r.status, json, text }
}

const runChecklist = async () => {
  const steps = []
  const step = async (name, fn) => {
    try {
      const detail = await fn()
      steps.push({ name, ok: true, detail: String(detail || 'ok') })
    } catch (e) {
      steps.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }
  const must = (c, msg) => {
    if (!c) throw new Error(msg)
  }
  await step('Seed "Clean event"', async () => {
    const r = await viaApp('/__splash/api/scenario', { method: 'POST', body: { id: 'clean' } })
    must(r.json?.ok, `seed failed (${r.status})`)
    return `${S.identities.length} identities · ${S.tickets.length} tickets`
  })
  await step('Test keys stored locally, 0600, never in the API or log', async () => {
    const keys = storedKeys()
    must(keys.length >= S.identities.length, 'missing key files')
    must(keys.every((k) => k.mode === '600'), 'key file mode is not 0600')
    const state = await viaApp('/__splash/api/state')
    const blob = state.text + readFileSync(STATE, 'utf8') + readFileSync(ALLOW, 'utf8')
    for (const f of readdirSync(KEYS).filter((x) => x.endsWith('.json'))) {
      const sec = JSON.parse(readFileSync(join(KEYS, f), 'utf8')).secretHex
      must(!blob.includes(sec), 'a test private key leaked into state, allowlist or API')
    }
    return `${keys.length} key files, none leaked`
  })
  await step('Dev allowlist lists admin-1 and usher-1', async () => {
    const al = JSON.parse(readFileSync(ALLOW, 'utf8'))
    must(al.admins.some((a) => a.id === 'admin-1'), 'admin-1 missing')
    must(al.ushers.some((u) => u.id === 'usher-1'), 'usher-1 missing')
    return `admins ${al.admins.length} · ushers ${al.ushers.length}`
  })
  await step('Session role via /sezs/session/me (admin, usher, guest)', async () => {
    const roles = {}
    for (const id of ['admin-1', 'usher-1', 'guest-keplr']) roles[id] = (await viaApp('/sezs/session/me', { as: id })).json?.role
    must(roles['admin-1'] === 'admin' && roles['usher-1'] === 'usher' && roles['guest-keplr'] === 'guest', JSON.stringify(roles))
    const none = await viaApp('/sezs/session/me')
    must(none.json?.ok === false, 'anonymous got a role')
    return Object.entries(roles).map(([k, v]) => `${k}=${v}`).join(' · ')
  })
  await step('Issue a test ticket to guest-eph', async () => {
    const r = await viaApp('/__splash/api/tickets', { method: 'POST', body: { holder: 'guest-eph', rail: 'eth' } })
    must(r.json?.ok, r.json?.error || 'issue failed')
    return r.json.ticket.id
  })
  const first = () => S.tickets.find((t) => t.holder === 'guest-keplr')?.id
  await step('Usher checks in guest-keplr at /sezs/door/consume', async () => {
    const r = await viaApp('/sezs/door/consume', { method: 'POST', as: 'usher-1', body: { ticket: first() } })
    must(r.json?.ok === true, r.json?.error || `status ${r.status}`)
    return `${first()} used`
  })
  await step('Second use of the same ticket is refused', async () => {
    const r = await viaApp('/sezs/door/consume', { method: 'POST', as: 'usher-1', body: { ticket: first() } })
    must(r.json?.ok === false && /already used/i.test(r.json?.error || ''), `expected refusal, got ${r.text.slice(0, 80)}`)
    return r.json.error
  })
  await step('A guest cannot check anyone in', async () => {
    const t = S.tickets.find((x) => x.holder === 'guest-zafu')?.id
    const r = await viaApp('/sezs/door/consume', { method: 'POST', as: 'guest-zafu', body: { ticket: t } })
    must(r.json?.ok === false && /not an usher/i.test(r.json?.error || ''), 'guest was allowed')
    return r.json.error
  })
  await step('Pending ticket refused, then paid by a mock ZEC watcher fact, then admitted', async () => {
    const issued = await viaApp('/__splash/api/tickets', { method: 'POST', body: { holder: 'guest-zafu', rail: 'zec', status: 'pending' } })
    const id = issued.json?.ticket?.id
    must(id, 'pending issue failed')
    const a = await viaApp('/sezs/door/consume', { method: 'POST', as: 'usher-1', body: { ticket: id } })
    must(a.json?.ok === false && /not paid/i.test(a.json?.error || ''), 'pending ticket admitted')
    const p = await viaApp('/__splash/api/tickets/pay', { method: 'POST', body: { ticket: id } })
    must(p.json?.ok, 'watcher fact failed')
    const b = await viaApp('/sezs/door/consume', { method: 'POST', as: 'usher-1', body: { ticket: id } })
    must(b.json?.ok === true, b.json?.error || 'not admitted after pay')
    return `${id}: refused → paid → used`
  })
  await step('Sold out refuses the next issue', async () => {
    const r = L.seed('sold-out', ({ id, kind, role }) => ({ id, kind, role, address: 'x', pubHex: '02', credId: id, createdAt: 0 }))
    must(r.ok && r.state.tickets.length === 6, 'sold-out seed wrong')
    must(r.state.log.some((l) => /sold out/.test(l.msg)), 'no sold-out refusal')
    return '6/6 issued, 7th refused'
  })
  await step('Pages answer 200 through the dev server', async () => {
    const paths = ['/admin/', '/door/', '/check-in/', '/tickets/', '/keys/', '/splash/']
    const bad = []
    for (const p of paths) {
      const r = await viaApp(p)
      if (r.status !== 200) bad.push(`${p} ${r.status}`)
    }
    must(!bad.length, bad.join(', '))
    return paths.join(' ')
  })
  await step('Reset back to a clean event', async () => {
    const r = await viaApp('/__splash/api/scenario', { method: 'POST', body: { id: 'clean' } })
    must(r.json?.ok, 'reseed failed')
    return 'clean'
  })
  const pass = steps.filter((s) => s.ok).length
  S.checklist = { at: Date.now(), pass, total: steps.length, steps }
  L.log(S, 'checklist', `happy path ${pass}/${steps.length} passed`)
  save()
  return S.checklist
}

// ── routes ──────────────────────────────────────────────────────
const API = {
  'GET /__splash/api/event': () => {
    const p = join(APP, 'src/event/fixture.json')
    const data = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
    return [200, { ok: true, source: 'fixture', api: 1, data }]
  },

  'GET /__splash/api/state': (req) => [200, { ok: true, ...L.publicState(S, cookieOf(req)), keys: storedKeys() }],

  'POST /__splash/api/scenario': (_req, b) => {
    const r = L.seed(String(b.id || ''), identityFor)
    if (!r.ok) return [200, r]
    r.state.qr = S.qr
    S = r.state
    save()
    resetPayrollFile(payrollPath())
    return [200, { ok: true }]
  },

  'POST /__splash/api/reset': (_req, b) => {
    const teardown = b.mode === 'teardown'
    S = L.emptyState()
    if (teardown) {
      for (const f of readdirSync(KEYS)) rmSync(join(KEYS, f), { force: true })
      L.log(S, 'reset', 'teardown: state, allowlist and test keys removed')
    } else L.log(S, 'reset', 'reset: state and allowlist cleared, test keys kept')
    save()
    resetPayrollFile(payrollPath())
    return [200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` }]
  },

  'POST /__splash/api/keys': (_req, b) => {
    if (b.action === 'load') {
      let n = 0
      for (const f of readdirSync(KEYS).filter((x) => x.endsWith('.json'))) {
        const k = JSON.parse(readFileSync(join(KEYS, f), 'utf8'))
        if (S.identities.some((i) => i.id === k.id)) continue
        S.identities.push(identityFor({ id: k.id, kind: k.kind, role: k.role || 'guest' }))
        n++
      }
      L.log(S, 'keys', `loaded ${n} stored test key(s) from .splash/keys`)
      save()
      return [200, { ok: true, loaded: n }]
    }
    const role = L.ROLES.includes(b.role) ? b.role : 'guest'
    const kind = L.KINDS.includes(b.kind) ? b.kind : 'ephemeral'
    const n = S.identities.filter((i) => i.role === role).length + 1
    let id = `${role}-${n}`
    while (S.identities.some((i) => i.id === id) || existsSync(keyPath(id))) id = `${role}-${L.tag(2)}`
    const who = identityFor({ id, kind, role })
    S.identities.push(who)
    L.log(S, 'keys', `generated TEST ${kind} key for ${id} (${role}) · ${who.address}`)
    save()
    return [200, { ok: true, id }]
  },

  'POST /__splash/api/act': (_req, b) => {
    if (!b.id) {
      L.log(S, 'act', 'cleared active identity')
      save()
      return [200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` }]
    }
    const who = S.identities.find((i) => i.id === b.id)
    if (!who) return [200, { ok: false, error: 'unknown_identity' }]
    const usherBook = { ushers: S.identities.filter((i) => i.role === 'usher').map((i) => i.id), pending: null, spent: [] }
    L.log(S, 'act', `acting as ${who.id} (${L.roleOf(S, who.id)})`)
    save()
    return [200, { ok: true, session: L.tabSession(who), usherBook, role: L.roleOf(S, who.id) }, { 'set-cookie': `${COOKIE}=${who.id}; Path=/; HttpOnly; SameSite=Strict` }]
  },


  'POST /__splash/api/invoice': (_req, b) => {
    const r = L.issueInvoice(S, { rail: b.rail, commitment: b.commitment, sku: b.sku, eventId: b.eventId, ticketPubkey: b.ticketPubkey, nullifier: b.nullifier })
    save()
    return [200, r]
  },
  'POST /__splash/api/watch/pay': (_req, b) => {
    const r = L.markPaidByCommitment(S, b.commitment || b.memo, { amountCents: b.amountCents })
    save()
    return [200, r]
  },
  'POST /__splash/api/tickets': (_req, b) => {
    const r = L.issueTicket(S, String(b.holder || ''), { rail: b.rail || 'zec', status: b.status })
    save()
    return [200, r]
  },
  'POST /__splash/api/tickets/pay': (_req, b) => {
    const r = L.markPaid(S, String(b.ticket || ''))
    save()
    return [200, r]
  },
  'POST /__splash/api/door': async (_req, b) => {
    const r = await L.consume(S, String(b.usher || ''), String(b.ticket || ''))
    save()
    return [200, r]
  },
  'POST /__splash/api/qr': (_req, b) => {
    S.qr = ['auto', 'missing', 'present'].includes(b.mode) ? b.mode : 'auto'
    L.log(S, 'qr', `Cash App QR preview: ${S.qr}`)
    save()
    return [200, { ok: true }]
  },
  'POST /__splash/api/dregg': (_req, b) => {
    const next = ['idle', 'pending', 'confirmed', 'unreachable'].includes(b.zec) ? b.zec : 'idle'
    S.dregg = { zec: next, funded: false }
    L.log(S, 'dregg', `ZEC/DREGG loopback state → ${next} (mock; funded path not wired)`)
    save()
    return [200, { ok: true }]
  },
  'POST /__splash/api/checklist': async () => [200, { ok: true, checklist: await runChecklist() }],

  // ── the FROST inbox surface the real pages call, mocked ──
  'GET /sezs/session/me': (req) => {
    const id = cookieOf(req)
    const role = id ? L.roleOf(S, id) : null
    if (!role) return [200, { ok: false, error: 'no_session' }]
    const who = S.identities.find((i) => i.id === id)
    return [200, { ok: true, role, login_id: who.address }]
  },
  'POST /sezs/session/logout': (req) => {
    emailAuth.revokeFromRequest(req)
    return [200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` }]
  },
  'POST /sezs/door/challenge': async (req, _b) => {
    if (req.headers['x-sezs-frost'] !== '1') return [200, { ok: false, error: 'Refused: missing x-sezs-frost.' }]
    await L.ensureDoorAuth(S)
    const r = L.issueChallenge(S, cookieOf(req) || '', L.roleOf)
    save()
    return [200, r]
  },
  'POST /sezs/door/consume': async (req, b) => {
    if (req.headers['x-sezs-frost'] !== '1') return [200, { ok: false, error: 'Refused: missing x-sezs-frost.' }]
    const raw = b.ticket || b.token || b
    const r = await L.consumeProof(S, cookieOf(req) || '', raw, L.roleOf)
    save()
    return [200, r.ok ? { ok: true, ticket: r.ticket?.id || r.commitment, message: r.message, nullifier: r.nullifier || undefined, how: r.how } : { ok: false, error: r.message || r.error }]
  },
}

// ── ticket v2 (TICKET-V2-SPEC.md §7): no N / ticket key at invoice, public leaf
// list, backups by invoice id, guest root published by the FROST set ──
const ROOTS = publisherFromEnv()
const publishRoot = async (reason) => {
  if (!ROOTS) return { published: false, skipped: 'publisher_off' }
  try {
    const e = chainEnv()
    if (e.contract && e.lcd) {
      const msg = Buffer.from(JSON.stringify({ roots: {} })).toString('base64')
      const q = await fetch(`${e.lcd}/cosmwasm/wasm/v1/contract/${e.contract}/smart/${msg}`)
      const data = (await q.json()).data
      if (data && data.current_epoch) {
        const v = V2.ensureV2(S)
        const last = v.published[v.published.length - 1]
        if (!last || last.epoch < data.current_epoch) {
          v.published.push({ root: data.current_root, epoch: data.current_epoch, leafCount: data.current_leaf_count, at: Date.now() })
        }
      }
    }
  } catch {}
  const r = await ROOTS.maybePublish(S, reason)
  if (r.published) save()
  return r
}
Object.assign(API, {
  'POST /__splash/api/v2/invoice': (_req, b) => {
    const r = V2.issueInvoiceV2(S, b)
    save()
    return [200, r]
  },
  'POST /__splash/api/v2/watch/poll': async () => {
    const r = await pollPayments()
    const applied = r.hits?.length ? applyHits(S, r.hits, (s, c, extra) => V2.markPaidV2(s, c, extra)) : []
    if (applied.length) {
      save()
      if (ROOTS) await publishRoot('paid').catch(() => {})
    }
    return [200, { ok: r.ok !== false, hits: (r.hits || []).map((h) => ({ rail: h.rail, txid: h.txid, commitment: h.commitment })), applied, error: r.error }]
  },
  'POST /__splash/api/v2/watch/pay': async (_req, b) => {
    const r = V2.markPaidV2(S, b.commitment || b.memo, { amountCents: b.amountCents })
    save()
    if (r.ok && !r.already) r.publish = await publishRoot('interval')
    return [200, r]
  },
  'POST /__splash/api/v2/envelope': (_req, b) => {
    const r = V2.putEnvelopeV2(S, b)
    save()
    return [200, r]
  },
  'POST /__splash/api/v2/root/publish': async (_req, b) => [200, await publishRoot(String(b.reason || 'force'))],
  'GET /sezs/v2/leaves': () => [200, V2.leavesV2(S)],
  'GET /sezs/v2/envelope': (req) => [200, V2.getEnvelopesV2(S, new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('invoice'))],
  'GET /sezs/v2/paid': (req) => {
    const c = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('c')
    const v = V2.ensureV2(S)
    const inv = [...v.invoices].reverse().find((i) => i.commitment === String(c || '').toLowerCase().replace(/^0x/, '') || i.commitment === String(c || ''))
    if (!inv) return [200, { ok: false, error: 'unknown_invoice' }]
    const pub = V2.publicInvoiceV2(inv)
    return [200, { ok: true, paid: inv.status === 'paid', status: inv.status, phase: pub.phase, invoice: pub }]
  },
  'GET /sezs/v2/door/config': () => {
    const e = chainEnv()
    if (!e.contract) return [200, { ok: false, error: 'no_contract' }]
    let usher = ''
    try { usher = addrOf(e.usherKey) } catch { usher = '' }
    // Event fps / zkid come from the front end's EventView; this answers who signs ConsumeTicket.
    return [200, {
      ok: true,
      contract: e.contract,
      chainId: e.chainId,
      lcd: e.lcd,
      usher,
      usherKey: e.usherKey,
    }]
  },
  'POST /sezs/v2/door/consume': async (_req, b) => {
    const e = chainEnv()
    if (!e.contract) return [200, { ok: false, error: 'no_contract' }]
    const proof = b.proof
    const root = b.root
    const nullifier = b.nullifier
    if (!proof || !root || !nullifier) return [200, { ok: false, error: 'missing_fields' }]
    const consent = b.consent
    if (!consent || !(consent.live || consent.printed)) return [200, { ok: false, error: 'missing_consent' }]
    const msg = {
      consume_ticket: {
        proof: proof.length === 8384 ? Buffer.from(proof, 'hex').toString('base64') : proof,
        root,
        nullifier,
        event_id: b.event_id,
        domain: b.domain,
        rk_x: b.rk_x,
        rk_y: b.rk_y,
        consent,
      },
    }
    const r = await executeAs(e.usherKey, e.contract, msg)
    if (!r.ok) {
      const err = String(r.error || 'consume_failed')
      const spent = /nullifier already spent/i.test(err)
      return [200, { ok: false, error: spent ? 'This ticket was already admitted. A second scan is refused.' : err }]
    }
    return [200, { ok: true, message: 'Admitted on chain. A second scan will be refused.', txhash: r.txhash, height: r.height, gasUsed: r.gasUsed }]
  },
})
if (ROOTS) setInterval(() => publishRoot('interval').catch(() => {}), 60_000).unref()
if (process.env.SEZS_SESSION_ROOT) {
  setInterval(() => {
    pollPayments().then((r) => {
      if (!r.hits?.length) return
      const applied = applyHits(S, r.hits, (s, c, extra) => V2.ingestPaidLeafV2(s, { commitment: c, ...extra }))
      if (applied.length) {
        save()
        if (ROOTS) publishRoot('paid').catch(() => {})
      }
    }).catch(() => {})
  }, 10_000).unref()
}

const zafuApi = makeZafuHandlers({
  state: () => S,
  save,
  roleOf: L.roleOf,
  cookieOf,
})
Object.assign(API, zafuApi)

const payrollPath = () => join(DIR, 'payroll.json')
const payrollApi = makePayrollHandlers({
  cookieOf,
  roleOf: (id) => L.roleOf(S, id),
  addressOf: (id) => S.identities.find((i) => i.id === id)?.address || '',
  liveConfig: () => ({
    lcd: process.env.SEZS_EVENT_LCD || process.env.SEZS_LCD || '',
    contract: process.env.SEZS_EVENT_CONTRACT || '',
    coordinatorsGroup: process.env.SEZS_COORD_GROUP || '',
    usherGroup: process.env.SEZS_USHER_GROUP || '',
  }),
  persistPath: payrollPath(),
  bouncerUrl: () => process.env.SEZS_FROST_BOUNCER || 'http://127.0.0.1:3055',
})
Object.assign(API, payrollApi)

const bootOf = () => {
  try {
    const pth = process.env.SEZS_BOOT_FILE || join(process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough', 'terp-boot.json')
    if (existsSync(pth)) return JSON.parse(readFileSync(pth, 'utf8'))
  } catch {}
  return {}
}

const liveCfg = () => {
  const boot = bootOf()
  return {
    lcd: process.env.SEZS_EVENT_LCD || process.env.SEZS_LCD || process.env.SEZS_V2_LCD || boot.lcd || 'http://127.0.0.1:1317',
    contract: process.env.SEZS_EVENT_CONTRACT || process.env.SEZS_V2_ROOT_CONTRACT || boot.contract || '',
    coordinatorsGroup: process.env.SEZS_COORD_GROUP || boot.coordinators || '',
    usherGroup: process.env.SEZS_USHER_GROUP || boot.ushers || '',
  }
}

const grantStore = openGrantStore(join(DIR, 'ble-grants.json'))
const isLiveAdmin = async (address) => {
  if (!address) return false
  const r = await resolveLiveRole(liveCfg(), { address, sessionRole: null })
  return r.role === 'admin' || r.role === 'coordinator'
}
const isEventUsher = async (address) => {
  if (!address) return false
  const r = await resolveLiveRole(liveCfg(), { address, sessionRole: null })
  return r.role === 'usher'
}
const consumeApi = makeConsumeHandlers({
  cookieOf,
  roleOf: (id) => L.roleOf(S, id),
  state: () => S,
  grantStore,
  isAdmin: isLiveAdmin,
  isUsher: isEventUsher,
  sameRole: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(),
})
Object.assign(API, consumeApi)
const bleApi = makeBleHandlers({
  store: grantStore,
  isAdmin: isLiveAdmin,
  isUsher: isEventUsher,
  eventIdOf: () => S.v2?.eventId || process.env.SEZS_EVENT_ID || 'speakez-sessions',
})
Object.assign(API, bleApi)
const roleApi = makeRoleHandlers({
  liveCfg,
  isCoordinator: isLiveAdmin,
  eventIdOf: () => S.v2?.eventId || process.env.SEZS_EVENT_ID || 'speakez-sessions',
})
Object.assign(API, roleApi)



const sessionLogin = makeSessionLogin({ liveConfig: liveCfg })
// Email sign-in runtime: same cookie family, loopback file sink (0600), no provider.
const emailAuth = makeEmailAuth({
  sendEmail: makeFileSink(join(DIR, 'email-outbox')).sendEmail,
  dbPath: join(DIR, 'email-auth.sqlite'),
  stateDir: DIR,
  allowedOrigins: ORIGINS,
  powBits: Number(process.env.SEZS_EMAIL_POW_BITS || 0),
  adaptivePowThreshold: Number(process.env.SEZS_EMAIL_POW_AFTER || 8),
  onEvent: (e) => L.log(S, 'email-auth', `${e.kind} ${e.ok ? 'ok' : 'refused'} · ${String(e.emailHash || '').slice(0, 12)}…`),
})
const roleOfAll = (id) => sessionLogin.roleOfSession(id) || emailAuth.roleOfSession(id) || L.roleOf(S, id)
const addressOfAll = (id) => sessionLogin.addressOfSession(id) || emailAuth.addressOfSession(id) || S.identities.find((i) => i.id === id)?.address || ''
Object.assign(API, sessionLogin.handlers)
Object.assign(API, emailAuth.handlers)
Object.assign(API, makeFrostAdminHandlers({
  cookieOf,
  roleOf: roleOfAll,
  addressOf: addressOfAll,
  liveConfig: liveCfg,
}))
API['GET /sezs/session/me'] = async (req) => {
  const id = cookieOf(req)
  if (!id) return [200, { ok: false, error: 'no_session' }]
  const rec = sessionLogin.recordOf(id)
  if (rec) {
    if (liveCfg().lcd) {
      try {
        const live = await resolveLiveRole(liveCfg(), { address: rec.address, sessionRole: rec.role })
        if (live?.role) rec.role = live.role
        rec.source = live?.source || rec.source
        rec.live = !!live?.live
      } catch {}
    }
    return [200, staffMeBody(rec)]
  }
  const emailRec = emailAuth.recordOf(id)
  if (emailRec) return [200, emailMeBody(emailRec)]
  const role = L.roleOf(S, id)
  const who = S.identities.find((i) => i.id === id)
  return [200, staffMeBody(null, role, who?.address)]
}
const bleStaff = (req) => requireStaff(req, {
  cookieOf,
  roleOf: roleOfAll,
  addressOf: addressOfAll,
  liveConfig: liveCfg,
})
Object.assign(API, makeBleHandlers({
  store: grantStore,
  isAdmin: isLiveAdmin,
  isUsher: isEventUsher,
  eventIdOf: () => S.v2?.eventId || process.env.SEZS_EVENT_ID || 'speakez-sessions',
  requireStaff: bleStaff,
}))

const server = createServer(async (req, res) => {
  const bad = guard(req)
  if (bad) return send(res, 403, { ok: false, error: bad })
  const rawUrl = req.url || '/'
  const path = rawUrl.split('?')[0].replace(/\/+$/, '') || '/'
  if (req.method === 'GET' && path === '/__splash/api/paid') {
    const c = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('c')
    return send(res, 200, L.paidOf(S, c))
  }
  if (req.method === 'GET' && path === '/sezs/door/config') {
    await L.ensureDoorAuth(S)
    save()
    return send(res, 200, L.doorConfig(S))
  }
  const key = `${req.method} ${path}`
  const h = API[key]
  try {
    if (h) {
      if (req.method === 'POST' && path.startsWith('/__splash/') && req.headers['x-sezs-splash'] !== '1') {
        return send(res, 403, { ok: false, error: 'missing x-sezs-splash' })
      }
      const body = req.method === 'POST' ? await readBody(req) : {}
      if (req.method === 'POST') {
        const refused = refuseSecretFields(body)
        if (refused) return send(res, 400, refused)
      }
      const [code, out, headers] = await h(req, body)
      return send(res, code, out, headers)
    }
    if (path.startsWith('/sezs/')) return send(res, 200, { ok: false, error: 'splash_not_modeled' })
    return send(res, 404, { ok: false, error: 'not_found' })
  } catch (e) {
    return send(res, 500, { ok: false, error: e instanceof Error ? e.message : 'error' })
  }
})

save()
server.listen(PORT, '127.0.0.1', () => {
  console.log(`splash: mock backend on 127.0.0.1:${PORT} (state ${DIR.replace(APP, 'apps/sezs')})`)
  if (ROOTS) {
    console.log('splash: guest-root publisher on (15 min + doors-open). admin FROST 2-of-3 signs the publish.')
    publishRoot('doors-open').catch(() => {})
  } else {
    console.log('splash: guest-root publisher off (no SEZS_V2_ROOT_CONTRACT)')
  }
})
