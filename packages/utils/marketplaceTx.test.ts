import { describe, expect, it } from 'vitest'

import { ChainId } from '@dao-dao/types'

import { getSupportedChainConfig } from './chain'
import { getExplorerTxUrl, resolveTxLink } from './marketplaceTx'

describe('marketplaceTx', () => {
  it('returns null / hash for unknown chain', () => {
    expect(getExplorerTxUrl('not-a-real-chain', 'ABC123')).toBeNull()
    expect(resolveTxLink('not-a-real-chain', 'ABC123')).toEqual({
      text: 'ABC123',
      kind: 'hash',
    })
  })

  it('builds explorer URL with hash when chain template exists', () => {
    const candidates = [ChainId.TerpMainnet, ChainId.TerpTestnet]
    const chainId =
      candidates.find(
        (id) => getSupportedChainConfig(id)?.explorerUrlTemplates?.tx
      ) ?? null
    if (!chainId) {
      expect(resolveTxLink('x', 'h').kind).toBe('hash')
      return
    }
    const url = getExplorerTxUrl(chainId, 'DEADBEEF')
    expect(url).toBeTruthy()
    expect(url).toContain('DEADBEEF')
    expect(url).not.toContain('REPLACE')
    expect(resolveTxLink(chainId, 'DEADBEEF').kind).toBe('url')
  })

  it('returns null for empty hash', () => {
    expect(getExplorerTxUrl(ChainId.TerpMainnet, '')).toBeNull()
  })
})
