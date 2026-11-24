/**
 * Standalone self-hosted HTTP server for SEZS email auth.
 * Binds 127.0.0.1 only by default, backed by SQLite WAL + 0600 file sink.
 * Enforces strict request body size (4 KiB), body/header timeouts, secret-field
 * rejection, and horizontal-worker safety behind the single existing nginx.
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeEmailAuth, parseAllowedOrigins } from './email-auth.mjs'
import { createEmailProviderFromEnv } from './email-sink.mjs'
import { refuseSecretFields } from './guards.mjs'

const MAX_BODY_BYTES = 4096
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

export const createEmailAuthHttpServer = ({
  host = process.env.SEZS_EMAIL_HOST || '127.0.0.1',
  port = Number(process.env.SEZS_EMAIL_PORT || 3058),
  stateDir = process.env.SEZS_SPLASH_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.splash'),
  dbPath = process.env.SEZS_EMAIL_DB || undefined,
  allowedOrigins = process.env.SEZS_EMAIL_ALLOWED_ORIGINS,
  sendEmail,
  powBits = Number(process.env.SEZS_EMAIL_POW_BITS || 0),
  adaptivePowThreshold = Number(process.env.SEZS_EMAIL_POW_AFTER || 8),
  trustProxy = process.env.SEZS_TRUST_PROXY === '1',
  sessionSecret = process.env.SEZS_EMAIL_SESSION_SECRET,
} = {}) => {
  const provider = sendEmail ? { sendEmail } : createEmailProviderFromEnv({ fallbackDir: join(stateDir, 'email-outbox') })
  const auth = makeEmailAuth({
    allowedOrigins: parseAllowedOrigins(allowedOrigins),
    sendEmail: provider.sendEmail,
    dbPath: dbPath || join(stateDir, 'email-auth.sqlite'),
    stateDir,
    sessionSecret,
    powBits,
    adaptivePowThreshold,
    trustProxy,
  })

  const server = createServer(async (req, res) => {
    const rawUrl = req.url || '/'
    const path = rawUrl.split('?')[0].replace(/\/+$/, '') || '/'
    const handler = auth.handlers[`${req.method} ${path}`]
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
    auth,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()))
      }),
    close: () =>
      new Promise((resolve) => {
        auth.close()
        server.close(() => resolve())
      }),
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const host = process.env.SEZS_EMAIL_HOST || '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1' && process.env.SEZS_ALLOW_NON_LOOPBACK !== '1') {
    console.error('email-server: refusing non-loopback bind without SEZS_ALLOW_NON_LOOPBACK=1')
    process.exit(2)
  }
  const srv = createEmailAuthHttpServer({ host })
  const addr = await srv.listen()
  console.log(`email-auth: self-hosted SQLite server on ${addr.address}:${addr.port}`)
  const stop = () => {
    void srv.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
