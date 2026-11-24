import { describe, expect, test } from 'vitest'

import {
  CAST_PI_WIRE_SIZE,
  buildCastPublicInputWire,
  encodeU32LeChunk,
  encodeU64LeChunk,
  splitCastPublicInputWire,
} from './publicInputs'

describe('publicInputs V-UI-0 layout', () => {
  test('wire is 288 bytes and splits into 9×32', () => {
    const z = new Uint8Array(32)
    const wire = buildCastPublicInputWire({
      vanNullifier: z,
      rVpk: z,
      voteAuthorityNoteNew: z,
      voteCommitment: z,
      voteCommTreeRoot: z,
      anchorHeight: 0x1122334455667788n,
      proposalId: 7,
      votingRoundId: z,
      eaPk: z,
    })
    expect(wire.length).toBe(CAST_PI_WIRE_SIZE)
    const parts = splitCastPublicInputWire(wire)
    expect(parts).toHaveLength(9)
    expect(parts[5]!.slice(0, 8)).toEqual(encodeU64LeChunk(0x1122334455667788n).slice(0, 8))
    expect(parts[6]!.slice(0, 4)).toEqual(encodeU32LeChunk(7).slice(0, 4))
  })
})
