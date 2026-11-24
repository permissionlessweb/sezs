/**
 * Test and dev must never talk to a non-loopback zirc / ZID relay,
 * including the Rotko production relay.
 */
export const FORBIDDEN_RELAY_HOSTS = ['zcash.rotko.net']

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'])

export const relayHostOf = (endpoint) => {
  const raw = String(endpoint || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw, 'http://127.0.0.1')
    return (u.hostname || '').toLowerCase()
  } catch {
    return ''
  }
}

export const isLoopbackHost = (host) => {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  return LOOPBACK.has(h) || h.endsWith('.localhost')
}

/**
 * Returns an error string if this endpoint must not be used in test/dev.
 * Production Rotko and any non-loopback host are refused.
 */
export const refuseRelayEndpoint = (endpoint, { purpose = 'test/dev' } = {}) => {
  const host = relayHostOf(endpoint)
  if (!host) return `refused: ${purpose} relay endpoint is missing`
  if (FORBIDDEN_RELAY_HOSTS.includes(host) || host.endsWith('.rotko.net')) {
    return `refused: ${purpose} must not use the production relay (${host})`
  }
  if (!isLoopbackHost(host)) {
    return `refused: ${purpose} relay must be loopback, not ${host}`
  }
  return null
}

export const assertLocalRelay = (endpoint, purpose) => {
  const err = refuseRelayEndpoint(endpoint, { purpose })
  if (err) throw new Error(err)
  return endpoint
}

export const DEFAULT_LAB_RELAY = 'http://127.0.0.1:3053'
