import assert from 'node:assert/strict'
import test from 'node:test'

import { adminGate, isStaffRole } from './adminGate.mjs'

const wallet = (address, role = 'guest') => ({
  credId: 'x',
  authenticators: [],
  policy: 'anyOf',
  role,
  alias: 'coord',
  wallet: { kind: 'zafu', address, connectedAt: 1 },
  createdAt: 1,
})

test('admin gate hides the page until a finished sign-in', () => {
  assert.equal(adminGate({ ready: false }), 'loading')
  assert.equal(adminGate({ ready: true, session: null }), 'signed_out')
  assert.equal(
    adminGate({
      ready: true,
      session: { credId: 'x', authenticators: [], policy: 'anyOf', role: 'admin', alias: 'a', createdAt: 1 },
    }),
    'signed_out',
  )
})

test('admin gate admits an on-chain coordinator after sign-in', () => {
  const address = 'terp1xjysxqa0l2flh0kxnps4r3peljep8872qwr3u6'
  assert.equal(
    adminGate({
      ready: true,
      session: wallet(address, 'guest'),
      live: { live: true, role: 'coordinator', address, coordinators: [address], curators: [] },
    }),
    'ok',
  )
  assert.equal(isStaffRole('coordinator'), true)
})

test('admin gate refuses a signed-in guest when live roles are present', () => {
  const address = 'terp1guestxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  assert.equal(
    adminGate({
      ready: true,
      session: wallet(address, 'guest'),
      live: { live: true, role: 'guest', address, coordinators: ['terp1other'], curators: [] },
    }),
    'forbidden',
  )
})

test('admin gate can use a verified session role when live data is not available', () => {
  const address = 'terp1labcoordinatorxxxxxxxxxxxxxxxxxxxxxxx'
  assert.equal(
    adminGate({
      ready: true,
      session: wallet(address, 'coordinator'),
      live: { live: false },
    }),
    'ok',
  )
})

test('admin gate recognizes completed ZID and passkey sessions', () => {
  const zidSession = {
    credId: '',
    authenticators: [],
    policy: 'anyOf',
    role: 'guest',
    alias: 'guest',
    wallet: { kind: 'zid', zidPubkey: 'ab'.repeat(32), address: '', connectedAt: 1 },
    createdAt: 1,
  }
  assert.equal(adminGate({ ready: true, session: zidSession, live: { live: false } }), 'forbidden')
  assert.equal(
    adminGate({ ready: true, session: { ...zidSession, role: 'coordinator' }, live: { live: false } }),
    'ok',
  )

  const pkSession = {
    credId: 'cred-1234',
    authenticators: [],
    policy: 'anyOf',
    role: 'guest',
    alias: 'guest',
    wallet: { kind: 'passkey', address: '', passkeyCredId: 'cred-1234', passkeyVerified: true, connectedAt: 1 },
    createdAt: 1,
  }
  assert.equal(adminGate({ ready: true, session: pkSession, live: { live: false } }), 'forbidden')
})
