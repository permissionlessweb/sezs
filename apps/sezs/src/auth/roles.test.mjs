import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { canDoor, canManagePayroll, refusalFor } from './roles.mjs'

describe('role hierarchy', () => {
  it('lets event admins and coordinators manage payroll, not ushers or guests', () => {
    assert.equal(canManagePayroll('admin'), true)
    assert.equal(canManagePayroll('coordinator'), true)
    assert.equal(canManagePayroll('frost_admin'), true)
    assert.equal(canManagePayroll('usher'), false)
    assert.equal(canManagePayroll('guest'), false)
    assert.equal(canManagePayroll(null), false)
  })

  it('lets ushers run the door, and refuses them on payroll with a distinct error', () => {
    assert.equal(canDoor('usher'), true)
    assert.equal(canDoor('guest'), false)
    assert.equal(refusalFor('usher').error, 'usher_forbidden')
    assert.equal(refusalFor('guest').error, 'not_coordinator')
    assert.equal(refusalFor(null).error, 'not_member')
    assert.equal(refusalFor('coordinator'), null)
  })
})
