/**
 * Module-level cast body privacy tests + encrypt→payload (real wasm).
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'vitest'

import { CIPHERTEXT_SIZE, ensureEncryptAvailable } from '@dao-dao/utils'

import { encryptAndBuildCastBody, submitCastStub } from './castBody'
import { parseShieldedChoices, DEFAULT_SHIELDED_CHOICES } from './constants'

const here = dirname(fileURLToPath(import.meta.url))
// Goldens live under utils package (wasm track).
const goldensPath = join(
  here,
  '../../../../utils/shieldedVote/goldens/encrypt_goldens.json'
)
const goldens = JSON.parse(readFileSync(goldensPath, 'utf8')) as {
  ea_pk_hex: string
}

describe('parseShieldedChoices', () => {
  test('defaults on empty', () => {
    expect(parseShieldedChoices('')).toEqual([...DEFAULT_SHIELDED_CHOICES])
  })

  test('parses JSON string', () => {
    const raw = JSON.stringify([{ id: 'a', label: 'A', value: 9 }])
    expect(parseShieldedChoices(raw)).toEqual([
      { id: 'a', label: 'A', value: 9 },
    ])
  })
})

describe('encryptAndBuildCastBody privacy', () => {
  test('encrypt wasm available', async () => {
    expect(await ensureEncryptAvailable()).toBe(true)
  })

  test('body has no plaintext vote fields or values', async () => {
    const voteValue = 1
    const { body, privacyLeaks, prepared } = await encryptAndBuildCastBody({
      roundId: 'round-42',
      proposalId: '0',
      eaPkHex: goldens.ea_pk_hex,
      choice: { id: 'yes', label: 'Yes', value: voteValue },
      nullifierSeedHex: 'aa'.repeat(32),
    })

    expect(privacyLeaks).toEqual([])
    expect(body.protocol).toBe('terp-shielded-vote/v1')
    expect(body.roundId).toBe('round-42')
    expect(body.ciphertextHex).toHaveLength(CIPHERTEXT_SIZE * 2)
    expect(body.proofHex).toBeTruthy()
    expect(body.nullifierHex).toBeTruthy()
    expect(body.publicInputsHex).toHaveLength(288 * 2)
    expect(body).not.toHaveProperty('vote')
    expect(body).not.toHaveProperty('voteValue')
    expect(body).not.toHaveProperty('localChoiceId')
    expect(prepared.localChoiceId).toBe('yes')
    expect(prepared.engine).toMatch(/vote-elgamal-wasm/)

    const json = JSON.stringify(body)
    expect(json).not.toMatch(/"vote"/)
    expect(json).not.toMatch(/"voteValue"/)
    // Bare number 1 must not appear as a JSON number in the body.
    expect(json).not.toMatch(/:\s*1\s*[,}]/)
  })
})

describe('submitCastStub / submitShieldedCast', () => {
  test('without lab URL or contract fails closed', async () => {
    const { body } = await encryptAndBuildCastBody({
      roundId: 'r',
      proposalId: '0',
      eaPkHex: goldens.ea_pk_hex,
      choice: { id: 'no', label: 'No', value: 0 },
      nullifierSeedHex: 'bb'.repeat(32),
    })
    const res = await submitCastStub({ body })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/labCastBaseUrl|castContract|cannot submit/i)
    expect(res.body.ciphertextHex).toBe(body.ciphertextHex)
    expect(JSON.stringify(res)).not.toMatch(/"voteValue"/)
  })
})
