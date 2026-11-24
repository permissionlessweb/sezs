import { CashAppOrder } from './schema'
import { CASHTAG_COPY, LIST_CENTS, SKU, randomPayRef } from './payRef'

const KEY = 'sezs-cashapp-orders-v1'

type Bag = { orders: CashAppOrder[] }

const empty = (): Bag => ({ orders: [] })

function load(): Bag {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const b = JSON.parse(raw) as Bag
    return { orders: b.orders || [] }
  } catch {
    return empty()
  }
}

function save(b: Bag) {
  localStorage.setItem(KEY, JSON.stringify(b))
}

export function createOrder(buyerBinding: string): CashAppOrder {
  const b = load()
  const order: CashAppOrder = {
    orderId: randomPayRef().replace('cmt_', 'ord_'),
    sku: SKU,
    amountCents: LIST_CENTS,
    cashtag: CASHTAG_COPY,
    payRef: randomPayRef(),
    buyerBinding,
    status: 'pending_payment',
    expiresAt: Date.now() + 30 * 60 * 1000,
  }
  b.orders.unshift(order)
  save(b)
  return order
}

export function latestOpen(buyerBinding: string): CashAppOrder | null {
  return (
    load().orders.find(
      (o) =>
        o.buyerBinding === buyerBinding &&
        (o.status === 'pending_payment' || o.status === 'paid')
    ) || null
  )
}

export type ReceiptFile = {
  payRef: string
  amountCents: number
  txId: string
  nullifier: string
  proven?: boolean
}

export function applyReceipt(
  order: CashAppOrder,
  rec: ReceiptFile
): CashAppOrder | { error: string } {
  if (rec.payRef !== order.payRef) return { error: 'payRef mismatch' }
  if (rec.amountCents < order.amountCents) return { error: 'amount too low' }
  if (Date.now() > order.expiresAt) return { error: 'order expired' }
  const b = load()
  if (b.orders.some((o) => o.nullifier === rec.nullifier && o.orderId !== order.orderId)) {
    return { error: 'nullifier already used' }
  }
  const next: CashAppOrder = {
    ...order,
    status: rec.proven ? 'ticket_issued' : 'paid',
    txId: rec.txId,
    nullifier: rec.nullifier,
    issuedAt: Date.now(),
    proofCID: rec.proven ? rec.txId : undefined,
  }
  b.orders = b.orders.map((o) => (o.orderId === order.orderId ? next : o))
  save(b)
  return next
}
