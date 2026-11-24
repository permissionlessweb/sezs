/**
 * V-UI-5 HARD GATE: G-encrypt, G-privacy, G-route, G-e2e (lab cast surface).
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  CIPHERTEXT_SIZE,
  buildCastShieldedVoteExecuteMsg,
  buildCastSubmitBody,
  encryptVote,
  ensureEncryptAvailable,
  findPrivacyLeaksInBody,
  FORBIDDEN_CAST_BODY_KEYS,
  hexToBytes,
  bytesToHex,
  labProveCast,
  queryLabCasts,
  startLabCastServer,
  submitCast,
  type LabCastServer,
} from './index'

const here = dirname(fileURLToPath(import.meta.url))
const goldens = JSON.parse(
  readFileSync(join(here, 'goldens/encrypt_goldens.json'), 'utf8')
) as {
  ea_pk_hex: string
  cases: { vote: number; r_hex: string; ct_hex: string }[]
}

describe('V-UI-5 HARD GATE', () => {
  let server: LabCastServer

  beforeAll(async () => {
    expect(await ensureEncryptAvailable()).toBe(true)
    server = await startLabCastServer({
      contract: 'lab-shielded-cast',
      requireLabProof: true,
    })
  })

  afterAll(async () => {
    await server.close()
  })

  test('G-encrypt: browser encrypt matches Go golden (fixed r)', async () => {
    const c = goldens.cases.find((x) => x.vote === 1)!
    const ct = await encryptVote(hexToBytes(goldens.ea_pk_hex), 1, {
      r: hexToBytes(c.r_hex),
    })
    expect(bytesToHex(ct)).toBe(c.ct_hex.toLowerCase())
    expect(ct.length).toBe(CIPHERTEXT_SIZE)
  })

  test('G-privacy: outbound body and execute msg have no plaintext vote', async () => {
    const voteValue = 1
    const ct = await encryptVote(hexToBytes(goldens.ea_pk_hex), voteValue)
    const ctHex = bytesToHex(ct)
    const proved = await labProveCast({
      roundId: 'gate-round-privacy',
      proposalId: '0',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: ctHex,
      nullifierSeedHex: '11'.repeat(32),
    })
    const body = buildCastSubmitBody({
      roundId: 'gate-round-privacy',
      proposalId: '0',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: ctHex,
      proofHex: proved.proofHex,
      nullifierHex: proved.nullifierHex,
      publicInputsHex: proved.publicInputsHex,
      proofMode: proved.mode,
      requireProof: true,
    })
    expect(findPrivacyLeaksInBody(body, [voteValue, 0, 2, 42])).toEqual([])
    for (const k of FORBIDDEN_CAST_BODY_KEYS) {
      expect(JSON.stringify(body)).not.toContain(`"${k}"`)
    }

    const exec = buildCastShieldedVoteExecuteMsg({
      roundId: body.roundId,
      proposalId: body.proposalId,
      eaPkHex: body.eaPkHex,
      ciphertextHex: body.ciphertextHex,
      proofHex: body.proofHex!,
      nullifierHex: body.nullifierHex!,
      publicInputsHex: body.publicInputsHex!,
      proofMode: body.proofMode,
    })
    expect(findPrivacyLeaksInBody(exec, [voteValue])).toEqual([])
    expect(JSON.stringify(exec)).not.toMatch(/"voteValue"/)
    expect(exec.cast_shielded_vote.enc_share).toBeTruthy()
  })

  test('G-route + G-e2e: encrypt → lab prove → submit → query ciphertext; double nf fails', async () => {
    const voteValue = 2
    const roundId = 'gate-round-e2e'
    const ct = await encryptVote(hexToBytes(goldens.ea_pk_hex), voteValue)
    const ctHex = bytesToHex(ct)
    const seed = '22'.repeat(32)
    const proved = await labProveCast({
      roundId,
      proposalId: '1',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: ctHex,
      nullifierSeedHex: seed,
    })
    const body = buildCastSubmitBody({
      roundId,
      proposalId: '1',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: ctHex,
      proofHex: proved.proofHex,
      nullifierHex: proved.nullifierHex,
      publicInputsHex: proved.publicInputsHex,
      proofMode: proved.mode,
      requireProof: true,
    })

    // Outbound HTTP payload privacy
    const outbound = JSON.stringify(
      buildCastShieldedVoteExecuteMsg({
        roundId: body.roundId,
        proposalId: body.proposalId,
        eaPkHex: body.eaPkHex,
        ciphertextHex: body.ciphertextHex,
        proofHex: body.proofHex!,
        nullifierHex: body.nullifierHex!,
        publicInputsHex: body.publicInputsHex!,
        proofMode: body.proofMode,
      })
    )
    expect(outbound).not.toMatch(/"vote"/)
    expect(outbound).not.toMatch(/"voteValue"/)
    expect(outbound).not.toMatch(new RegExp(`[:\\[]\\s*${voteValue}\\s*[,\\}\\]]`))

    const first = await submitCast({
      labCastBaseUrl: server.baseUrl,
      body,
      publicInputsHex: body.publicInputsHex,
      proofMode: body.proofMode,
      requireProof: true,
    })
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.mode).toBe('lab_http')
      expect(first.txLike.ciphertextHex).toBe(ctHex)
      expect(first.txLike.nullifierHex).toBe(proved.nullifierHex)
    }

    const q = await queryLabCasts(server.baseUrl, roundId)
    expect(q.count).toBeGreaterThanOrEqual(1)
    expect(q.casts.some((c) => c.ciphertextHex === ctHex)).toBe(true)
    expect(JSON.stringify(q)).not.toMatch(/"voteValue"/)

    // Double nullifier fail-closed
    const second = await submitCast({
      labCastBaseUrl: server.baseUrl,
      body,
      publicInputsHex: body.publicInputsHex,
      proofMode: body.proofMode,
      requireProof: true,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toMatch(/nullifier_already_spent/)
    }
  })

  test('G-e2e: bad proof binding rejected', async () => {
    const ct = await encryptVote(hexToBytes(goldens.ea_pk_hex), 0)
    const ctHex = bytesToHex(ct)
    const proved = await labProveCast({
      roundId: 'gate-bad-proof',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: ctHex,
      nullifierSeedHex: '33'.repeat(32),
    })
    // Tamper ciphertext in body while keeping proof
    const other = await encryptVote(hexToBytes(goldens.ea_pk_hex), 1)
    const body = buildCastSubmitBody({
      roundId: 'gate-bad-proof',
      eaPkHex: goldens.ea_pk_hex,
      ciphertextHex: bytesToHex(other),
      proofHex: proved.proofHex,
      nullifierHex: proved.nullifierHex,
      publicInputsHex: proved.publicInputsHex,
      proofMode: proved.mode,
      requireProof: true,
    })
    const res = await submitCast({
      labCastBaseUrl: server.baseUrl,
      body,
      publicInputsHex: body.publicInputsHex,
      proofMode: body.proofMode,
      requireProof: true,
    })
    expect(res.ok).toBe(false)
  })
})
