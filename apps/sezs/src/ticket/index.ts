export {
  EVENT_ID,
  DEFAULT_SKU,
  MEMO_PREFIX,
  newSecret,
  newTicketMaterial,
  deriveTicketSecret,
  fitSecretToField,
  SECRET_KDF_DOMAIN,
  commitmentOf,
  nullifierOf,
  memoOf,
  parseMemo,
  qrPayload,
  parseQr,
  readStore,
  readTickets,
  writeStore,
  writeTickets,
  mergeTickets,
  mergeOne,
  setTicketStatus,
  toHex,
  fromHex,
} from './commitment.mjs'
import { ticketRecord as ticketRecordRaw } from './commitment.mjs'
export { buildZip321, parseZip321 } from './zip321.mjs'
export { TicketQr } from './Qr'

export type TicketRecord = {
  version: 1 | 2
  eventId: string
  sku: string
  invoiceNonce?: string | null
  secretHex: string
  commitmentHex: string
  rail: string | null
  invoiceId: string | null
  dest: string | null
  memo: string
  uri: string | null
  qr: string
  sealed?: unknown
  alphaNonce?: string | null
  bundleB64?: string | null
  status?: 'unused' | 'consumed' | 'transferred'
  paidAt?: number | null
  transferredTo?: string | null
}

export const ticketRecord = (opts: {
  secret: Uint8Array
  sku?: string
  eventId?: string
  rail?: string | null
  invoiceId?: string | null
  invoiceNonce?: string | null
  dest?: string | null
  memo?: string
  uri?: string | null
  sealed?: unknown
  commitment?: Uint8Array
  alphaNonce?: string | null
  bundleB64?: string | null
}): TicketRecord => ticketRecordRaw(opts as any) as TicketRecord
