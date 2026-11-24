/**
 * Firm rule: the ticket backend never learns the secret.
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */

/** Request keys the invoice, payment, envelope, and admin APIs must refuse. */
export const FORBIDDEN_SECRET_KEYS = [
  'secret',
  'k',
  'secrethex',
  'secret_hex',
  'ticketsecret',
  'ticket_secret',
  'seed',
  'seedhex',
  'seed_hex',
  'plaintext',
  'mnemonic',
  'privatekey',
  'private_key',
]

const norm = (key) => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const forbiddenSet = new Set(FORBIDDEN_SECRET_KEYS.map(norm))

export const secretFieldName = (key) => forbiddenSet.has(norm(key))

/**
 * Walk a JSON-like body. Returns the first forbidden key path, or null.
 * The door consume path may pass a QR in `ticket` — that is a presentation,
 * not a store of a field named secret / k.
 */
export const findForbiddenSecretField = (body, { maxDepth = 6 } = {}) => {
  const walk = (v, path, depth) => {
    if (v == null || depth > maxDepth) return null
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = walk(v[i], `${path}[${i}]`, depth + 1)
        if (hit) return hit
      }
      return null
    }
    if (typeof v !== 'object') return null
    for (const [k, val] of Object.entries(v)) {
      if (secretFieldName(k)) return path ? `${path}.${k}` : k
      const hit = walk(val, path ? `${path}.${k}` : k, depth + 1)
      if (hit) return hit
    }
    return null
  }
  return walk(body, '', 0)
}

export const refuseSecretFields = (body) => {
  const field = findForbiddenSecretField(body)
  if (!field) return null
  return {
    ok: false,
    error: 'secret_refused',
    message: 'Refused: the ticket backend does not accept a ticket secret.',
    field,
  }
}

/** Redact raw QR payloads and k= values from log lines. Never log a secret. */
export const scrubLog = (msg) =>
  String(msg)
    .replace(/sezs1:\/\/ticket\?[^\s"']*/gi, 'sezs1://ticket?[redacted]')
    .replace(/([?&]k=)[0-9a-f]{64}/gi, '$1[redacted]')
    .replace(/sezsreg_[0-9a-f]{64}/gi, 'sezsreg_[redacted]')
    .replace(/([?&]c=)sezsreg_[0-9a-f]{64}/gi, '$1[redacted]')

export const PUBLIC_ENVELOPE_KEYS = [
  'commitment',
  'invoiceId',
  'ciphertext',
  'ephemeral_pubkey',
  'pq_epoch',
  'pq_suite',
  'origin',
  'postQuantum',
  'transferredAt',
]
