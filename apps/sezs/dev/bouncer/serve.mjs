/**
 * Loopback IP bouncer in front of the local minirelay and frostd-lite.
 * Adapted from Zafu minibouncer: terminate the client, open our own
 * connection so the backend sees this process, not the caller.
 * Binds 127.0.0.1 only. Logs no tokens, keys, or registration material.
 */
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'

const BIND = '127.0.0.1'
const PORT = Number(process.env.BOUNCER_PORT || 3055)

const FROST_PATHS = new Set([
  '/challenge',
  '/login',
  '/logout',
  '/create_new_session',
  '/send',
  '/receive',
  '/close_session',
  '/list_sessions',
])

const urls = {
  relay: process.env.RELAY_URL || 'http://127.0.0.1:3053',
  frost: process.env.FROST_RELAY_URL || 'http://127.0.0.1:3056',
}

const targetFor = (pathname) => {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (FROST_PATHS.has(p) || p === '/frost/health') return urls.frost
  return urls.relay
}

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
])

const proxy = (req, res) => {
  const url = new URL(req.url || '/', `http://${BIND}`)
  const base = new URL(targetFor(url.pathname))
  const headers = { ...req.headers, host: base.host }
  for (const h of hopByHop) delete headers[h]
  // Do not forward the caller's address. The backend sees the bouncer.
  delete headers['x-forwarded-for']
  delete headers['x-real-ip']
  delete headers['forwarded']

  const opts = {
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port,
    path: url.pathname + url.search,
    method: req.method,
    headers,
  }
  const up = httpRequest(opts, (incoming) => {
    const out = { ...incoming.headers }
    res.writeHead(incoming.statusCode || 502, out)
    incoming.pipe(res)
  })
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'upstream' }))
  })
  req.pipe(up)
}

const handle = (req, res) => {
  const url = new URL(req.url || '/', `http://${BIND}`)
  if (req.method === 'GET' && url.pathname === '/bouncer/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, service: 'sezs-bouncer', bind: BIND }))
    return
  }
  proxy(req, res)
}

export const startBouncer = ({ port = PORT, relayUrl, frostUrl } = {}) =>
  new Promise((resolve, reject) => {
    if (relayUrl) urls.relay = relayUrl
    if (frostUrl) urls.frost = frostUrl
    const server = createServer(handle)
    server.on('error', reject)
    server.listen(port, BIND, () => resolve(server))
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  startBouncer().then((s) => {
    const addr = s.address()
    console.log(`sezs-bouncer ${BIND}:${addr.port} → minirelay ${urls.relay} frostd-lite ${urls.frost}`)
  })
}
