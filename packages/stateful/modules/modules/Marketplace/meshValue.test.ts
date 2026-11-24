import { describe, expect, test } from 'vitest'

import { MESH_STORAGE_KEY, parseMeshDescriptor } from '@dao-dao/utils'

import {
  buildMarketplaceMeshStorageValue,
  marketplaceFromModuleData,
} from './meshValue'

const services = {
  headstashServer: 'https://headstash.terp.network',
  headstashWss: 'wss://headstash.terp.network',
  merkleServer: 'https://hash.terp.network',
}

describe('marketplaceFromModuleData', () => {
  test('parses fixed + auction + buffer', () => {
    const m = marketplaceFromModuleData({
      fixedPriceContract: 'terp1fixed',
      auctionContract: 'terp1auction',
      contentBase: 'https://hash.terp.network/',
      acceptedDenom: 'uterp',
      minBufferBlocks: 7,
    })
    expect(m?.fixedPrice).toBe('terp1fixed')
    expect(m?.auction).toBe('terp1auction')
    expect(m?.contentBase).toBe('https://hash.terp.network')
    expect(m?.acceptedDenom).toBe('uterp')
    expect(m?.minBufferBlocks).toBe(7)
    expect(m?.modes).toEqual(['fixed', 'auction', 'buy_now'])
  })

  test('parses nftCollections into mesh marketplace block', () => {
    const m = marketplaceFromModuleData({
      fixedPriceContract: '',
      auctionContract: 'terp1auction',
      nftCollections: 'terp1nftA, terp1nftB',
      contentBase: '',
      acceptedDenom: 'uterp',
      minBufferBlocks: 7,
    })
    expect(m?.auction).toBe('terp1auction')
    expect(m?.nftCollections).toEqual(['terp1nftA', 'terp1nftB'])
  })

  test('returns undefined when empty', () => {
    expect(
      marketplaceFromModuleData({
        fixedPriceContract: '',
        auctionContract: '',
        contentBase: '',
        acceptedDenom: '',
        minBufferBlocks: 0,
      })
    ).toBeUndefined()
  })
})

describe('buildMarketplaceMeshStorageValue', () => {
  test('builds mesh.v1 from chain defaults + marketplace contracts', () => {
    const raw = buildMarketplaceMeshStorageValue({
      chainServices: services,
      data: {
        fixedPriceContract: 'terp1fixed',
        auctionContract: 'terp1auction',
        nftCollections: 'terp1nftcoll',
        contentBase: '',
        acceptedDenom: 'uterp',
        minBufferBlocks: 7,
      },
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.v).toBe(1)
    expect(mesh.query).toBe('https://headstash.terp.network')
    expect(mesh.relays).toContain('wss://headstash.terp.network')
    expect(mesh.marketplace?.fixedPrice).toBe('terp1fixed')
    expect(mesh.marketplace?.auction).toBe('terp1auction')
    expect(mesh.marketplace?.nftCollections).toEqual(['terp1nftcoll'])
    expect(mesh.marketplace?.acceptedDenom).toBe('uterp')
    expect(mesh.marketplace?.minBufferBlocks).toBe(7)
    // contentBase from merkleServer when module left empty
    expect(mesh.marketplace?.contentBase).toBe('https://hash.terp.network')
    expect(MESH_STORAGE_KEY).toBe('mesh.v1')
  })

  test('prefers valid meshJson and merges marketplace fields', () => {
    const raw = buildMarketplaceMeshStorageValue({
      chainServices: services,
      data: {
        fixedPriceContract: 'terp1from-module',
        auctionContract: '',
        contentBase: 'https://custom.hash',
        acceptedDenom: '',
        minBufferBlocks: 14,
        meshJson: JSON.stringify({
          v: 1,
          query: 'https://custom.query',
          relays: ['wss://custom.relay'],
          marketplace: { auction: 'terp1keep-auction' },
        }),
      },
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.query).toBe('https://custom.query')
    expect(mesh.relays).toEqual(['wss://custom.relay'])
    expect(mesh.marketplace?.fixedPrice).toBe('terp1from-module')
    expect(mesh.marketplace?.auction).toBe('terp1keep-auction')
    expect(mesh.marketplace?.contentBase).toBe('https://custom.hash')
    expect(mesh.marketplace?.minBufferBlocks).toBe(14)
  })

  test('falls back to defaults when meshJson is invalid', () => {
    const raw = buildMarketplaceMeshStorageValue({
      chainServices: services,
      data: {
        fixedPriceContract: 'terp1fixed',
        auctionContract: '',
        contentBase: '',
        acceptedDenom: '',
        minBufferBlocks: 7,
        meshJson: '{not-json',
      },
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.marketplace?.fixedPrice).toBe('terp1fixed')
    expect(mesh.query).toBe('https://headstash.terp.network')
  })
})
