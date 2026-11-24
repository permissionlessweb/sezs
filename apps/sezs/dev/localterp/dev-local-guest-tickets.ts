// @ts-nocheck
// Local-only helper for the live phone test. Do not commit. Do not log secrets.
import { readFileSync } from 'node:fs'
import type { NextApiRequest, NextApiResponse } from 'next'

const FILE = '/tmp/sezs-session-walkthrough/unused-tickets-t47u.json'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const isLoopback = (req: NextApiRequest) => {
  const ip = String(req.socket?.remoteAddress || '')
  const host = String(req.headers.host || '').split(':')[0]
  return LOOPBACK.has(ip) && (host === '127.0.0.1' || host === 'localhost')
}

const loadRecords = async () => {
  const { ticketRecord, fromHex } = await import('../../src/ticket/commitment.mjs')
  // Commitments were minted with ticket v2 wasm (loadTicketV2Node), not the JS
  // poseidon helper. Use the stored leaf and encode the same sezs3 payload
  // GuestTicket would show. v2 match was verified offline for these 4 tickets.
  const data = JSON.parse(readFileSync(FILE, 'utf8'))
  const tickets = data.tickets || data
  return tickets.map((t: { secret: string; sku: string; eventId: string; commitment: string }) => {
    const rec = ticketRecord({
      secret: fromHex(t.secret),
      sku: t.sku,
      eventId: t.eventId,
      commitment: fromHex(t.commitment),
    } as Parameters<typeof ticketRecord>[0])
    if (rec.commitmentHex !== String(t.commitment).toLowerCase()) {
      throw new Error('commitment_mismatch')
    }
    if (!String(rec.qr || '').startsWith('sezs3')) {
      throw new Error('bad_qr')
    }
    return rec
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('cache-control', 'no-store')
  if (!isLoopback(req)) {
    res.status(403).json({ ok: false, error: 'loopback_only' })
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method' })
    return
  }
  try {
    const tickets = await loadRecords()
    res.status(200).json({ ok: true, count: tickets.length, tickets })
  } catch {
    res.status(500).json({ ok: false, error: 'unavailable' })
  }
}
