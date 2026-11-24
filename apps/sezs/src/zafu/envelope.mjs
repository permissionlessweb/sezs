/**
 * Ticket envelope: what is sealed to a ZID, and the public blob the backend may store.
 * The backend sees only the public envelope, never the inner payload.
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { toHex } from '../ticket/poseidon.mjs'

export const ENVELOPE_TYPE = 'sezs-ticket-envelope-v1'

export const innerPayload = ({ secret, eventId, sku, invoiceNonce, invoiceId, commitmentHex }) => ({
  typ: ENVELOPE_TYPE,
  eventId,
  sku,
  invoiceNonce: invoiceNonce || null,
  invoiceId: invoiceId || null,
  commitmentHex,
  secretHex: toHex(secret instanceof Uint8Array ? secret : secret),
})

export const encodeInner = (inner) => new TextEncoder().encode(JSON.stringify(inner))

export const decodeInner = (bytes) => {
  const obj = JSON.parse(new TextDecoder().decode(bytes))
  if (!obj || obj.typ !== ENVELOPE_TYPE) throw new Error('bad_envelope')
  if (!/^[0-9a-f]{64}$/i.test(obj.secretHex || '')) throw new Error('bad_envelope')
  if (!/^[0-9a-f]{64}$/i.test(obj.commitmentHex || '')) throw new Error('bad_envelope')
  return obj
}

/** Public record the backend is allowed to persist.
 * @param {{ commitment: string, invoiceId?: string, ciphertext: string, ephemeral_pubkey?: string, pq_epoch?: number, pq_suite?: string|null, origin?: string|null, postQuantum?: boolean }} opts
 */
export const publicEnvelope = ({
  commitment,
  invoiceId,
  ciphertext,
  ephemeral_pubkey,
  pq_epoch,
  pq_suite,
  origin,
  postQuantum,
}) => {
  if (!/^[0-9a-f]{64}$/i.test(String(commitment || ''))) throw new Error('bad_commitment')
  if (!ciphertext) throw new Error('bad_ciphertext')
  return {
    commitment: String(commitment).toLowerCase(),
    invoiceId: invoiceId || null,
    ciphertext: String(ciphertext),
    ephemeral_pubkey: ephemeral_pubkey == null ? '' : String(ephemeral_pubkey),
    pq_epoch: pq_epoch == null ? 0 : Number(pq_epoch),
    pq_suite: pq_suite || null,
    origin: origin || null,
    postQuantum: !!postQuantum,
  }
}
