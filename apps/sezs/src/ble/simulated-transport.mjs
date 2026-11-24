/**
 * In-process Transport for tests and for the modal's simulated phone.
 * Isomorphic: Event-target style, no node:events.
 */
import { TRANSPORTS } from './transport.mjs'
import { newDeviceKey, hex } from './messages.mjs'

export const createBrowserSimulatedTransport = ({ label = 'sim-phone' } = {}) => {
  const listeners = new Map()
  const emit = (type, detail) => {
    for (const fn of listeners.get(type) || []) fn(detail)
  }
  const on = (type, fn) => {
    const arr = listeners.get(type) || []
    arr.push(fn)
    listeners.set(type, arr)
    return () => {
      listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn))
    }
  }
  const phones = new Map()
  let seqGen = 0
  const addPhone = (partial = {}) => {
    const device = partial.device || newDeviceKey()
    const id = partial.id || `sim-${++seqGen}`
    const noiseStatic = partial.noiseStatic || crypto.getRandomValues(new Uint8Array(32))
    const phone = {
      id,
      label: partial.label || `${label} ${id}`,
      device,
      noiseStatic,
      publicHex: device.publicHex,
      noiseHex: hex(noiseStatic),
      status: 'disconnected',
      lastSeen: 0,
    }
    phones.set(id, phone)
    return phone
  }
  return {
    id: TRANSPORTS.simulated,
    phones,
    addPhone,
    scan: async () => [...phones.values()].map((p) => ({
      id: p.id, label: p.label, publicHex: p.publicHex, noiseHex: p.noiseHex, status: p.status, lastSeen: p.lastSeen,
    })),
    connect: async (hint) => {
      const phone = typeof hint === 'string' ? phones.get(hint) : (hint && phones.get(hint.id)) || addPhone(hint || {})
      phone.status = 'connected'
      phone.lastSeen = Math.floor(Date.now() / 1000)
      const waiters = []
      const queued = []
      const unsub = on(`frame:${phone.id}`, (frame) => {
        const w = waiters.shift()
        if (w) w(frame)
        else queued.push(frame)
      })
      return {
        id: phone.id,
        label: phone.label,
        kind: TRANSPORTS.simulated,
        deviceSignHex: phone.publicHex,
        deviceNoiseHex: phone.noiseHex,
        status: () => phone.status,
        lastSeen: () => phone.lastSeen,
        nextFrame: () => queued.length
          ? Promise.resolve(queued.shift())
          : new Promise((resolve) => waiters.push(resolve)),
        close: async () => { phone.status = 'disconnected'; unsub() },
      }
    },
    injectFrame: (phoneId, envelope) => {
      const phone = phones.get(phoneId)
      if (phone) phone.lastSeen = Math.floor(Date.now() / 1000)
      emit(`frame:${phoneId}`, envelope)
    },
    stop: async () => { for (const p of phones.values()) p.status = 'disconnected' },
  }
}

export const createSimulatedTransport = createBrowserSimulatedTransport
