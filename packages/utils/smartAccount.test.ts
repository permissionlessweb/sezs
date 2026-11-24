import { describe, expect, test } from 'vitest'

import { TxExtension } from '@dao-dao/types/protobuf/codegen/osmosis/smartaccount/v1beta1/tx'
import { getTypesRegistry } from '@dao-dao/types'

import { ChainId } from '@dao-dao/types'

import {
  buildSelectedAuthenticatorsForMessages,
  buildSmartAccountTxExtension,
  buildSmartAccountTxOptions,
  buildSmartAccountTxOptionsForMessages,
  isSmartAccountChain,
  selectAuthenticatorId,
  txOptionsRequireDirectSigner,
} from './smartAccount'

describe('smartAccount helpers', () => {
  test('isSmartAccountChain includes Terp mainnet and 120u-1 lab', () => {
    expect(isSmartAccountChain(ChainId.TerpMainnet)).toBe(true)
    expect(isSmartAccountChain(ChainId.TerpTestnet)).toBe(true)
    expect(isSmartAccountChain('120u-1')).toBe(true)
    expect(isSmartAccountChain('cosmoshub-4')).toBe(false)
  })

  test('buildSelectedAuthenticatorsForMessages repeats id per message', () => {
    expect(buildSelectedAuthenticatorsForMessages(3, 7n)).toEqual([7n, 7n, 7n])
    expect(buildSelectedAuthenticatorsForMessages(0, 1n)).toEqual([])
    expect(buildSelectedAuthenticatorsForMessages(2, '9')).toEqual([9n, 9n])
  })

  test('buildSmartAccountTxExtension uses TxExtension typeUrl', () => {
    const ext = buildSmartAccountTxExtension([1n, 2n])
    expect(ext.typeUrl).toBe(TxExtension.typeUrl)
    expect(ext.typeUrl).toBe('/osmosis.smartaccount.v1beta1.TxExtension')
    expect(ext.value.selectedAuthenticators).toEqual([1n, 2n])
  })

  test('TxExtension is registered in types registry', () => {
    const registry = getTypesRegistry()
    expect(registry.lookupType(TxExtension.typeUrl)).toBeTruthy()
  })

  test('buildSmartAccountTxOptions merges existing extensions', () => {
    const existing = {
      nonCriticalExtensionOptions: [
        { typeUrl: '/other', value: { a: 1 } },
      ] as any,
      feeGranter: 'granter',
    }
    const opts = buildSmartAccountTxOptions({
      messageCount: 2,
      authenticatorId: 5,
      existing,
    })
    expect(opts.feeGranter).toBe('granter')
    expect(opts.nonCriticalExtensionOptions).toHaveLength(2)
    expect(opts.nonCriticalExtensionOptions?.[1].typeUrl).toBe(
      TxExtension.typeUrl
    )
    expect(
      opts.nonCriticalExtensionOptions?.[1].value.selectedAuthenticators
    ).toEqual([5n, 5n])
  })

  test('selectAuthenticatorId prefers explicit, then first', () => {
    expect(
      selectAuthenticatorId({
        authenticatorIds: [3n, 4n],
        preferredId: 4n,
        chainId: 'morocco-1',
        address: 'terp1abc',
      })
    ).toBe(4n)

    expect(
      selectAuthenticatorId({
        authenticatorIds: [3n, 4n],
        chainId: 'morocco-1',
        address: 'terp1never-used-for-storage-xyz',
      })
    ).toBe(3n)

    expect(
      selectAuthenticatorId({
        authenticatorIds: [],
        chainId: 'morocco-1',
        address: 'terp1abc',
      })
    ).toBeUndefined()
  })

  test('txOptionsRequireDirectSigner detects extensions', () => {
    expect(txOptionsRequireDirectSigner(undefined)).toBe(false)
    expect(txOptionsRequireDirectSigner({ feeGranter: 'x' })).toBe(false)
    expect(
      txOptionsRequireDirectSigner(
        buildSmartAccountTxOptions({ messageCount: 1, authenticatorId: 1n })
      )
    ).toBe(true)
  })

  test('buildSmartAccountTxOptionsForMessages uses messages.length', () => {
    const opts = buildSmartAccountTxOptionsForMessages({
      messages: [{}, {}, {}],
      authenticatorId: 2n,
    })
    expect(
      opts.nonCriticalExtensionOptions?.[0].value.selectedAuthenticators
    ).toEqual([2n, 2n, 2n])
  })
})
