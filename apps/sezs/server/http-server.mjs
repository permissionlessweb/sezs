/**
 * Standalone production HTTP server for SEZS sessions & mainnet role reads.
 * Binds 127.0.0.1 only, enforces strict body size/timeouts, secret-field
 * rejection, signed cookies backed by SQLite WAL, and zero dev-only endpoints.
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { refuseSecretFields } from '../dev/splash/guards.mjs'
import { makeMainnetRoleReader, parseContracts } from './mainnet-roles.mjs'
import { makeSessionService, parseAllowedOrigins } from './session-auth.mjs'

const MAX_BODY_BYTES = 8192
const BODY_TIMEOUT_MS = 5000

const send = (res, code, body, headers = {}) => {
  if (res.writableEnded) return
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

const readBoundedJson = (req) =>
  new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const fail = (status, msg) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(Object.assign(new Error(msg), { status }))
    }
    const len = Number(req.headers['content-length'] || 0)
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      req.resume()
      fail(413, 'payload_too_large')
      return
    }
    let size = 0
    const chunks = []
    timer = setTimeout(() => {
      fail(408, 'body_timeout')
    }, BODY_TIMEOUT_MS)
    timer.unref?.()
    req.on('data', (c) => {
      if (settled) return
      size += c.length
      if (size > MAX_BODY_BYTES) {
        req.resume()
        fail(413, 'payload_too_large')
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(Object.assign(new Error('bad_json'), { status: 400 }))
      }
    })
    req.on('error', () => fail(400, 'bad_request'))
  })

export const createSessionHttpServer = ({
  host = process.env.SEZS_SESSION_HOST || '127.0.0.1',
  port = Number(process.env.SEZS_SESSION_PORT || 3058),
  stateDir = process.env.SEZS_STATE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '.session-state'),
  dbPath = process.env.SEZS_SESSION_DB || undefined,
  allowedOrigins = process.env.SEZS_ALLOWED_ORIGINS,
  rpId = process.env.SEZS_WEBAUTHN_RP_ID || '',
  cookieName = process.env.SEZS_COOKIE_NAME || 'sezs_session',
  cookiePath = process.env.SEZS_COOKIE_PATH || '/',
  secureCookie = process.env.SEZS_COOKIE_SECURE === '1'
    ? true
    : process.env.SEZS_COOKIE_SECURE === '0'
      ? false
      : undefined,
  trustProxy = process.env.SEZS_TRUST_PROXY === '1',
  sessionSecret = process.env.SEZS_SESSION_SECRET,
  sessionSecretFile = process.env.SEZS_SESSION_SECRET_FILE,
  lcd = process.env.SEZS_EVENT_LCD || process.env.SEZS_LCD || 'https://api.terp.network',
  contracts = process.env.SEZS_EVENT_CONTRACTS || process.env.SEZS_EVENT_CONTRACT || '',
  fetchImpl = globalThis.fetch,
} = {}) => {
  const parsedContracts = Array.isArray(contracts) ? contracts : parseContracts(contracts)
  const roleReader = parsedContracts.length
    ? makeMainnetRoleReader({ lcd, contracts: parsedContracts, fetchImpl })
    : null

  const service = makeSessionService({
    allowedOrigins: parseAllowedOrigins(allowedOrigins),
    rpId,
    roleReader,
    dbPath: dbPath || join(stateDir, 'sessions.sqlite'),
    stateDir,
    sessionSecret,
    sessionSecretFile,
    cookieName,
    cookiePath,
    secureCookie,
    trustProxy,
  })

  const server = createServer(async (req, res) => {
    const rawUrl = req.url || '/'
    const path = rawUrl.split('?')[0].replace(/\/+$/, '') || '/'
    const handler = service.handlers[`${req.method} ${path}`]
    if (!handler) return send(res, 404, { ok: false, error: 'not_found' })
    try {
      let body = {}
      if (req.method === 'POST') {
        body = await readBoundedJson(req)
        const refused = refuseSecretFields(body)
        if (refused) return send(res, 400, refused)
      }
      const [code, out, headers] = await handler(req, body)
      return send(res, code, out, headers)
    } catch (e) {
      const status = e && typeof e === 'object' && typeof e.status === 'number' ? e.status : 500
      const extra = status === 413 || status === 408 ? { connection: 'close' } : {}
      return send(res, status, { ok: false, error: e instanceof Error ? e.message : 'error' }, extra)
    }
  })

  server.requestTimeout = 10_000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 5000

  return {
    server,
    service,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()))
      }),
    close: () =>
      new Promise((resolve) => {
        service.close()
        server.close(() => resolve())
      }),
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const host = process.env.SEZS_SESSION_HOST || '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1' && process.env.SEZS_ALLOW_NON_LOOPBACK !== '1') {
    console.error('sezs-session: refusing non-loopback bind without SEZS_ALLOW_NON_LOOPBACK=1')
    process.exit(2)
  }
  const srv = createSessionHttpServer({ host })
  const addr = await srv.listen()
  console.log(`sezs-session: listening on ${addr.address}:${addr.port}`)
  const stop = () => {
    void srv.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
