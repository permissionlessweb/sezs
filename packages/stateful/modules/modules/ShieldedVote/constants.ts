import type { ShieldedVoteChoice } from '@dao-dao/utils'

import type { ShieldedVoteModuleData } from './types'

/** Default ternary ballot (encrypt domain values 0/1/2). */
export const DEFAULT_SHIELDED_CHOICES: readonly ShieldedVoteChoice[] = [
  { id: 'no', label: 'No', value: 0 },
  { id: 'yes', label: 'Yes', value: 1 },
  { id: 'abstain', label: 'Abstain', value: 2 },
]

export const DEFAULT_SHIELDED_VOTE_VALUES: ShieldedVoteModuleData = {
  description:
    'Shielded cast: your choice is encrypted in the browser under the election authority public key (ElGamal). Plaintext never leaves your device for encrypt.',
  defaultRoundId: '',
  defaultProposalId: '',
  eaPkHex: '',
  castContract: '',
  labCastBaseUrl: '',
  requireProof: true,
  labMode: true,
  choices: [...DEFAULT_SHIELDED_CHOICES],
}

/**
 * Parse choices from module storage (array or JSON string).
 */
export function parseShieldedChoices(
  raw: ShieldedVoteModuleData['choices']
): ShieldedVoteChoice[] {
  if (Array.isArray(raw)) {
    return raw.filter(isChoice)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter(isChoice)
      }
    } catch {
      return [...DEFAULT_SHIELDED_CHOICES]
    }
  }
  return [...DEFAULT_SHIELDED_CHOICES]
}

function isChoice(x: unknown): x is ShieldedVoteChoice {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.value === 'number' &&
    Number.isInteger(o.value) &&
    o.value >= 0
  )
}
