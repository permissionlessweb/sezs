/** Cash App zkEmail order + ticket. Spec: sezs-docs/sprint/tickets/CASHAPP-ZKEMAIL.md */

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'ticket_issued'
  | 'redeemed'
  | 'expired'
  | 'paid_unproven'

export type CashAppOrder = {
  orderId: string
  sku: string
  amountCents: number
  cashtag: string
  payRef: string
  buyerBinding: string
  status: OrderStatus
  txId?: string
  nullifier?: string
  proofCID?: string
  issuedAt?: number
  expiresAt: number
}

export type CashAppTicket = {
  ticketId: string
  orderId: string
  sku: string
  amountCents: number
  txId: string
  buyerBinding: string
  proofCID: string
  merchantSig: string
  expiresAt: number
}

export const CASHAPP_NULLIFIER_PREFIX = 'cashapp-v1'
