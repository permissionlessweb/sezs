import { toBase64, toUtf8 } from '@cosmjs/encoding'
import { describe, expect, test } from 'vitest'

import {
  BOUNTIES_IDENTITY_ALGO,
  BOUNTIES_PROTOCOL,
  buildBountiesDeriveMessage,
  buildBountiesLoginMessage,
  deriveBountyIdentityFromSignature,
} from './bountiesIdentity'

describe('bountiesIdentity', () => {
  test('buildBountiesLoginMessage exact lines', () => {
    const message = buildBountiesLoginMessage({
      chainId: 'morocco-1',
      daoAddress: 'terp1daoaddress',
      addr: 'terp1signer',
      nonce: 'nonce-abc',
      exp: 1_700_000_000,
    })

    expect(message).toBe(
      [
        'terp-bounties/v1/login',
        'chain_id=morocco-1',
        'dao=terp1daoaddress',
        'addr=terp1signer',
        'nonce=nonce-abc',
        'exp=1700000000',
      ].join('\n')
    )
    expect(message.split('\n')).toHaveLength(6)
    expect(message.startsWith(`${BOUNTIES_PROTOCOL}/login`)).toBe(true)
  })

  test('buildBountiesDeriveMessage exact lines (default account 0)', () => {
    const message = buildBountiesDeriveMessage({
      chainId: 'morocco-1',
      daoAddress: 'terp1daoaddress',
      addr: 'terp1signer',
    })

    expect(message).toBe(
      [
        'terp-bounties/v1/derive',
        'chain_id=morocco-1',
        'dao=terp1daoaddress',
        'addr=terp1signer',
        'account=0',
      ].join('\n')
    )
  })

  test('buildBountiesDeriveMessage respects accountIndex', () => {
    const message = buildBountiesDeriveMessage({
      chainId: 'morocco-1',
      daoAddress: 'terp1dao',
      addr: 'terp1addr',
      accountIndex: 3,
    })
    expect(message.endsWith('account=3')).toBe(true)
  })

  test('deriveBountyIdentityFromSignature is deterministic for same sig+dao', () => {
    // Fixed base64 signature bytes (not a real secp sig — derivation only needs bytes).
    const signature = toBase64(toUtf8('fixed-bounties-derive-signature-v0'))
    const deriveMessage = buildBountiesDeriveMessage({
      chainId: 'morocco-1',
      daoAddress: 'terp1daoA',
      addr: 'terp1signer',
      accountIndex: 0,
    })
    const params = {
      signature,
      chainId: 'morocco-1',
      daoAddress: 'terp1daoA',
      accountIndex: 0,
      deriveMessage,
    }

    const a = deriveBountyIdentityFromSignature(params)
    const b = deriveBountyIdentityFromSignature(params)

    expect(a.bountyPk).toBe(b.bountyPk)
    expect(a.transcriptHash).toBe(b.transcriptHash)
    expect(a.algo).toBe(BOUNTIES_IDENTITY_ALGO)
    expect(a.algo).toBe('hkdf-sha256-identity-stub-v0')
    // 32-byte hex stub
    expect(a.bountyPk).toMatch(/^[0-9a-f]{64}$/)
    expect(a.transcriptHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different daoAddress → different bountyPk (blinding)', () => {
    const signature = toBase64(toUtf8('fixed-bounties-derive-signature-v0'))
    const base = {
      signature,
      chainId: 'morocco-1',
      accountIndex: 0,
    }

    const idA = deriveBountyIdentityFromSignature({
      ...base,
      daoAddress: 'terp1daoA',
    })
    const idB = deriveBountyIdentityFromSignature({
      ...base,
      daoAddress: 'terp1daoB',
    })

    expect(idA.bountyPk).not.toBe(idB.bountyPk)
  })

  test('never returns sk field (public identity stub only)', () => {
    const signature = toBase64(toUtf8('another-fixed-sig-bytes'))
    const identity = deriveBountyIdentityFromSignature({
      signature,
      chainId: 'morocco-1',
      daoAddress: 'terp1dao',
    })

    expect(identity).toEqual({
      bountyPk: expect.any(String),
      algo: BOUNTIES_IDENTITY_ALGO,
      transcriptHash: expect.any(String),
    })
    expect(identity).not.toHaveProperty('sk')
    expect(identity).not.toHaveProperty('okm')
    expect(identity).not.toHaveProperty('ikm')
    expect(identity).not.toHaveProperty('prk')
    expect(Object.keys(identity).sort()).toEqual([
      'algo',
      'bountyPk',
      'transcriptHash',
    ])
  })
})
