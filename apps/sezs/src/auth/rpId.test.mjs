import assert from 'node:assert/strict'
import test from 'node:test'

import { loopbackNeedLocalhost, localhostHref, webAuthnRpId } from './rpId.ts'

test('webAuthnRpId accepts localhost and hostnames, rejects IPs', () => {
  assert.equal(webAuthnRpId('localhost'), 'localhost')
  assert.equal(webAuthnRpId('sezs.local'), 'sezs.local')
  assert.equal(webAuthnRpId('terp.network'), 'terp.network')
  assert.equal(webAuthnRpId('permissionless.money'), 'permissionless.money')
  assert.equal(webAuthnRpId('www.terp.network'), 'www.terp.network')
  assert.equal(webAuthnRpId('127.0.0.1'), undefined)
  assert.equal(webAuthnRpId('0.0.0.0'), undefined)
  assert.equal(webAuthnRpId('127.0.0.1'), undefined)
  assert.equal(webAuthnRpId('::1'), undefined)
  assert.equal(webAuthnRpId('[::1]'), undefined)
})

test('loopbackNeedLocalhost is true only when the host is not a valid RP ID', () => {
  assert.equal(loopbackNeedLocalhost('127.0.0.1'), true)
  assert.equal(loopbackNeedLocalhost('::1'), true)
  assert.equal(loopbackNeedLocalhost('localhost'), false)
  assert.equal(loopbackNeedLocalhost('terp.network'), false)
  assert.equal(loopbackNeedLocalhost('permissionless.money'), false)
})

test('localhostHref keeps port, path, and query', () => {
  assert.equal(
    localhostHref('http://127.0.0.1:3051/tickets?x=1'),
    'http://localhost:3051/tickets?x=1',
  )
})
