import { describe, expect, test } from 'vitest'

import { encodeMintSvgWithShitstrap } from './encode'

describe('encodeMintSvgWithShitstrap', () => {
  const base = {
    chainId: 'morocco-1',
    collectionAddress: 'terp1collection',
    quantity: 2,
    pricePerToken: '1000',
    mintDenom: 'uthiol',
  }

  test('wallet path mints with funds', () => {
    const msgs = encodeMintSvgWithShitstrap(
      { sender: 'terp1user', srcChainId: 'morocco-1' },
      { ...base, path: 'wallet' }
    )
    expect(msgs).toHaveLength(1)
    const exec = (msgs[0] as any).wasm.execute
    expect(exec.contract_addr).toBe('terp1collection')
    expect(exec.funds).toEqual([{ denom: 'uthiol', amount: '2000' }])
    // msg is base64 after makeWasmMessage
    expect(typeof exec.msg === 'string' || exec.msg.mint).toBeTruthy()
  })

  test('atomic path uses shit_strap_and_mint', () => {
    const msgs = encodeMintSvgWithShitstrap(
      { sender: 'terp1user', srcChainId: 'morocco-1' },
      {
        ...base,
        path: 'atomic',
        shitstrapAddress: 'terp1strap',
        slopDenom: 'uosmo',
        slopAmount: '5000',
      }
    )
    expect(msgs).toHaveLength(1)
    const exec = (msgs[0] as any).wasm.execute
    expect(exec.contract_addr).toBe('terp1strap')
    expect(exec.funds).toEqual([{ denom: 'uosmo', amount: '5000' }])
  })

  test('legacy path is two messages', () => {
    const msgs = encodeMintSvgWithShitstrap(
      { sender: 'terp1user', srcChainId: 'morocco-1' },
      {
        ...base,
        path: 'legacy',
        shitstrapAddress: 'terp1strap',
        slopDenom: 'uosmo',
        slopAmount: '5000',
      }
    )
    expect(msgs).toHaveLength(2)
    expect((msgs[0] as any).wasm.execute.contract_addr).toBe('terp1strap')
    expect((msgs[1] as any).wasm.execute.contract_addr).toBe('terp1collection')
  })

  test('whitelist path mints with empty funds', () => {
    const msgs = encodeMintSvgWithShitstrap(
      { sender: 'terp1user', srcChainId: 'morocco-1' },
      {
        ...base,
        path: 'whitelist',
        proofHashes: ['aa'],
      }
    )
    expect(msgs).toHaveLength(1)
    expect((msgs[0] as any).wasm.execute.funds).toEqual([])
  })
})
