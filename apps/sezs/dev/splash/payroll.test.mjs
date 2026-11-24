import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as P from './payroll.mjs'

const zec = 'u1testzecaddrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const um = 'penumbra1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursceg62w'

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-pay-'))
  const path = join(dir, 'payroll.json')
  const state = P.loadPayroll(path)
  return { dir, path, state }
}

describe('payroll registration', () => {
  it('generates a one-time key and stores only a commitment', () => {
    const { dir, path, state } = fresh()
    const r = P.createInvite(state, { role: 'artist', label: 'Asha' })
    assert.equal(r.ok, true)
    assert.match(r.key, /^sezsreg_[0-9a-f]{64}$/)
    assert.equal(r.invite.status, 'invited')
    P.savePayroll(state, path)
    const disk = P.loadPayroll(path)
    assert.equal(disk.invites.length, 1)
    assert.equal(disk.invites[0].commitment, P.hashKey(r.key))
    assert.ok(!JSON.stringify(disk).includes(r.key))
    assert.ok(!Object.values(disk.invites[0]).includes(r.key))
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers with a valid key and truncates addresses in the public record', () => {
    const { dir, state } = fresh()
    const inv = P.createInvite(state, { role: 'staff', label: 'door' })
    const r = P.registerWithKey(state, {
      registrationKey: inv.key,
      displayName: 'Jordan',
      zec,
      um,
    })
    assert.equal(r.ok, true)
    assert.equal(r.participant.status, 'registered')
    assert.equal(r.participant.displayName, 'Jordan')
    assert.ok(r.participant.zec.includes('…'))
    assert.ok(!r.participant.zec.includes(zec.slice(10, 30)))
    assert.equal(state.invites[0].status, 'registered')
    assert.ok(state.invites[0].consumedAt)
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a reused key', () => {
    const { dir, state } = fresh()
    const inv = P.createInvite(state, { role: 'vendor' })
    const body = { registrationKey: inv.key, displayName: 'Kim', zec, um }
    assert.equal(P.registerWithKey(state, body).ok, true)
    const again = P.registerWithKey(state, { ...body, displayName: 'Other' })
    assert.equal(again.ok, false)
    assert.equal(again.error, 'key_consumed')
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a wrong key', () => {
    const { dir, state } = fresh()
    P.createInvite(state, { role: 'usher' })
    const r = P.registerWithKey(state, {
      registrationKey: P.generateRegistrationKey(),
      displayName: 'No',
      zec,
      um,
    })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_key')
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a malformed key', () => {
    const { dir, state } = fresh()
    const r = P.registerWithKey(state, { registrationKey: 'not-a-key', displayName: 'No', zec, um })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'bad_key')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('payroll batches', () => {
  const seeded = () => {
    const ctx = fresh()
    const inv = P.createInvite(ctx.state, { role: 'artist', label: 'set' })
    P.registerWithKey(ctx.state, { registrationKey: inv.key, displayName: 'Asha', zec, um })
    P.setAmounts(ctx.state, { roleAmounts: { artist: '12' }, amounts: [{ id: ctx.state.participants[0].id, amount: '12' }] })
    return ctx
  }

  it('proposes a batch with a digest and executes only after a signature', async () => {
    const { dir, state } = seeded()
    const proposed = P.proposeBatch(state, { note: 'session one' })
    assert.equal(proposed.ok, true)
    assert.equal(proposed.batch.status, 'proposed')
    assert.match(proposed.batch.digest, /^[0-9a-f]{64}$/)
    const early = await P.executeBatch(state, proposed.batch.id)
    assert.equal(early.ok, false)
    P.markSigning(state, proposed.batch.id, 'sess-test')
    const signed = P.acceptSignature(state, {
      batchId: proposed.batch.id,
      signature: 'sig-demo',
      pubkey: 'pk-demo',
    })
    assert.equal(signed.ok, true)
    const missing = await P.executeBatch(state, proposed.batch.id)
    assert.equal(missing.ok, false)
    assert.equal(missing.error, 'chain_unavailable')
    const done = await P.executeBatch(state, proposed.batch.id, async () => ({
      ok: true,
      execution: {
        kind: 'local-chain',
        frostGate: 'approval-gated-treasury',
        zec: [{ participantId: proposed.batch.items[0].participantId, txid: 'ab' * 32 }],
        um: [{ participantId: proposed.batch.items[0].participantId, txid: 'cd' * 32 }],
      },
    }))
    assert.equal(done.ok, true)
    assert.equal(done.batch.status, 'executed')
    assert.equal(done.batch.execution.kind, 'local-chain')
    assert.equal(done.batch.execution.frostGate, 'approval-gated-treasury')
    assert.equal(state.participants[0].status, 'paid')
    rmSync(dir, { recursive: true, force: true })
  })
})
