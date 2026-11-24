/**
 * Golden tests: TS/wasm encrypt must match Go elgamal EncryptWithRandomness.
 *
 * Run from packages/utils:
 *   pnpm exec vitest run shieldedVote/encryptVote.test.ts
 *
 * Rebuild wasm:
 *   cd crates/vote-sdk/crypto/elgamal-wasm && \
 *   wasm-pack build --target nodejs \
 *     --out-dir ../../../../websites/dao-dao-ui/packages/utils/shieldedVote/pkg --release
 */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import {
  castPayloadEncShare,
  encryptVote,
  encryptVoteWithRandomness,
  isElgamalCiphertextBytes,
  loadElgamalWasm,
} from './encryptVote'
import { bytesToHex, hexToBytes } from './hex'
import {
  CIPHERTEXT_SIZE,
  PUBLIC_KEY_SIZE,
  SPEND_AUTH_G_HEX,
} from './types'

type GoldenCase = {
  name: string
  vote: number
  r_hex: string
  ct_hex: string
}

type Golden = {
  generator_hex: string
  ea_pk_hex: string
  cases: GoldenCase[]
  identity_ct_hex: string
  point_scalars: { scalar: number; hex: string }[]
}

const here = dirname(fileURLToPath(import.meta.url))
const goldens: Golden = JSON.parse(
  readFileSync(join(here, 'goldens/encrypt_goldens.json'), 'utf8')
)

describe('shieldedVote ElGamal wasm (Go goldens)', () => {
  it('loads wasm and exposes SpendAuthG', async () => {
    const api = await loadElgamalWasm()
    expect(api.ciphertextSize()).toBe(CIPHERTEXT_SIZE)
    expect(api.publicKeySize()).toBe(PUBLIC_KEY_SIZE)
    expect(bytesToHex(api.spendAuthGCompressed())).toBe(SPEND_AUTH_G_HEX)
    expect(bytesToHex(api.spendAuthGCompressed())).toBe(goldens.generator_hex)
    expect(bytesToHex(api.identityCiphertext())).toBe(goldens.identity_ct_hex)
  })

  it('matches every Go EncryptWithRandomness golden', async () => {
    const eaPk = hexToBytes(goldens.ea_pk_hex)
    expect(eaPk.length).toBe(PUBLIC_KEY_SIZE)

    for (const c of goldens.cases) {
      const r = hexToBytes(c.r_hex)
      const ct = await encryptVoteWithRandomness(eaPk, c.vote, r)
      expect(ct.length, c.name).toBe(CIPHERTEXT_SIZE)
      expect(bytesToHex(ct), c.name).toBe(c.ct_hex)
    }
  })

  it('encryptVote with opts.r matches fixed-r API', async () => {
    const eaPk = hexToBytes(goldens.ea_pk_hex)
    const c = goldens.cases.find((x) => x.vote === 42)!
    const r = hexToBytes(c.r_hex)
    const a = await encryptVote(eaPk, 42, { r })
    const b = await encryptVoteWithRandomness(eaPk, 42, r)
    expect(bytesToHex(a)).toBe(c.ct_hex)
    expect(bytesToHex(b)).toBe(c.ct_hex)
  })

  it('CSPRNG encrypt yields 64B distinct from fixed-r golden', async () => {
    const eaPk = hexToBytes(goldens.ea_pk_hex)
    const ct = await encryptVote(eaPk, 42)
    expect(isElgamalCiphertextBytes(ct)).toBe(true)
    const fixed = goldens.cases.find((x) => x.vote === 42)!
    // Extremely unlikely to collide with fixed r=4
    expect(bytesToHex(ct)).not.toBe(fixed.ct_hex)
  })

  it('cast payload carries ciphertext only (no plaintext vote field)', async () => {
    const eaPk = hexToBytes(goldens.ea_pk_hex)
    const voteValue = 7
    const ct = await encryptVote(eaPk, voteValue, {
      r: hexToBytes(goldens.cases.find((c) => c.vote === 7)!.r_hex),
    })
    const payload = castPayloadEncShare(ct) as Record<string, unknown>
    expect(payload.enc_share).toBeInstanceOf(Uint8Array)
    expect(Object.keys(payload)).toEqual(['enc_share'])
    // Privacy: serialized JSON of payload must not contain the vote integer as a field
    const json = JSON.stringify({
      enc_share: bytesToHex(payload.enc_share as Uint8Array),
    })
    expect(json).not.toMatch(/"vote"\s*:/)
    expect(json).not.toMatch(/"voteValue"\s*:/)
    expect(json).not.toMatch(/"choice"\s*:/)
  })
})
