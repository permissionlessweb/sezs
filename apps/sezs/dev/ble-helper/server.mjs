#!/usr/bin/env node
/**
 * Thin loopback helper for usher BLE.
 *
 * This process is the desktop side of the Transport interface. A later
 * native GATT central (the KMS ble-scan.swift / noise.go pattern) can
 * POST decrypted signed frames to /v1/ingest. For now the server also
 * accepts simulated phones so the web modal and e2e can run without a
 * radio.
 *
 * Bind: 127.0.0.1:3061 only.
 */
import { createServer } from 'node:http'

const HOST = '127.0.0.1'
const PORT = Number(process.env.SEZS_BLE_HELPER_PORT || 3061)
const LOOP = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const state = { devices: new Map(), queues: new Map() }

const send = (res, code, body) => {
  const data = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(data)
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (!chunks.length) return resolve({})
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
  })
  req.on('error', reject)
})

const publicDevice = (d) => ({
  id: d.id,
  label: d.label,
  publicHex: d.publicHex,
  noiseHex: d.noiseHex,
  status: d.status,
  lastSeen: d.lastSeen,
})

const server = createServer(async (req, res) => {
  if (!LOOP.has(req.socket.remoteAddress)) return send(res, 403, { ok: false, error: 'not_loopback' })
  const path = (req.url || '/').split('?')[0]
  const key = `${req.method} ${path}`
  try {
    if (key === 'GET /health') return send(res, 200, { ok: true, service: 'sezs-ble-helper' })
    if (key === 'GET /v1/devices') return send(res, 200, { ok: true, devices: [...state.devices.values()].map(publicDevice) })
    const body = req.method === 'POST' ? await readBody(req) : {}
    if (key === 'POST /v1/simulate') {
      const id = body.id || `sim-${state.devices.size + 1}`
      const d = {
        id,
        label: body.label || id,
        publicHex: body.publicHex,
        noiseHex: body.noiseHex,
        status: 'disconnected',
        lastSeen: 0,
      }
      state.devices.set(id, d)
      state.queues.set(id, state.queues.get(id) || [])
      return send(res, 200, { ok: true, device: publicDevice(d) })
    }
    if (key === 'POST /v1/connect') {
      const d = state.devices.get(body.id)
      if (!d) return send(res, 200, { ok: false, error: 'unknown_device' })
      d.status = 'connected'
      d.lastSeen = Math.floor(Date.now() / 1000)
      return send(res, 200, { ok: true, device: publicDevice(d) })
    }
    if (key === 'POST /v1/disconnect') {
      const d = state.devices.get(body.id)
      if (d) d.status = 'disconnected'
      return send(res, 200, { ok: true })
    }
    if (key === 'POST /v1/ingest') {
      const id = body.id || body.deviceId
      if (id && !state.devices.has(id)) {
        state.devices.set(id, { id, label: id, publicHex: body.publicHex, noiseHex: body.noiseHex, status: 'connected', lastSeen: 0 })
        state.queues.set(id, [])
      }
      const qid = id || [...state.devices.keys()][0]
      if (!qid) return send(res, 200, { ok: false, error: 'no_device' })
      const d = state.devices.get(qid)
      d.lastSeen = Math.floor(Date.now() / 1000)
      d.status = 'connected'
      const q = state.queues.get(qid) || []
      q.push(body.frame || body)
      state.queues.set(qid, q)
      return send(res, 200, { ok: true })
    }
    const next = path.match(/^\/v1\/devices\/([^/]+)\/next$/)
    if (req.method === 'GET' && next) {
      const id = decodeURIComponent(next[1])
      const q = state.queues.get(id) || []
      const frame = q.shift() || null
      return send(res, 200, frame ? { ok: true, frame } : { ok: true, frame: null })
    }
    const ack = path.match(/^\/v1\/devices\/([^/]+)\/ack$/)
    if (req.method === 'POST' && ack) return send(res, 200, { ok: true })
    return send(res, 404, { ok: false, error: 'not_found' })
  } catch (e) {
    return send(res, 200, { ok: false, error: 'bad_request' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`sezs-ble-helper listening on http://${HOST}:${PORT}`)
})
