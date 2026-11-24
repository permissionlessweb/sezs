import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guestRootMessageHex, dkgAdminSet, signAdminSet, loadAdminMeta } from './admin-set.mjs'
import { frostCall, frostPayrollBin } from './payroll-ceremony.mjs'
import { existsSync as exists } from 'node:fs'

test('guestRootMessageHex is stable', () => {
  const a = guestRootMessageHex({
    contract: 'terp1examplecontractaddress000000000000000000',
    epoch: 1,
    leafCount: 2,
    root: 'ab'.repeat(32),
  })
  const b = guestRootMessageHex({
    contract: 'terp1examplecontractaddress000000000000000000',
    epoch: 1,
    leafCount: 2,
    root: 'AB'.repeat(32),
  })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]+$/)
  assert.notEqual(
    a,
    guestRootMessageHex({
      contract: 'terp1examplecontractaddress000000000000000000',
      epoch: 2,
      leafCount: 2,
      root: 'ab'.repeat(32),
    }),
  )
})

test('admin set DKG and 2-of-3 sign a guest-root message', async (t) => {
  if (!exists(frostPayrollBin())) {
    t.skip('sezs-frost-payroll binary is not built')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'sezs-admin-frost-'))
  try {
    const meta = await dkgAdminSet({ dir })
    assert.equal(meta.t, 2)
    assert.equal(meta.n, 3)
    assert.match(meta.verifyingKey, /^[0-9a-f]{64}$/)
    assert.ok(existsSync(join(dir, 'set.json')))
    const loaded = loadAdminMeta(dir)
    assert.equal(loaded.verifyingKey, meta.verifyingKey)
    const message = guestRootMessageHex({
      contract: 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqn5qqqq',
      epoch: 1,
      leafCount: 1,
      root: '11'.repeat(32),
    })
    const signed = await signAdminSet({ dir, messageHex: message })
    assert.match(signed.signatureHex, /^[0-9a-f]{128}$/)
    assert.equal(signed.verifyingKey, meta.verifyingKey)
    const check = await frostCall({
      op: 'verify',
      verifying_key_hex: signed.verifyingKey,
      signature_hex: signed.signatureHex,
      message,
    })
    assert.equal(check.ok, true)
    assert.equal(check.valid, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
