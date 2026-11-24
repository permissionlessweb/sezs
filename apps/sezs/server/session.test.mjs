import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ed25519 } from '@noble/curves/ed25519'
import { newAdmin, signAdr036 } from '../src/ble/lab-sign.mjs'
import { createSessionHttpServer } from './http-server.mjs'
import { resolveSessionSecret } from './session-token.mjs'

const BALTIMORE = 'terp1qf4plkes8hmtpdjp06qmggdd69z067gt2jz6ffgymunxmwcj5p6s60vkyz'
const CHICAGO = 'terp1tz0setr8vkh9udp8xyxgpqc89ns27k4d0jx2h942hr0ax63yjhmqx7ajem'
const PHILA = 'terp1dyxlfhc3gtlvcerlrsag75vqfx2hukea4723ffqvygu6ta2j98eqct2jsl'
const UNKNOWN_CONTRACT = 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq29z9u7'

const bytesToHex = (u8) => Buffer.from(u8).toString('hex')
const sha256 = (data) => createHash('sha256').update(data).digest()

function makeP256Passkey(credId = 'cred-alpha-0123456789abcdef') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  // Last 65 bytes of P-256 SPKI DER are uncompressed SEC1 (0x04 || x || y)
  const rawPub = spki.subarray(spki.length - 65)
  assert.equal(rawPub.length, 65)
  assert.equal(rawPub[0], 0x04)

  const signAssertion = (challengeB64, { origin = 'https://permissionless.money', rpId = 'permissionless.money', flags = 0x05, signCount = 1, crossOrigin = false } = {}) => {
    const clientObj = { type: 'webauthn.get', challenge: challengeB64, origin, crossOrigin }
    const clientBytes = Buffer.from(JSON.stringify(clientObj), 'utf8')
    const authData = Buffer.alloc(37)
    sha256(rpId).copy(authData, 0)
    authData[32] = flags
    authData.writeUInt32BE(signCount, 33)
    const sig = cryptoSign('sha256', Buffer.concat([authData, sha256(clientBytes)]), privateKey)
    return {
      clientDataJSON: clientBytes.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: sig.toString('base64url'),
    }
  }

  return {
    credId,
    publicKeyB64: rawPub.toString('base64'),
    publicKeyB64Url: rawPub.toString('base64url'),
    signAssertion,
  }
}

async function startMockLcd() {
  const map = {
    [BALTIMORE]: {
      curators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      coordinators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      ushers: ['terp1usher00000000000000000000000000000'],
      coordinators_group: 'terp1coordbaltimore000000000000000000000000',
      usher_group: 'terp1usherbaltimore000000000000000000000000',
    },
    [CHICAGO]: {
      curators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      coordinators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      ushers: [],
      coordinators_group: 'terp1coordchicago0000000000000000000000000',
      usher_group: 'terp1usherchicago0000000000000000000000000',
    },
    [PHILA]: {
      curators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      coordinators: ['terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'],
      ushers: [],
      coordinators_group: 'terp1coordphila000000000000000000000000000',
      usher_group: 'terp1usherphila000000000000000000000000000',
    },
  }
  const srv = http.createServer((req, res) => {
    const m = /\/contract\/(terp1[a-z0-9]+)\/smart\//.exec(req.url || '')
    const data = m && map[m[1]] ? map[m[1]] : null
    if (!data) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 5, message: 'not found' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address()
  return {
    lcd: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => srv.close(r)),
  }
}

test('production refuses to boot without SEZS_SESSION_SECRET or SEZS_SESSION_SECRET_FILE', () => {
  assert.throws(
    () => resolveSessionSecret({ env: { NODE_ENV: 'production' } }),
    /required in production/,
  )
})

test('production loopback server: ZID, passkey (rpId=permissionless.money), logout revoke, roles, and hardening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-sess-test-'))
  const secretFile = join(dir, 'session.secret')
  writeFileSync(secretFile, 'ab'.repeat(32) + '\n', { mode: 0o600 })
  chmodSync(secretFile, 0o600)

  const loadedSecret = resolveSessionSecret({ env: { NODE_ENV: 'production', SEZS_SESSION_SECRET_FILE: secretFile } })
  assert.equal(loadedSecret.length, 32)

  const mockLcd = await startMockLcd()
  const srv = createSessionHttpServer({
    host: '127.0.0.1',
    port: 0,
    stateDir: dir,
    dbPath: join(dir, 'sessions.sqlite'),
    allowedOrigins: 'https://permissionless.money',
    rpId: 'permissionless.money',
    cookieName: 'sezs_session',
    cookiePath: '/alpha/sezs/api',
    secureCookie: true,
    trustProxy: true,
    sessionSecretFile: secretFile,
    lcd: mockLcd.lcd,
    contracts: `${BALTIMORE},${CHICAGO},${PHILA}`,
  })

  try {
    const addr = await srv.listen()
    const base = `http://127.0.0.1:${addr.port}`

    // 1. Health check
    const health = await fetch(`${base}/sezs/session/health`).then((r) => r.json())
    assert.equal(health.ok, true)
    assert.equal(health.service, 'sezs-session')

    // 2. Dev-only endpoints are excluded (404)
    for (const dead of ['/__splash/api/scenario', '/sezs/v2/leaves', '/sezs/v2/paid', '/sezs/frost/jobs']) {
      const r = await fetch(`${base}${dead}`)
      assert.equal(r.status, 404, `expected 404 for ${dead}`)
    }

    // 3. Origin & CSRF checks
    const badOrigin = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-sezs-frost': '1' },
      body: JSON.stringify({ origin: 'https://evil.example', kind: 'zid' }),
    })
    assert.equal(badOrigin.status, 403)

    const noCsrf = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money' },
      body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'zid' }),
    })
    assert.equal(noCsrf.status, 403)

    // 4. Secret-field rejection & oversized body rejection
    const secretRefused = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1' },
      body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'zid', mnemonic: 'abandon' }),
    })
    assert.equal(secretRefused.status, 400)

    const tooBig = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1' },
      body: JSON.stringify({ origin: 'https://permissionless.money', pad: 'a'.repeat(9000) }),
    })
    assert.equal(tooBig.status, 413)

    // 5. ZID session login + cookie flags + /me + replay refusal + logout revocation
    const zidPriv = ed25519.utils.randomPrivateKey()
    const zidPub = bytesToHex(ed25519.getPublicKey(zidPriv))

    const chZidRes = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'zid' }),
    })
    assert.equal(chZidRes.status, 200)
    const chZid = await chZidRes.json()
    assert.equal(chZid.ok, true)

    const zidSig = bytesToHex(ed25519.sign(Buffer.from(chZid.message, 'utf8'), zidPriv))
    const verifyZidBody = {
      origin: 'https://permissionless.money',
      nonce: chZid.nonce,
      ts: chZid.ts,
      method: 'zid',
      publicKey: zidPub,
      signature: zidSig,
    }
    const vfZidRes = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify(verifyZidBody),
    })
    assert.equal(vfZidRes.status, 200)
    const vfZid = await vfZidRes.json()
    assert.equal(vfZid.ok, true)
    assert.equal(vfZid.kind, 'ed25519/zid')
    assert.equal(vfZid.login_id, zidPub)

    const setCookie = vfZidRes.headers.get('set-cookie') || ''
    assert.match(setCookie, /^sezs_session=v1\.[^;]+;/)
    assert.match(setCookie, /Path=\/alpha\/sezs\/api/)
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Strict/)
    assert.match(setCookie, /Secure/)
    const zidCookie = setCookie.split(';')[0]

    // Replay of single-use challenge fails
    const replayZid = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify(verifyZidBody),
    })
    assert.equal(replayZid.status, 400)

    // /me with cookie succeeds
    const meZid = await fetch(`${base}/sezs/session/me`, { headers: { cookie: zidCookie } }).then((r) => r.json())
    assert.equal(meZid.ok, true)
    assert.equal(meZid.login_id, zidPub)
    assert.equal(meZid.kind, 'ed25519/zid')

    // Logout revokes session in SQLite
    const logoutRes = await fetch(`${base}/sezs/session/logout`, {
      method: 'POST',
      headers: { origin: 'https://permissionless.money', 'x-sezs-frost': '1', cookie: zidCookie },
    })
    assert.equal(logoutRes.status, 200)
    assert.match(logoutRes.headers.get('set-cookie') || '', /Max-Age=0/)

    // Old cookie is immediately rejected after revocation
    const meAfterLogout = await fetch(`${base}/sezs/session/me`, { headers: { cookie: zidCookie } }).then((r) => r.json())
    assert.equal(meAfterLogout.ok, false)
    assert.equal(meAfterLogout.error, 'no_session')

    // 6. Passkey session login with rpId=permissionless.money
    const pk = makeP256Passkey()
    const issuePk = async () =>
      fetch(`${base}/sezs/session/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
        body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'passkey' }),
      }).then((r) => r.json())

    const chPk1 = await issuePk()
    assert.equal(chPk1.ok, true)
    assert.equal(chPk1.rpId, 'permissionless.money')

    // Wrong rpId refused
    const badRp = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chPk1.nonce,
        ts: chPk1.ts,
        method: 'passkey',
        credId: pk.credId,
        publicKey: pk.publicKeyB64,
        assertion: pk.signAssertion(chPk1.challengeB64, { rpId: 'evil.example' }),
      }),
    })
    assert.equal(badRp.status, 403)
    assert.equal((await badRp.json()).error, 'passkey_rp_id')

    // Missing UV flag refused
    const chPk2 = await issuePk()
    const badUv = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chPk2.nonce,
        ts: chPk2.ts,
        method: 'passkey',
        credId: pk.credId,
        publicKey: pk.publicKeyB64,
        assertion: pk.signAssertion(chPk2.challengeB64, { flags: 0x01 }),
      }),
    })
    assert.equal(badUv.status, 403)
    assert.equal((await badUv.json()).error, 'passkey_flags')

    // Valid P-256 passkey registration + sign-in (signCount=5)
    const chPk3 = await issuePk()
    const vfPkRes = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chPk3.nonce,
        ts: chPk3.ts,
        method: 'passkey',
        credId: pk.credId,
        publicKey: pk.publicKeyB64,
        assertion: pk.signAssertion(chPk3.challengeB64, { signCount: 5 }),
      }),
    })
    assert.equal(vfPkRes.status, 200)
    const vfPk = await vfPkRes.json()
    assert.equal(vfPk.ok, true)
    assert.equal(vfPk.kind, 'p256/passkey')
    assert.equal(vfPk.login_id, pk.credId)
    const pkCookie = (vfPkRes.headers.get('set-cookie') || '').split(';')[0]
    const mePk = await fetch(`${base}/sezs/session/me`, { headers: { cookie: pkCookie } }).then((r) => r.json())
    assert.equal(mePk.ok, true)
    assert.equal(mePk.kind, 'p256/passkey')

    // Returning passkey with lower signCount is rejected (counter rollback protection)
    const chPk4 = await issuePk()
    const rollbackRes = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chPk4.nonce,
        ts: chPk4.ts,
        method: 'passkey',
        credId: pk.credId,
        assertion: pk.signAssertion(chPk4.challengeB64, { signCount: 3 }),
      }),
    })
    assert.equal(rollbackRes.status, 403)
    assert.equal((await rollbackRes.json()).error, 'passkey_counter')

    // Key substitution for existing credId is rejected
    const pkOther = makeP256Passkey(pk.credId)
    const chPk5 = await issuePk()
    const subRes = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chPk5.nonce,
        ts: chPk5.ts,
        method: 'passkey',
        credId: pk.credId,
        publicKey: pkOther.publicKeyB64,
        assertion: pkOther.signAssertion(chPk5.challengeB64, { signCount: 6 }),
      }),
    })
    assert.equal(subRes.status, 403)
    assert.equal((await subRes.json()).error, 'passkey_key_mismatch')

    // 7. Role reads across the 3 configured event contracts
    const rolesDefault = await fetch(`${base}/sezs/v2/event/roles`).then((r) => r.json())
    assert.equal(rolesDefault.ok, true)
    assert.equal(rolesDefault.contract, BALTIMORE)
    assert.deepEqual(rolesDefault.contracts, [BALTIMORE, CHICAGO, PHILA])
    assert.equal(rolesDefault.coordinators.includes('terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052'), true)
    assert.equal(rolesDefault.ushers[0].terp, 'terp1usher00000000000000000000000000000')

    const rolesChicago = await fetch(`${base}/sezs/v2/event/roles?contract=${CHICAGO}`).then((r) => r.json())
    assert.equal(rolesChicago.ok, true)
    assert.equal(rolesChicago.contract, CHICAGO)

    const unknownRole = await fetch(`${base}/sezs/v2/event/roles?contract=${UNKNOWN_CONTRACT}`)
    assert.equal(unknownRole.status, 400)
    assert.equal((await unknownRole.json()).error, 'unknown_contract')

    const badContract = await fetch(`${base}/sezs/v2/event/roles?contract=not-a-contract`)
    assert.equal(badContract.status, 400)
    assert.equal((await badContract.json()).error, 'bad_contract')

    // 8. ADR-036 login resolves live coordinator role
    const coord = newAdmin()
    assert.ok(coord.address)
    const chAdr = await fetch(`${base}/sezs/session/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'adr036', artist_id: coord.address }),
    }).then((r) => r.json())
    assert.equal(chAdr.ok, true)
    const signedAdr = signAdr036(coord.address, chAdr.message, coord.secret)
    const vfAdr = await fetch(`${base}/sezs/session/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({
        origin: 'https://permissionless.money',
        nonce: chAdr.nonce,
        ts: chAdr.ts,
        method: 'adr036',
        artist_id: coord.address,
        pub_key: signedAdr.pub_key,
        signature: signedAdr.signature,
      }),
    }).then((r) => r.json())
    assert.equal(vfAdr.ok, true)
    assert.equal(vfAdr.role, 'guest')
    assert.equal(vfAdr.live, true)

    // 9. Per-IP rate limit triggers 429
    let got429 = false
    for (let i = 0; i < 35; i++) {
      const r = await fetch(`${base}/sezs/session/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://permissionless.money', 'x-sezs-frost': '1', 'x-forwarded-for': '198.51.100.77' },
        body: JSON.stringify({ origin: 'https://permissionless.money', kind: 'zid' }),
      })
      if (r.status === 429) {
        got429 = true
        break
      }
    }
    assert.equal(got429, true)
  } finally {
    await srv.close()
    await mockLcd.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
