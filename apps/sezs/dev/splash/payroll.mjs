/**
 * Event participant registration and payroll (coordinator-gated).
 * Stores only a SHA-256 commitment of each one-time registration key.
 * The plaintext key is returned once to the coordinator and never written.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { looksShieldedZec, looksUmBech32 } from '../../src/pay/bech32.mjs'

const ROLES = Object.freeze(['artist', 'vendor', 'staff', 'usher'])
const STATUSES = Object.freeze(['invited', 'registered', 'paid'])
const KEY_PREFIX = 'sezsreg_'
const BATCH_STATUSES = Object.freeze(['proposed', 'signing', 'signed', 'executed', 'refused'])

const here = dirname(fileURLToPath(import.meta.url))
const defaultStore = join(here, '.splash', 'payroll.json')

export const payrollRoles = ROLES

export const hashKey = (key) =>
  createHash('sha256').update(String(key), 'utf8').digest('hex')

export const generateRegistrationKey = () => KEY_PREFIX + randomBytes(32).toString('hex')

export const isRegistrationKey = (key) =>
  typeof key === 'string' && /^sezsreg_[0-9a-f]{64}$/.test(key)

export const truncateAddr = (addr) => {
  const s = String(addr || '').trim()
  if (s.length <= 14) return s || '—'
  return `${s.slice(0, 8)}…${s.slice(-6)}`
}

const empty = () => ({
  version: 1,
  invites: [],
  participants: [],
  batches: [],
  splits: { charity: 0.111, venue: 0.111, remainder: 0.778 },
  roleAmounts: { artist: '', vendor: '', staff: '', usher: '' },
})

const assertSafePath = (p) => {
  if (String(p).includes('..')) throw new Error('bad_store_path')
  return p
}

export const loadPayroll = (path = defaultStore) => {
  const p = assertSafePath(path)
  if (!existsSync(p)) return empty()
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  return {
    ...empty(),
    ...raw,
    invites: Array.isArray(raw.invites) ? raw.invites : [],
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    batches: Array.isArray(raw.batches) ? raw.batches : [],
  }
}

export const savePayroll = (state, path = defaultStore) => {
  const p = assertSafePath(path)
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, p)
  try { chmodSync(p, 0o600) } catch {}
  return state
}

const newId = (prefix) => `${prefix}-${randomBytes(8).toString('hex')}`

export const publicInvite = (inv) => ({
  id: inv.id,
  role: inv.role,
  label: inv.label || '',
  status: inv.status,
  consumedAt: inv.consumedAt || null,
  createdAt: inv.createdAt,
})

export const publicParticipant = (p) => ({
  id: p.id,
  inviteId: p.inviteId,
  role: p.role,
  label: p.label || '',
  displayName: p.displayName || '',
  status: p.status,
  zec: truncateAddr(p.zec),
  um: truncateAddr(p.um),
  amount: p.amount ?? '',
  registeredAt: p.registeredAt,
  paidAt: p.paidAt || null,
})

export const publicBatch = (b) => ({
  id: b.id,
  status: b.status,
  items: b.items,
  splits: b.splits,
  digest: b.digest,
  sessionId: b.sessionId || null,
  signature: b.signature ? String(b.signature).slice(0, 16) + '…' : null,
  receiptId: b.receiptId || null,
  executedAt: b.executedAt || null,
  execution: b.execution || null,
  createdAt: b.createdAt,
  note: b.note || '',
})

export const listPublic = (state) => ({
  ok: true,
  splits: state.splits,
  roleAmounts: state.roleAmounts,
  invites: state.invites.map(publicInvite),
  participants: state.participants.map(publicParticipant),
  batches: state.batches.map(publicBatch),
})

export const createInvite = (state, { role, label = '' } = {}) => {
  if (!ROLES.includes(role)) return { ok: false, error: 'bad_role' }
  const key = generateRegistrationKey()
  const invite = {
    id: newId('inv'),
    role,
    label: String(label || '').slice(0, 80),
    commitment: hashKey(key),
    status: 'invited',
    createdAt: Date.now(),
    consumedAt: null,
  }
  state.invites.push(invite)
  return { ok: true, invite: publicInvite(invite), key }
}

const eqHex = (a, b) => {
  try {
    const ba = Buffer.from(String(a), 'hex')
    const bb = Buffer.from(String(b), 'hex')
    return ba.length === bb.length && timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

const looksZec = (s) => looksShieldedZec(s)
const looksUm = (s) => looksUmBech32(s)

export const registerWithKey = (state, body) => {
  const key = String(body.registrationKey || '')
  if (!isRegistrationKey(key)) return { ok: false, error: 'bad_key' }
  const commitment = hashKey(key)
  const invite = state.invites.find((i) => eqHex(i.commitment, commitment))
  if (!invite) return { ok: false, error: 'unknown_key' }
  if (invite.status !== 'invited' || invite.consumedAt) return { ok: false, error: 'key_consumed' }
  const zec = String(body.zec || '').trim()
  const um = String(body.um || '').trim()
  if (!looksZec(zec)) return { ok: false, error: 'bad_zec' }
  if (!looksUm(um)) return { ok: false, error: 'bad_um' }
  const displayName = String(body.displayName || '').trim().slice(0, 80)
  if (!displayName) return { ok: false, error: 'bad_name' }
  invite.status = 'registered'
  invite.consumedAt = Date.now()
  const participant = {
    id: newId('prt'),
    inviteId: invite.id,
    role: invite.role,
    label: invite.label,
    displayName,
    status: 'registered',
    zec,
    um,
    amount: '',
    registeredAt: Date.now(),
    paidAt: null,
  }
  state.participants.push(participant)
  return { ok: true, participant: publicParticipant(participant) }
}

export const setAmounts = (state, { roleAmounts, amounts, splits } = {}) => {
  if (splits && typeof splits === 'object') {
    const charity = Number(splits.charity)
    const venue = Number(splits.venue)
    const remainder = Number(splits.remainder)
    if ([charity, venue, remainder].some((n) => !Number.isFinite(n) || n < 0)) {
      return { ok: false, error: 'bad_splits' }
    }
    const sum = charity + venue + remainder
    if (Math.abs(sum - 1) > 0.001) return { ok: false, error: 'splits_must_sum_to_one' }
    state.splits = { charity, venue, remainder }
  }
  if (roleAmounts && typeof roleAmounts === 'object') {
    for (const role of ROLES) {
      if (roleAmounts[role] != null) state.roleAmounts[role] = String(roleAmounts[role]).slice(0, 32)
    }
  }
  if (Array.isArray(amounts)) {
    for (const row of amounts) {
      const p = state.participants.find((x) => x.id === row.id)
      if (p) p.amount = String(row.amount ?? '').slice(0, 32)
    }
  }
  return { ok: true, splits: state.splits, roleAmounts: state.roleAmounts }
}

export const batchDigest = (payload) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex')

export const proposeBatch = (state, { note = '' } = {}) => {
  const registered = state.participants.filter((p) => p.status === 'registered' || p.status === 'paid')
  if (!registered.length) return { ok: false, error: 'no_participants' }
  const items = registered.map((p) => ({
    participantId: p.id,
    role: p.role,
    displayName: p.displayName,
    amount: p.amount || state.roleAmounts[p.role] || '0',
    zec: truncateAddr(p.zec),
    um: truncateAddr(p.um),
  }))
  if (items.some((i) => !i.amount || i.amount === '0')) return { ok: false, error: 'missing_amounts' }
  const body = { items, splits: state.splits, at: Date.now() }
  const digest = batchDigest({ items: body.items, splits: body.splits })
  const batch = {
    id: newId('pay'),
    status: 'proposed',
    items: body.items,
    splits: { ...state.splits },
    digest,
    sessionId: null,
    signature: null,
    pubkey: null,
    receiptId: null,
    executedAt: null,
    execution: null,
    createdAt: body.at,
    note: String(note || '').slice(0, 160),
  }
  state.batches.push(batch)
  return { ok: true, batch: publicBatch(batch) }
}

export const markSigning = (state, batchId, sessionId) => {
  const b = state.batches.find((x) => x.id === batchId)
  if (!b) return { ok: false, error: 'unknown_batch' }
  if (b.status !== 'proposed' && b.status !== 'signing') return { ok: false, error: 'bad_status' }
  b.status = 'signing'
  b.sessionId = sessionId || b.sessionId
  return { ok: true, batch: publicBatch(b) }
}

export const acceptSignature = (state, { batchId, signature, pubkey }) => {
  const b = state.batches.find((x) => x.id === batchId)
  if (!b) return { ok: false, error: 'unknown_batch' }
  if (b.status !== 'signing' && b.status !== 'proposed') return { ok: false, error: 'bad_status' }
  if (!signature || !pubkey) return { ok: false, error: 'missing_signature' }
  b.status = 'signed'
  b.signature = String(signature)
  b.pubkey = String(pubkey)
  return { ok: true, batch: publicBatch(b) }
}

export const executeBatch = async (state, batchId, payout = null) => {
  const b = state.batches.find((x) => x.id === batchId)
  if (!b) return { ok: false, error: 'unknown_batch' }
  if (b.status !== 'signed') return { ok: false, error: 'not_signed' }
  const run = payout || (await import('./chain-payouts.mjs')).executePayrollPayouts
  const paid = await run(state, b)
  if (!paid?.ok) {
    return { ok: false, error: paid?.error || 'payout_failed', message: paid?.message, errors: paid?.errors }
  }
  const receiptId = newId('rcpt')
  b.status = 'executed'
  b.receiptId = receiptId
  b.executedAt = Date.now()
  b.execution = paid.execution
  const paidAt = b.executedAt
  for (const item of b.items) {
    const p = state.participants.find((x) => x.id === item.participantId)
    if (p) {
      p.status = 'paid'
      p.paidAt = paidAt
      if (paid.execution?.zec) {
        const tx = paid.execution.zec.find((x) => x.participantId === p.id)
        if (tx) p.zecTxid = tx.txid
      }
      if (paid.execution?.um) {
        const tx = paid.execution.um.find((x) => x.participantId === p.id)
        if (tx) p.umTxid = tx.txid
      }
    }
  }
  return { ok: true, batch: publicBatch(b) }
}

export const persistPath = defaultStore
export { STATUSES, BATCH_STATUSES, KEY_PREFIX }
