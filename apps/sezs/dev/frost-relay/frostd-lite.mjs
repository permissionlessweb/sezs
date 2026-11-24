/**
 * Loopback subset of frostd's JSON-HTTP session API.
 * Bind 127.0.0.1 only. Not Rotko's production relay.
 */
import { createHash, randomBytes, createPublicKey, verify as verifySig } from 'node:crypto'
import { verifyXeddsa } from '../../src/frost/xeddsa.mjs'
import { createServer } from 'node:http'

const BIND = '127.0.0.1'

const now = () => Date.now()
const hex = (n = 32) => randomBytes(n).toString('hex')

const sessions = new Map()
const tokens = new Map() // token -> { pubkey, at }
const challenges = new Map()

const json = (res, code, body) => {
  const data = body == null ? '' : JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > 1_000_000) {
        reject(new Error('too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('bad_json')) }
    })
    req.on('error', reject)
  })

const bearer = (req) => {
  const h = String(req.headers.authorization || '')
  const m = /^Bearer\s+(\S+)/i.exec(h)
  return m ? m[1] : ''
}

const authed = (req) => tokens.get(bearer(req)) || null

const verifyEd25519 = (pubkeyHex, challenge, signatureHex) => {
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubkeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return verifySig(null, Buffer.from(challenge, 'hex'), key, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}

const handle = async (req, res) => {
  const url = new URL(req.url || '/', `http://${BIND}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (req.method === 'GET' && (path === '/health' || path === '/frost/health')) {
    return json(res, 200, { ok: true, service: 'frostd-lite', bind: BIND })
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'not_found' })

  let body
  try { body = await readBody(req) } catch (e) {
    return json(res, 400, { error: String(e.message || e) })
  }

  if (path === '/challenge') {
    const challenge = hex(32)
    challenges.set(challenge, now())
    return json(res, 200, { challenge })
  }

  if (path === '/login') {
    const challenge = String(body.challenge || '')
    const pubkey = String(body.pubkey || body.publicKey || '')
    const signature = String(body.signature || '')
    if (!challenges.has(challenge)) return json(res, 400, { error: 'bad_challenge' })
    challenges.delete(challenge)
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return json(res, 400, { error: 'bad_pubkey' })
    const ok = verifyXeddsa(pubkey, challenge, signature) || verifyEd25519(pubkey, challenge, signature)
    if (!ok) return json(res, 401, { error: 'bad_signature' })
    const access_token = hex(32)
    tokens.set(access_token, { pubkey: pubkey.toLowerCase(), at: now() })
    return json(res, 200, { access_token })
  }

  const who = authed(req)
  if (!who) return json(res, 401, { error: 'unauthorized' })

  if (path === '/logout') {
    tokens.delete(bearer(req))
    return json(res, 200, {})
  }

  if (path === '/create_new_session') {
    const pubkeys = (body.pubkeys || body.peer_pubkeys || []).map((p) => String(p).toLowerCase())
    if (pubkeys.length < 2) return json(res, 400, { error: 'need_pubkeys' })
    if (!pubkeys.includes(who.pubkey)) return json(res, 400, { error: 'creator_not_in_session' })
    const session_id = hex(16)
    const queues = {}
    for (const pk of pubkeys) queues[pk] = []
    sessions.set(session_id, {
      id: session_id,
      pubkeys,
      messageCount: Number(body.message_count || body.messageCount || 0),
      coordinator: who.pubkey,
      queues,
      createdAt: now(),
      closed: false,
    })
    return json(res, 200, { session_id })
  }

  if (path === '/list_sessions') {
    const mine = [...sessions.values()].filter((s) => s.pubkeys.includes(who.pubkey) && !s.closed)
    return json(res, 200, { session_ids: mine.map((s) => s.id) })
  }

  if (path === '/close_session') {
    const s = sessions.get(String(body.session_id || ''))
    if (!s) return json(res, 404, { error: 'unknown_session' })
    if (s.coordinator !== who.pubkey) return json(res, 403, { error: 'not_coordinator' })
    s.closed = true
    return json(res, 200, {})
  }

  if (path === '/send') {
    const s = sessions.get(String(body.session_id || ''))
    if (!s || s.closed) return json(res, 404, { error: 'unknown_session' })
    if (!s.pubkeys.includes(who.pubkey)) return json(res, 403, { error: 'not_in_session' })
    const msg = String(body.msg || '')
    if (!msg) return json(res, 400, { error: 'empty_msg' })
    let recipients = (body.recipients || []).map((p) => String(p).toLowerCase())
    if (!recipients.length) recipients = [s.coordinator]
    const envelope = { sender: who.pubkey, msg, at: now() }
    for (const r of recipients) {
      if (!s.queues[r]) continue
      s.queues[r].push(envelope)
    }
    return json(res, 200, {})
  }

  if (path === '/receive') {
    const s = sessions.get(String(body.session_id || ''))
    if (!s || s.closed) return json(res, 404, { error: 'unknown_session' })
    if (!s.pubkeys.includes(who.pubkey)) return json(res, 403, { error: 'not_in_session' })
    const pk = who.pubkey
    const msgs = s.queues[pk] || []
    s.queues[pk] = []
    return json(res, 200, { msgs: msgs.map((m) => ({ sender: m.sender, msg: m.msg })) })
  }

  return json(res, 404, { error: 'not_found' })
}

export const startFrostdLite = ({ port }) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handle(req, res).catch(() => json(res, 500, { error: 'internal' }))
    })
    server.on('error', reject)
    server.listen(port, BIND, () => resolve(server))
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.FROSTD_LITE_PORT || 3056)
  startFrostdLite({ port }).then((s) => {
    const addr = s.address()
    console.log(`frostd-lite ${BIND}:${addr.port}`)
  })
}
