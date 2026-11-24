import { describe, expect, test } from 'vitest'

import { ChainId } from '@dao-dao/types'

import { getNativeTokenForChainId } from './chain'
import { GAS_OVERRIDES, assets, chains } from './constants'

describe('Terp dual fee config', () => {
  test('morocco-1 fee_tokens lists uthiol first then uterp', () => {
    const chain = chains.find((c) => c.chainId === ChainId.TerpMainnet)
    expect(chain).toBeTruthy()
    const fees = chain!.chainRegistry?.fees?.fee_tokens?.map((f) => f.denom)
    expect(fees).toEqual(['uthiol', 'uterp'])
  })

  test('GAS_OVERRIDES and native token default to uthiol', () => {
    expect(GAS_OVERRIDES[ChainId.TerpMainnet]?.denom).toBe('uthiol')
    expect(getNativeTokenForChainId(ChainId.TerpMainnet).denomOrAddress).toBe(
      'uthiol'
    )
  })

  test('120u-1 lab fee_tokens include uterp and assetlist resolves native', () => {
    const chain = chains.find((c) => c.chainId === ChainId.TerpTestnet)
    expect(chain).toBeTruthy()
    const fees = chain!.chainRegistry?.fees?.fee_tokens?.map((f) => f.denom)
    expect(fees).toContain('uterp')
    expect(fees).toContain('uthiol')

    const list = assets.find((a) => a.chain_name === chain!.chainName)
    expect(list?.assets.some((a) => a.base === 'uterp')).toBe(true)

    const native = getNativeTokenForChainId(ChainId.TerpTestnet)
    expect(native.denomOrAddress).toBe('uterp')
    expect(native.decimals).toBe(6)
    expect(native.symbol).toBe('TERP')
  })
})
