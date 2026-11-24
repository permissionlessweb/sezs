/**
 * G-unit: cast body privacy + encrypt→payload (wasm when available).
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'vitest'

import {
  buildCastSubmitBody,
  CIPHERTEXT_SIZE,
  encryptVote,
  ensureEncryptAvailable,
  findPrivacyLeaksInBody,
  FORBIDDEN_CAST_BODY_KEYS,
  hexToBytes,
  bytesToHex,
  isHexString,
  loadElgamalWasm,
  prepareCastFromEncrypt,
  preparedToSubmitBody,
  PUBLIC_KEY_SIZE,
  ShieldedVoteCryptoError,
} from './index'

const here = dirname(fileURLToPath(import.meta.url))
const goldens = JSON.parse(
  readFileSync(join(here, 'goldens/encrypt_goldens.json'), 'utf8')
) as {
  ea_pk_hex: string
  cases: { vote: number; r_hex: string; ct_hex: string }[]
}

describe('G-unit: hex helpers', () => {
  test('round-trip and isHexString lengths', () => {
    const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(hexToBytes(bytesToHex(b))).toEqual(b)
    expect(isHexString(bytesToHex(b), 4)).toBe(true)
    expect(isHexString('zz', 1)).toBe(false)
  })
})

describe('G-unit: cast body privacy (no plaintext vote)', () => {
  test('buildCastSubmitBody omits all forbidden keys', () => {
    const eaPkHex = goldens.ea_pk_hex
    const ctHex = goldens.cases[0]!.ct_hex
    const body = buildCastSubmitBody({
      roundId: 'round-lab-1',
      proposalId: 'prop-0',
      eaPkHex,
      ciphertextHex: ctHex,
    })
    expect(body.protocol).toBe('terp-shielded-vote/v1')
    expect(body.roundId).toBe('round-lab-1')
    expect(body.ciphertextHex).toHaveLength(CIPHERTEXT_SIZE * 2)
    const leaks = findPrivacyLeaksInBody(body, [0, 1, 2, 42, 99])
    expect(leaks).toEqual([])
    for (const key of FORBIDDEN_CAST_BODY_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(body, key)).toBe(false)
    }
  })

  test('preparedToSubmitBody drops localChoiceId', () => {
    const eaPk = hexToBytes(goldens.ea_pk_hex)
    const ct = hexToBytes(goldens.cases.find((c) => c.vote === 1)!.ct_hex)
    const prepared = prepareCastFromEncrypt({
      roundId: 'r1',
      eaPk,
      ciphertext: ct,
      engine: 'fixture',
      localChoiceId: 'yes',
    })
    expect(prepared.localChoiceId).toBe('yes')
    const body = preparedToSubmitBody(prepared)
    expect(body).not.toHaveProperty('localChoiceId')
    expect(body).not.toHaveProperty('vote')
    expect(body).not.toHaveProperty('voteValue')
    expect(findPrivacyLeaksInBody(body, [1])).toEqual([])
  })

  test('findPrivacyLeaksInBody detects forbidden keys and bare vote numbers', () => {
    const bad = {
      protocol: 'terp-shielded-vote/v1',
      roundId: 'r',
      vote: 1,
      voteValue: 2,
    }
    const leaks = findPrivacyLeaksInBody(bad, [1, 2])
    expect(leaks.some((l) => l.startsWith('key:'))).toBe(true)
    expect(leaks).toContain('plaintext_value:1')
    expect(leaks).toContain('plaintext_value:2')
  })

  test('requireProof fail-closed', () => {
    expect(() =>
      buildCastSubmitBody({
        roundId: 'r',
        eaPkHex: goldens.ea_pk_hex,
        ciphertextHex: goldens.cases[0]!.ct_hex,
        requireProof: true,
      })
    ).toThrow(/proof required/i)
  })
})

describe('G-unit: encrypt → payload shape (wasm)', () => {
  test('wasm available and encrypt produces 64B for cast body', async () => {
    const ok = await ensureEncryptAvailable()
    expect(ok).toBe(true)
    await loadElgamalWasm()

    const eaPk = hexToBytes(goldens.ea_pk_hex)
    expect(eaPk.length).toBe(PUBLIC_KEY_SIZE)
    const voteValue = 3
    const case3 = goldens.cases.find((c) => c.vote === voteValue)!
    const ct = await encryptVote(eaPk, voteValue, {
      r: hexToBytes(case3.r_hex),
    })
    expect(ct.length).toBe(CIPHERTEXT_SIZE)
    expect(bytesToHex(ct)).toBe(case3.ct_hex)

    const body = buildCastSubmitBody({
      roundId: 'ceremony-session-1',
      eaPkHex: bytesToHex(eaPk),
      ciphertextHex: bytesToHex(ct),
    })
    expect(body.eaPkHex).toHaveLength(64)
    expect(body.ciphertextHex).toHaveLength(128)
    expect(body.statusSummary).toBe('encrypted')
    expect(findPrivacyLeaksInBody(body, [voteValue])).toEqual([])
  })

  test('bad ea_pk length throws crypto error', async () => {
    await loadElgamalWasm()
    await expect(encryptVote(new Uint8Array(16), 1)).rejects.toBeInstanceOf(
      ShieldedVoteCryptoError
    )
  })
})
