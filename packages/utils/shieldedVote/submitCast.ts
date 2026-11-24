/**
 * V-UI-4 cast submit — lab HTTP execute or prepared CosmWasm msg.
 * Never attaches plaintext vote. Fail-closed on privacy leaks / missing proof.
 */

import {
  buildCastShieldedVoteExecuteMsg,
  buildWasmExecuteBody,
  type CastShieldedVoteExecuteMsg,
} from './castExecuteMsg'
import { findPrivacyLeaksInBody } from './castPayload'
import { isHexString } from './hex'
import { LAB_PROOF_MODE } from './labProveCast'
import type { ShieldedCastSubmitBody } from './types'
import { CIPHERTEXT_SIZE, PUBLIC_KEY_SIZE } from './types'

export type SubmitCastInput = {
  /** Lab cast server base URL (e.g. http://127.0.0.1:PORT). */
  labCastBaseUrl?: string
  /** CosmWasm contract address (lab or chain). */
  castContract?: string
  body: ShieldedCastSubmitBody
  /** Required for lab prove path. */
  publicInputsHex?: string
  proofMode?: string
  /** Fail closed without proof (default true when publicInputsHex set). */
  requireProof?: boolean
  sender?: string
}

export type SubmitCastResult =
  | {
      ok: true
      mode: 'lab_http'
      txLike: { status: string; nullifierHex: string; ciphertextHex: string }
      executeMsg: CastShieldedVoteExecuteMsg
      body: ShieldedCastSubmitBody
    }
  | {
      ok: true
      mode: 'prepared_wasm'
      /** No broadcast — wallet path not wired; msg ready for client sign. */
      wasmExecute: ReturnType<typeof buildWasmExecuteBody>
      executeMsg: CastShieldedVoteExecuteMsg
      body: ShieldedCastSubmitBody
      note: string
    }
  | {
      ok: false
      reason: string
      body: ShieldedCastSubmitBody
      executeMsg?: CastShieldedVoteExecuteMsg
    }

function validateBody(body: ShieldedCastSubmitBody, requireProof: boolean): string | null {
  const leaks = findPrivacyLeaksInBody(body)
  if (leaks.length > 0) return `privacy leaks: ${leaks.join(', ')}`
  if (!body.roundId?.trim()) return 'roundId required'
  if (!isHexString(body.eaPkHex, PUBLIC_KEY_SIZE)) return 'eaPkHex bad'
  if (!isHexString(body.ciphertextHex, CIPHERTEXT_SIZE)) return 'ciphertextHex bad'
  if (requireProof) {
    if (!body.proofHex?.trim()) return 'proof required (fail-closed)'
    if (!body.nullifierHex?.trim()) return 'nullifier required with proof'
  }
  return null
}

/**
 * Submit cast: prefer lab HTTP when labCastBaseUrl set; else prepare wasm execute.
 */
export async function submitCast(
  input: SubmitCastInput
): Promise<SubmitCastResult> {
  const requireProof =
    input.requireProof ??
    !!(input.publicInputsHex || input.body.proofHex || input.proofMode)

  const bad = validateBody(input.body, requireProof)
  if (bad) {
    return { ok: false, reason: bad, body: input.body }
  }

  if (requireProof && !input.publicInputsHex) {
    return {
      ok: false,
      reason: 'publicInputsHex required for cast execute msg',
      body: input.body,
    }
  }

  let executeMsg: CastShieldedVoteExecuteMsg
  try {
    executeMsg = buildCastShieldedVoteExecuteMsg({
      roundId: input.body.roundId,
      proposalId: input.body.proposalId,
      eaPkHex: input.body.eaPkHex,
      ciphertextHex: input.body.ciphertextHex,
      proofHex: input.body.proofHex ?? '',
      nullifierHex: input.body.nullifierHex ?? '',
      publicInputsHex: input.publicInputsHex ?? '',
      proofMode: input.proofMode ?? LAB_PROOF_MODE,
    })
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
      body: input.body,
    }
  }

  const leaks = findPrivacyLeaksInBody(executeMsg)
  if (leaks.length > 0) {
    return {
      ok: false,
      reason: `execute msg privacy leaks: ${leaks.join(', ')}`,
      body: input.body,
      executeMsg,
    }
  }

  // Lab HTTP path — stable integration without chain
  if (input.labCastBaseUrl?.trim()) {
    const base = input.labCastBaseUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(executeMsg),
      })
      const json = (await res.json()) as {
        ok?: boolean
        error?: string
        reason?: string
        nullifierHex?: string
        ciphertextHex?: string
        status?: string
      }
      if (!res.ok || !json.ok) {
        return {
          ok: false,
          reason:
            json.error === 'nullifier_already_spent'
              ? 'nullifier_already_spent'
              : json.reason || json.error || `HTTP ${res.status}`,
          body: input.body,
          executeMsg,
        }
      }
      return {
        ok: true,
        mode: 'lab_http',
        txLike: {
          status: json.status ?? 'accepted',
          nullifierHex: json.nullifierHex ?? input.body.nullifierHex ?? '',
          ciphertextHex:
            json.ciphertextHex ?? input.body.ciphertextHex,
        },
        executeMsg,
        body: input.body,
      }
    } catch (e) {
      return {
        ok: false,
        reason: `lab cast HTTP failed: ${e instanceof Error ? e.message : String(e)}`,
        body: input.body,
        executeMsg,
      }
    }
  }

  // Prepared wasm execute (wallet broadcast residual / optional chain)
  if (input.castContract?.trim()) {
    const wasmExecute = buildWasmExecuteBody({
      contract: input.castContract.trim(),
      sender: input.sender,
      msg: executeMsg,
    })
    return {
      ok: true,
      mode: 'prepared_wasm',
      wasmExecute,
      executeMsg,
      body: input.body,
      note:
        'CosmWasm execute msg prepared. Sign/broadcast via wallet adapter; lab_http preferred for integration tests.',
    }
  }

  return {
    ok: false,
    reason:
      'No labCastBaseUrl or castContract — cannot submit. Set lab cast server or contract.',
    body: input.body,
    executeMsg,
  }
}

/** Query lab server for round casts (G-e2e). */
export async function queryLabCasts(
  labCastBaseUrl: string,
  roundId: string
): Promise<{
  count: number
  casts: { nullifierHex: string; ciphertextHex: string }[]
}> {
  const base = labCastBaseUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/cast/${encodeURIComponent(roundId)}`)
  if (!res.ok) throw new Error(`query casts HTTP ${res.status}`)
  return res.json() as Promise<{
    count: number
    casts: { nullifierHex: string; ciphertextHex: string }[]
  }>
}
