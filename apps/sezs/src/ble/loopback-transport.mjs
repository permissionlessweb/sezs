/**
 * Talks to sezs-outpost on loopback. The outpost is the GATT
 * central and holds Noise XX; this client only reads already-decrypted
 * signed frames and posts pairing / ack commands.
 */
import { DEFAULT_HELPER, TRANSPORTS } from './transport.mjs'

const json = async (res) => {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { ok: false, error: 'bad_json', raw: text } }
}

export const createLoopbackHelperTransport = ({ base = DEFAULT_HELPER } = {}) => {
  const url = String(base || DEFAULT_HELPER).replace(/\/+$/, '')
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(url)) {
    throw new Error('helper must be loopback')
  }
  const get = (path) => fetch(url + path, { headers: { accept: 'application/json' } }).then(json)
  const post = (path, body) => fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(json)

  return {
    id: TRANSPORTS.loopbackHelper,
    base: url,
    scan: async () => {
      const r = await get('/v1/devices')
      if (!r.ok) throw new Error(r.error || 'helper_scan_failed')
      return r.devices || []
    },
    connect: async (hint) => {
      const r = await post('/v1/connect', { id: hint.id || hint })
      if (!r.ok) throw new Error(r.error || 'helper_connect_failed')
      const id = r.device?.id || hint.id || hint
      return {
        id,
        label: r.device?.label || id,
        kind: TRANSPORTS.loopbackHelper,
        deviceSignHex: r.device?.publicHex,
        deviceNoiseHex: r.device?.noiseHex,
        status: () => r.device?.status || 'connected',
        lastSeen: () => r.device?.lastSeen || 0,
        nextFrame: async () => {
          const f = await get(`/v1/devices/${encodeURIComponent(id)}/next`)
          if (!f.ok) throw new Error(f.error || 'no_frame')
          return f.frame
        },
        ack: (body) => post(`/v1/devices/${encodeURIComponent(id)}/ack`, body),
        close: async () => { await post('/v1/disconnect', { id }).catch(() => {}) },
      }
    },
    ingest: (frame) => post('/v1/ingest', frame),
    stop: async () => {},
  }
}
