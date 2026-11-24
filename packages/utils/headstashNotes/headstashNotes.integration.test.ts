/**
 * G-integration + G-e2e: real HTTP routes against in-process notes server
 * that implements the same PIR XOR handler as hash-market (not a skip-PIR mock).
 *
 * Route parity:
 *   PUT  /notes/{hs}/{addr}
 *   GET  /notes/{hs}/{addr}
 *   GET  /notes/{hs}
 *   POST /notes/{hs}/pir
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  bearerAuthHeaders,
  buildOneHotSelector,
  createHeadstashNotesClient,
  decryptNoteOut,
  encryptNoteOut,
  fixtureCleartext382,
  HeadstashNotesError,
  noteAddrCm,
  recoverPrivateNote,
  stripTrailingNulPad,
  SEAM_NOTE_OUT_V0_LEN,
} from './index'
import { startNotesTestServer, type NotesTestServer, xorPir } from './notesTestServer'
import { bytesToHex, hexToBytes } from './hex'

describe('G-integration: hash-market notes route parity', () => {
  let srv: NotesTestServer

  beforeAll(async () => {
    srv = await startNotesTestServer({ token: 'test-token' })
  })

  afterAll(async () => {
    await srv.close()
  })

  test('xor_pir kernel matches one-hot selection', () => {
    const a = new TextEncoder().encode('hello world!')
    const b = new TextEncoder().encode('goodbye!!!!!')
    // pad equal
    const max = Math.max(a.length, b.length)
    const pa = new Uint8Array(max)
    const pb = new Uint8Array(max)
    pa.set(a)
    pb.set(b)
    expect([...xorPir([pa, pb], [1, 0])]).toEqual([...pa])
    expect([...xorPir([pa, pb], [0, 1])]).toEqual([...pb])
  })

  test('PUT + GET + list + POST /pir multi-note decrypt (G-e2e client path)', async () => {
    const hs = 'season-pir-ui'
    const ownerKey = new Uint8Array(32).fill(0xe1)
    const clearA = fixtureCleartext382(0xaa)
    const clearB = fixtureCleartext382(0xbb)
    // set distinct owner_binding / cm at SEAM offsets for summary checks
    clearA.set(new Uint8Array(32).fill(0xc1), 58)
    clearA.set(new Uint8Array(32).fill(0xaa), 90)
    clearB.set(new Uint8Array(32).fill(0xc1), 58)
    clearB.set(new Uint8Array(32).fill(0xbb), 90)

    const envA = encryptNoteOut(clearA, ownerKey)
    const envB = encryptNoteOut(clearB, ownerKey)
    expect(envA.ciphertext).not.toBe(envB.ciphertext)

    const addrA = noteAddrCm(clearA.subarray(90, 122))
    const addrB = noteAddrCm(clearB.subarray(90, 122))
    expect(addrA).not.toBe(addrB)

    const client = createHeadstashNotesClient({
      notesBase: srv.baseUrl,
      authHeaders: bearerAuthHeaders(srv.token),
    })

    await client.putNoteEnvelope(hs, addrA, envA)
    await client.putNoteEnvelope(hs, addrB, envB)

    // list without auth → 401
    const noAuth = createHeadstashNotesClient({ notesBase: srv.baseUrl })
    await expect(noAuth.listNoteKeys(hs)).rejects.toMatchObject({
      err: { kind: 'http', status: 401 },
    })

    const keys = await client.listNoteKeys(hs)
    expect(keys.length).toBe(2)
    expect(keys).toContain(addrA)
    expect(keys).toContain(addrB)
    // deterministic sorted order
    expect(keys).toEqual([...keys].sort())

    // PIR path for each
    for (const [addr, expectClear] of [
      [addrA, clearA] as const,
      [addrB, clearB] as const,
    ]) {
      const env = await client.pirGetNoteEnvelope(hs, addr)
      const recovered = decryptNoteOut(env, ownerKey)
      expect(recovered.length).toBe(SEAM_NOTE_OUT_V0_LEN)
      expect(bytesToHex(recovered)).toBe(bytesToHex(expectClear))
    }

    // direct GET also works
    const direct = await client.getNoteEnvelope(hs, addrA)
    expect(bytesToHex(decryptNoteOut(direct, ownerKey))).toBe(
      bytesToHex(clearA)
    )

    // wrong owner key fails
    const envPir = await client.pirGetNoteEnvelope(hs, addrA)
    expect(() =>
      decryptNoteOut(envPir, new Uint8Array(32).fill(0xff))
    ).toThrow(HeadstashNotesError)

    // raw POST /pir route — prove handler runs (not mocked away)
    const idx = keys.indexOf(addrB)
    const selector = buildOneHotSelector(keys, addrB)
    expect(selector[idx]).toBe(1)
    const blob = await client.pirFetchNoteBlob(hs, selector)
    const stripped = stripTrailingNulPad(blob)
    const parsed = JSON.parse(new TextDecoder().decode(stripped))
    expect(parsed.scheme).toBe('xchacha20poly1305')
    expect(bytesToHex(decryptNoteOut(parsed, ownerKey))).toBe(
      bytesToHex(clearB)
    )
  })

  test('recoverPrivateNote prefers PIR for multi-note', async () => {
    const hs = 'season-recover'
    const ownerKey = new Uint8Array(32).fill(0xb7)
    const clear = fixtureCleartext382(0x55)
    clear.set(hexToBytes('c3'.repeat(32)), 58)
    clear.set(hexToBytes('99'.repeat(32)), 90)
    const env = encryptNoteOut(clear, ownerKey)
    const addr = noteAddrCm(clear.subarray(90, 122))
    // second decoy note so list length ≥ 2
    const clear2 = fixtureCleartext382(0x66)
    clear2.set(hexToBytes('dd'.repeat(32)), 90)
    const env2 = encryptNoteOut(clear2, ownerKey)
    const addr2 = noteAddrCm(clear2.subarray(90, 122))

    const client = createHeadstashNotesClient({
      notesBase: srv.baseUrl,
      authHeaders: bearerAuthHeaders(srv.token),
    })
    await client.putNoteEnvelope(hs, addr, env)
    await client.putNoteEnvelope(hs, addr2, env2)

    const result = await recoverPrivateNote({
      notesBase: srv.baseUrl,
      hsId: hs,
      addr,
      ownerKey,
      bearerToken: srv.token,
      preferPir: true,
    })
    expect(result.summary.path).toBe('pir')
    expect(result.summary.ownerBindingHex).toBe('c3'.repeat(32))
    expect(result.summary.cmPublicHex).toBe('99'.repeat(32))
    expect(result.cleartext.length).toBe(382)
    // safe summary — not dumping full cleartext into summary fields
    expect(Object.keys(result.summary)).not.toContain('cleartext')
  })

  test('recover 401 without auth', async () => {
    await expect(
      recoverPrivateNote({
        notesBase: srv.baseUrl,
        hsId: 'season-pir-ui',
        addr: 'cm.dead',
        ownerKey: new Uint8Array(32).fill(1),
        preferPir: true,
      })
    ).rejects.toMatchObject({ err: { kind: 'http', status: 401 } })
  })

  test('forcePath direct still hits GET route', async () => {
    const hs = 'season-direct'
    const ownerKey = new Uint8Array(32).fill(0x11)
    const clear = fixtureCleartext382(0x22)
    clear.set(new Uint8Array(32).fill(0x33), 90)
    const env = encryptNoteOut(clear, ownerKey)
    const addr = noteAddrCm(clear.subarray(90, 122))
    const client = createHeadstashNotesClient({
      notesBase: srv.baseUrl,
      authHeaders: bearerAuthHeaders(srv.token),
    })
    await client.putNoteEnvelope(hs, addr, env)
    const result = await recoverPrivateNote({
      notesBase: srv.baseUrl,
      hsId: hs,
      addr,
      ownerKey,
      bearerToken: srv.token,
      forcePath: 'direct',
    })
    expect(result.summary.path).toBe('direct')
    expect(bytesToHex(result.cleartext)).toBe(bytesToHex(clear))
  })
})

/**
 * G-route-parity matrix (documented for STATUS):
 *
 * | UI method              | HTTP                                      |
 * |------------------------|-------------------------------------------|
 * | listNoteKeys           | GET  /notes/{hs_id}                       |
 * | putNoteEnvelope        | PUT  /notes/{hs_id}/{addr}                |
 * | getNoteEnvelope        | GET  /notes/{hs_id}/{addr}                |
 * | pirFetchNoteBlob       | POST /notes/{hs_id}/pir                   |
 * | pirGetNoteEnvelope     | GET list + POST /pir                      |
 * | recoverPrivateNote     | list + pir (prefer) or GET direct         |
 */
