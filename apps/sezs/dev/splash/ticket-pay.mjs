/**
 * Splash loopback watcher: invoice by memo commitment C, guest tree, door consume
 * by holder consent (live handshake or printed pre-authorization).
 * Never stores the ticket secret. No names or buyer addresses.
 * See apps/sezs/docs/BACKEND-ROLE.md and apps/sezs/docs/DOOR-PRIVACY-DECISION.md.
 */
import { makeTree, toHex, fromHex } from '../../src/ticket/poseidon.mjs'
import { parseMemo, memoOf, EVENT_ID, DEFAULT_SKU } from '../../src/ticket/commitment.mjs'
import {
  normalizeOrigin,
  parseChallengeUri,
  parseAdmitUri,
  parseApproveUri,
  isSecretTicketUri,
  encodeChallengeUri,
  challengeBytes,
  printAuthBytes,
  verifyEd25519,
  doorAuthKeypair,
  generateDoorAuthSeed,
  CHALLENGE_TTL_MS,
} from '../../src/ticket/auth.mjs'
import { scrubLog } from './guards.mjs'
import { buildZip321 } from '../../src/ticket/zip321.mjs'
import { zecUriLabOk, penumbraDestOk } from '../../src/pay/network.ts'

export const LAB_ZEC = 'uregtest1labonlydonotsendrealfunds00000000000000000000000000'
export const LAB_UM = 'penumbratest1labonlydonotsendrealfunds00000000000000000000'
/** Local-session dests when SEZS_TICKET_* is set; otherwise the dummy lab strings. */
export const ticketZecDest = () => process.env.SEZS_TICKET_ZEC_DEST || LAB_ZEC
export const ticketUmDest = () => process.env.SEZS_TICKET_UM_DEST || LAB_UM
export const LIST_CENTS = 4000
export const DISCOUNT_BPS = { zec: 5000, penumbra: 5000, eth: 0, base: 0 }
export const EVENT_DOMAIN = 'http://127.0.0.1:3051'

export const priceCents = (rail) =>
  Math.floor((LIST_CENTS * (10000 - (DISCOUNT_BPS[rail] || 0))) / 10000)

const emptyRoot = () => toHex(makeTree().rootBytes())

/** Door-auth private keys live here, never in public state or logs. */
const doorPrivByPub = new Map()

export const ensurePay = (s) => {
  if (!Array.isArray(s.invoices)) s.invoices = []
  if (!Array.isArray(s.leaves)) s.leaves = []
  if (!s.spent || typeof s.spent !== 'object') s.spent = {}
  if (!s.challenges || typeof s.challenges !== 'object') s.challenges = {}
  if (!s.guestRoot) s.guestRoot = emptyRoot()
  if (!s.eventDomain) s.eventDomain = EVENT_DOMAIN
  return s
}

export const ensureDoorAuth = async (s, { seed } = {}) => {
  ensurePay(s)
  if (s.doorAuthPublic && doorPrivByPub.has(s.doorAuthPublic)) return s.doorAuthPublic
  const pair = await doorAuthKeypair(seed || generateDoorAuthSeed())
  s.doorAuthPublic = pair.publicHex
  doorPrivByPub.set(pair.publicHex, true)
  return s.doorAuthPublic
}

const rebuildRoot = (s) => {
  const tree = makeTree()
  for (const leaf of s.leaves) tree.append(fromHex(leaf.commitment))
  s.guestRoot = toHex(tree.rootBytes())
  return s.guestRoot
}

const log = (s, kind, msg) => {
  s.log.push({ t: Date.now(), kind, msg: scrubLog(String(msg)).slice(0, 240) })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}

const hexC = (raw) => {
  if (!raw) return null
  const text = String(raw).trim().toLowerCase().replace(/^0x/, '')
  if (/^[0-9a-f]{64}$/.test(text)) return text
  const fromMemo = parseMemo(String(raw))
  return fromMemo ? toHex(fromMemo) : null
}

const hex32 = (raw) => {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
  return /^[0-9a-f]{64}$/.test(text) ? text : null
}

const domainOf = (s, fallback) =>
  normalizeOrigin(fallback || s.eventDomain || EVENT_DOMAIN) || EVENT_DOMAIN

export const issueInvoice = (s, { rail, commitment, sku, eventId, ticketPubkey, nullifier, now = Date.now() } = {}) => {
  ensurePay(s)
  const r = String(rail || '')
  if (r !== 'zec' && r !== 'penumbra') return { ok: false, error: 'bad_rail' }
  const c = hexC(commitment)
  if (!c) return { ok: false, error: 'bad_commitment' }
  // v2 is live: do not record N or a ticket public key. Those were door correlators.
  if ((ticketPubkey != null && ticketPubkey !== '') || (nullifier != null && nullifier !== '')) {
    return { ok: false, error: 'v2_no_correlators', fields: ['ticketPubkey', 'nullifier'].filter((k) => ({ ticketPubkey, nullifier }[k] != null && { ticketPubkey, nullifier }[k] !== '')) }
  }
  if (s.invoices.some((i) => i.commitment === c && i.status !== 'void')) {
    const existing = s.invoices.find((i) => i.commitment === c && i.status !== 'void')
    return { ok: true, invoice: publicInvoice(existing), reused: true }
  }
  const amountCents = priceCents(r)
  const dest = r === 'zec' ? LAB_ZEC : LAB_UM
  if (r === 'zec' && !zecUriLabOk(`zcash:${dest}`)) return { ok: false, error: 'bad_dest' }
  if (r === 'penumbra' && !penumbraDestOk(dest)) return { ok: false, error: 'bad_dest' }
  const memo = memoOf(fromHex(c))
  const uri =
    r === 'zec'
      ? buildZip321({ address: dest, memo, message: 'Speakez Sessions' })
      : null
  if (uri && !zecUriLabOk(uri)) return { ok: false, error: 'bad_uri' }
  const invoice = {
    id: `inv-${now.toString(36)}-${c.slice(0, 6)}`,
    rail: r,
    sku: sku || DEFAULT_SKU,
    eventId: eventId || EVENT_ID,
    amountCents,
    commitment: c,
    dest,
    memo,
    uri,
    status: 'pending',
    issuedAt: now,
    paidAt: null,
    leafIndex: null,
  }
  s.invoices.push(invoice)
  log(s, 'pay', `invoice ${invoice.id} · ${r} · ${amountCents} cents · memo C ${c.slice(0, 8)}…`)
  return { ok: true, invoice: publicInvoice(invoice) }
}

export const publicInvoice = (inv) => ({
  id: inv.id,
  rail: inv.rail,
  sku: inv.sku,
  eventId: inv.eventId,
  amountCents: inv.amountCents,
  commitment: inv.commitment,
  dest: inv.dest,
  memo: inv.memo,
  uri: inv.uri || null,
  status: inv.status,
  paidAt: inv.paidAt,
  leafIndex: inv.leafIndex,
})

export const markPaidByCommitment = (s, raw, { amountCents, now = Date.now() } = {}) => {
  ensurePay(s)
  const c = hexC(raw)
  if (!c) return { ok: false, error: 'bad_commitment' }
  const inv = [...s.invoices].reverse().find((i) => i.commitment === c && i.status !== 'void')
  if (!inv) return { ok: false, error: 'unknown_invoice' }
  if (inv.status === 'paid') return { ok: true, invoice: publicInvoice(inv), already: true }
  if (amountCents != null && Number(amountCents) !== inv.amountCents) {
    log(s, 'refuse', `payment for ${inv.id} refused: amount mismatch`)
    return { ok: false, error: 'amount_mismatch' }
  }
  inv.status = 'paid'
  inv.paidAt = now
  if (!s.leaves.some((l) => l.commitment === c)) {
    const leaf = {
      commitment: c,
      invoiceId: inv.id,
      sku: inv.sku,
      eventId: inv.eventId,
      ticketPubkey: inv.ticketPubkey || null,
    }
    s.leaves.push(leaf)
    inv.leafIndex = s.leaves.length - 1
    rebuildRoot(s)
  } else {
    inv.leafIndex = s.leaves.findIndex((l) => l.commitment === c)
  }
  log(s, 'pay', `lab watcher recorded payment for C ${c.slice(0, 8)}… · leaf ${inv.leafIndex} · ${inv.amountCents} cents`)
  return { ok: true, invoice: publicInvoice(inv), guestRoot: s.guestRoot }
}

export const paidOf = (s, raw) => {
  ensurePay(s)
  const c = hexC(raw)
  if (!c) return { ok: false, error: 'bad_commitment' }
  const inv = [...s.invoices].reverse().find((i) => i.commitment === c)
  if (!inv) return { ok: true, paid: false }
  return {
    ok: true,
    paid: inv.status === 'paid',
    status: inv.status,
    invoice: publicInvoice(inv),
    guestRoot: s.guestRoot,
  }
}

export const doorConfig = (s) => {
  ensurePay(s)
  return {
    ok: true,
    eventId: EVENT_ID,
    domain: domainOf(s),
    doorAuthPubkey: s.doorAuthPublic || null,
  }
}

export const issueChallenge = (s, usherId, roleOf, { now = Date.now(), usherPubkey, eventId, domain, rng } = {}) => {
  ensurePay(s)
  const fail = (error, message) => {
    log(s, 'refuse', `door challenge by ${usherId || '∅'} refused: ${error}`)
    return { ok: false, error, message: message || error }
  }
  if (roleOf(s, usherId) !== 'usher') return fail('not_usher', 'Refused: this identity is not an usher on the list.')
  if (!s.doorAuthPublic) return fail('no_door_key', 'Refused: the event door-auth key is not ready.')
  const nonceBytes = rng ? rng(16) : globalThis.crypto.getRandomValues(new Uint8Array(16))
  const nonce = toHex(nonceBytes)
  const who = (s.identities || []).find((i) => i.id === usherId)
  const usherKey = hex32(usherPubkey) || hex32(who?.pubHex) || toHex(new TextEncoder().encode(usherId).slice(0, 16)).padEnd(64, '0').slice(0, 64)
  const ev = eventId || EVENT_ID
  const origin = domainOf(s, domain)
  const rec = { usherId, usherPubkey: usherKey, eventId: ev, domain: origin, timestamp: now, expiresAt: now + CHALLENGE_TTL_MS }
  s.challenges[nonce] = rec
  const uri = encodeChallengeUri({ eventId: ev, domain: origin, nonce, usherPubkey: usherKey, timestamp: now })
  return {
    ok: true,
    challenge: {
      eventId: ev,
      domain: origin,
      nonce,
      usherPubkey: usherKey,
      timestamp: now,
      expiresAt: rec.expiresAt,
      uri,
      doorAuthPubkey: s.doorAuthPublic,
    },
  }
}

const failConsume = (s, usherId, error, message) => {
  log(s, 'refuse', `check-in by ${usherId || '∅'} refused: ${error}`)
  return { ok: false, error, message: message || error }
}

const admit = (s, usherId, inv, now, how) => {
  const n = inv.nullifier
  if (s.spent[n]) return failConsume(s, usherId, 'already_used', 'Refused: ticket already used.')
  s.spent[n] = { at: now, by: usherId, commitment: inv.commitment, invoiceId: inv.id, how }
  log(s, 'door', `admitted leaf ${inv.commitment.slice(0, 8)}… by ${usherId} · ${how} · nullifier spent`)
  return {
    ok: true,
    commitment: inv.commitment,
    nullifier: n,
    leafIndex: inv.leafIndex,
    how,
    message:
      how === 'print'
        ? 'Admitted on a printed authorization. A second scan will be refused. This paper is bearer: anyone who had the print could present it. This loopback checks the signature, the paid leaf, and an unused nullifier; it does not verify a Halo2 proof.'
        : 'Admitted on a live holder approval. A second scan will be refused. This loopback checks the signature, the paid leaf, and an unused nullifier; it does not verify a Halo2 proof.',
  }
}

const findPaidByPubkey = (s, pk) => {
  const inv = s.invoices.find((i) => i.ticketPubkey === pk && i.status !== 'void')
  const onList = inv && s.leaves.some((l) => l.commitment === inv.commitment)
  if (!inv || inv.status !== 'paid' || !onList) return null
  return inv
}

const consumeLive = async (s, usherId, body, roleOf, now) => {
  if (roleOf(s, usherId) !== 'usher') {
    return failConsume(s, usherId, 'not_usher', 'Refused: this identity is not an usher on the list.')
  }
  const pk = hex32(body.ticketPubkey || body.ticket_pubkey)
  const signature = String(body.signature || '').trim().toLowerCase()
  const nonce = String(body.nonce || body.challenge?.nonce || '').trim().toLowerCase()
  if (!pk || !/^[0-9a-f]{128}$/.test(signature) || !nonce) {
    return failConsume(s, usherId, 'bad_consent', 'Refused: the holder approval is missing or unreadable.')
  }
  const ch = s.challenges[nonce]
  if (!ch) return failConsume(s, usherId, 'unknown_challenge', 'Refused: that door challenge is not current.')
  if (ch.expiresAt < now) return failConsume(s, usherId, 'expired_challenge', 'Refused: that door challenge has expired. Show a new one.')
  if (ch.usherId !== usherId) {
    return failConsume(s, usherId, 'wrong_door', 'Refused: that approval was made for a different door session.')
  }
  const bytes = challengeBytes({
    eventId: ch.eventId,
    domain: ch.domain,
    nonce,
    usherPubkey: ch.usherPubkey,
    timestamp: ch.timestamp,
  })
  const ok = await verifyEd25519(pk, bytes, signature)
  if (!ok) return failConsume(s, usherId, 'bad_signature', 'Refused: the holder signature is not valid for this door challenge.')
  const inv = findPaidByPubkey(s, pk)
  if (!inv) return failConsume(s, usherId, 'unpaid', 'Refused: ticket is not paid.')
  if (inv.eventId !== ch.eventId) return failConsume(s, usherId, 'wrong_event', 'Refused: that ticket is for a different event.')
  const presentedN = hex32(body.nullifier)
  if (presentedN && presentedN !== inv.nullifier) {
    return failConsume(s, usherId, 'bad_nullifier', 'Refused: the nullifier does not match this ticket.')
  }
  const result = admit(s, usherId, inv, now, 'live')
  if (result.ok) delete s.challenges[nonce]
  return result
}

const consumePrint = async (s, usherId, token, roleOf, now) => {
  if (roleOf(s, usherId) !== 'usher') {
    return failConsume(s, usherId, 'not_usher', 'Refused: this identity is not an usher on the list.')
  }
  const parsed = typeof token === 'string' ? parseAdmitUri(token) : parseAdmitUri(token?.token || token?.uri || '')
  if (!parsed.ok) {
    return failConsume(s, usherId, 'bad_admit', 'Refused: that is not a printed door authorization.')
  }
  if (!s.doorAuthPublic) return failConsume(s, usherId, 'no_door_key', 'Refused: the event door-auth key is not ready.')
  if (parsed.domain !== domainOf(s)) {
    return failConsume(s, usherId, 'wrong_domain', 'Refused: that print was authorized for a different event origin.')
  }
  if (parsed.eventId !== EVENT_ID) return failConsume(s, usherId, 'wrong_event', 'Refused: that ticket is for a different event.')
  const bytes = printAuthBytes({
    eventId: parsed.eventId,
    domain: parsed.domain,
    adminPubkey: s.doorAuthPublic,
    sku: parsed.sku,
  })
  const ok = await verifyEd25519(parsed.ticketPubkey, bytes, parsed.signature)
  if (!ok) {
    return failConsume(
      s,
      usherId,
      'bad_signature',
      'Refused: that print was not authorized for this event’s door key.',
    )
  }
  const inv = findPaidByPubkey(s, parsed.ticketPubkey)
  if (!inv) return failConsume(s, usherId, 'unpaid', 'Refused: ticket is not paid.')
  if (inv.sku !== parsed.sku) return failConsume(s, usherId, 'wrong_sku', 'Refused: that print does not match this ticket type.')
  if (parsed.commitment && parsed.commitment !== inv.commitment) {
    return failConsume(s, usherId, 'bad_commitment', 'Refused: that print does not match this ticket.')
  }
  return admit(s, usherId, inv, now, 'print')
}

/**
 * Door consume. Accepts a live approval, a printed admit URI, or (legacy) a
 * secret-bearing ticket QR — the last is always refused as no_consent.
 */
export const consumeProof = async (s, usherId, raw, roleOf, now = Date.now()) => {
  ensurePay(s)
  if (roleOf(s, usherId) !== 'usher') {
    return failConsume(s, usherId, 'not_usher', 'Refused: this identity is not an usher on the list.')
  }
  const body = raw && typeof raw === 'object' ? raw : null
  const text = typeof raw === 'string' ? raw : body?.ticket || body?.payload || body?.token || body?.uri || ''
  if (isSecretTicketUri(text) || (typeof text === 'string' && text.startsWith('sezs1://ticket?'))) {
    return failConsume(
      s,
      usherId,
      'no_consent',
      'Refused: the holder has not approved this door. A ticket secret is not consent. Ask them to sign the live challenge, or scan a printed authorization.',
    )
  }
  if (typeof text === 'string' && text.startsWith('sezs1://approve?')) {
    const parsed = parseApproveUri(text)
    if (!parsed.ok) return failConsume(s, usherId, 'bad_consent', 'Refused: the holder approval is unreadable.')
    return consumeLive(s, usherId, parsed, roleOf, now)
  }
  const kind = body?.kind || (typeof text === 'string' && text.startsWith('sezs1://admit?') ? 'print' : body?.signature || body?.nonce ? 'live' : '')
  if (kind === 'live' || body?.signature) return consumeLive(s, usherId, body || {}, roleOf, now)
  if (kind === 'print' || (typeof text === 'string' && text.startsWith('sezs1://admit?'))) {
    return consumePrint(s, usherId, text || body, roleOf, now)
  }
  if (text && parseChallengeUri(text).ok) {
    return failConsume(
      s,
      usherId,
      'no_consent',
      'Refused: that is the door challenge, not a holder approval.',
    )
  }
  return failConsume(
    s,
    usherId,
    'no_consent',
    'Refused: the holder has not approved this door. A payment commitment is not consent.',
  )
}

export const publicPay = (s) => {
  ensurePay(s)
  return {
    invoices: s.invoices.map(publicInvoice),
    leaves: s.leaves.map((l) => ({
      commitment: l.commitment,
      invoiceId: l.invoiceId,
      sku: l.sku,
      eventId: l.eventId,
      ticketPubkey: l.ticketPubkey || null,
    })),
    guestRoot: s.guestRoot,
    spentCount: Object.keys(s.spent).length,
    domain: domainOf(s),
    doorAuthPubkey: s.doorAuthPublic || null,
  }
}
