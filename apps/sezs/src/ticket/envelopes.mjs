/**
 * Ciphertext-only ticket envelopes. The backend never opens them.
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { parseMemo } from './commitment.mjs'
import { toHex } from './poseidon.mjs'
import { refuseSecretFields } from './guards.mjs'

const hexC = (raw) => {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase().replace(/^0x/, '')
  if (/^[0-9a-f]{64}$/.test(s)) return s
  const fromMemo = parseMemo(String(raw))
  return fromMemo ? toHex(fromMemo) : null
}

const publicOf = (e) => ({
  commitment: e.commitment,
  invoiceId: e.invoiceId || null,
  ciphertext: e.ciphertext,
  ephemeral_pubkey: e.ephemeral_pubkey || '',
  pq_epoch: e.pq_epoch ?? 0,
  pq_suite: e.pq_suite || null,
  origin: e.origin || null,
  postQuantum: !!e.postQuantum,
  storedAt: e.storedAt,
})

export const ensureEnvelopes = (s) => {
  if (!Array.isArray(s.envelopes)) s.envelopes = []
  if (!Array.isArray(s.invoices)) s.invoices = []
  if (!Array.isArray(s.log)) s.log = []
  return s
}

const log = (s, kind, msg) => {
  s.log.push({ t: Date.now(), kind, msg: String(msg).slice(0, 240) })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}

export const putEnvelope = (s, body, now = Date.now()) => {
  const refused = refuseSecretFields(body)
  if (refused) {
    log(s, 'refuse', 'envelope refused: a secret field was present')
    return refused
  }
  ensureEnvelopes(s)
  let commitment = hexC(body?.commitment)
  if (!commitment && body?.invoiceId) {
    const inv = s.invoices.find((i) => i.id === body.invoiceId)
    commitment = inv?.commitment || null
  }
  if (!commitment) return { ok: false, error: 'bad_commitment' }
  if (!body?.ciphertext) return { ok: false, error: 'bad_ciphertext' }
  const rec = {
    commitment,
    invoiceId: body.invoiceId || s.invoices.find((i) => i.commitment === commitment)?.id || null,
    ciphertext: String(body.ciphertext),
    ephemeral_pubkey: body.ephemeral_pubkey == null ? '' : String(body.ephemeral_pubkey),
    pq_epoch: body.pq_epoch == null ? 0 : Number(body.pq_epoch),
    pq_suite: body.pq_suite || null,
    origin: body.origin || null,
    postQuantum: !!body.postQuantum || body.ephemeral_pubkey === '',
    storedAt: now,
  }
  s.envelopes.push(rec)
  log(s, 'pay', `stored sealed envelope for C ${commitment.slice(0, 8)}… · pq_epoch ${rec.pq_epoch}`)
  return { ok: true, envelope: publicOf(rec), count: s.envelopes.filter((e) => e.commitment === commitment).length }
}

export const getEnvelopes = (s, raw) => {
  ensureEnvelopes(s)
  let c = hexC(raw)
  if (!c && raw) {
    const inv = s.invoices.find((i) => i.id === raw)
    c = inv?.commitment || null
  }
  if (!c) return { ok: false, error: 'bad_commitment' }
  return { ok: true, commitment: c, envelopes: s.envelopes.filter((e) => e.commitment === c).map(publicOf) }
}

export const publicEnvelopes = (s) => {
  ensureEnvelopes(s)
  return s.envelopes.map(publicOf)
}
