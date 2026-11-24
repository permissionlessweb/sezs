/**
 * WebAuthn relying-party IDs.
 *
 * The RP ID must be a registrable domain suffix of the origin's effective domain.
 * `localhost` is the loopback exception. IP addresses — including `127.0.0.1` and
 * `::1` — are not valid RP IDs. Chrome then throws SecurityError:
 * "This is an invalid domain."
 *
 * Omitting `rp.id` / `rpId` does not help on 127.0.0.1: the default is the
 * effective domain, which is still the IP. Use http://localhost:<port> instead.
 */

export const webAuthnRpId = (
  hostname = typeof location !== 'undefined' ? location.hostname : '',
): string | undefined => {
  const host = String(hostname || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  if (!host) return undefined
  if (host === 'localhost') return 'localhost'
  // IPv4, IPv6, IPv4-mapped IPv6.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return undefined
  if (host.includes(':') || host === '::1' || host.endsWith('%lo0')) return undefined
  return host
}

export const loopbackNeedLocalhost = (
  hostname = typeof location !== 'undefined' ? location.hostname : '',
): boolean => webAuthnRpId(hostname) === undefined && Boolean(hostname)

export const localhostHref = (href = typeof location !== 'undefined' ? location.href : ''): string => {
  const u = new URL(href)
  u.hostname = 'localhost'
  return u.href
}

export const passkeyLoopbackMessage = (port = typeof location !== 'undefined' ? location.port : '3051'): string =>
  `This browser will not make a passkey on an IP address (127.0.0.1 is not a valid WebAuthn RP ID). Open http://localhost:${port || '3051'} — same app, valid domain.`

/** Redirect loopback IPs to localhost, or throw a clear error if already off a valid RP ID. */
export const prepareWebAuthn = (): { rpId: string } => {
  const hostname = typeof location !== 'undefined' ? location.hostname : ''
  const rpId = webAuthnRpId(hostname)
  if (rpId) return { rpId }
  if (typeof location !== 'undefined' && loopbackNeedLocalhost(hostname) && hostname !== 'localhost') {
    const next = localhostHref()
    if (next !== location.href) location.replace(next)
  }
  throw new Error(passkeyLoopbackMessage())
}
