import { describe, expect, test } from 'vitest'

import {
  contentPath,
  contentResolveUrl,
  enrichListingFromContentBody,
  parseCid,
  parseMarketplaceContentBody,
  resolveEventBodyProgressive,
  resolveMediaUrl,
  resolveOffchainBody,
} from './contentPlane'

describe('parseCid', () => {
  test('bare sha256 preferred', () => {
    const h = 'ab'.repeat(32)
    const p = parseCid(h)
    expect(p.kind).toBe('bud_sha256')
    expect(p.value).toBe(h)
    expect(contentPath(p)).toBe(`/content/${h}`)
  })

  test('bud, sha256, and budsha256 prefixes', () => {
    const h = 'cd'.repeat(32)
    expect(parseCid(`bud:${h}`).value).toBe(h)
    expect(parseCid(`sha256:${h}`).value).toBe(h)
    expect(parseCid(`budsha256:${h}`).value).toBe(h)
    expect(parseCid('ipfs:bafybeigdyrzt').kind).toBe('ipfs')
    expect(contentPath(parseCid('ipfs:bafybeigdyrzt'))).toBe(
      '/content/by-ipfs/bafybeigdyrzt'
    )
  })

  test('reject garbage', () => {
    expect(() => parseCid('')).toThrow()
    expect(() => parseCid('not-a-cid')).toThrow()
    expect(() => parseCid('budsha256:aaa')).toThrow()
  })
})

describe('resolveOffchainBody', () => {
  test('fetches content plane URL', async () => {
    const h = '11'.repeat(32)
    const body = '{"title":"x"}'
    const { text, url, parsed } = await resolveOffchainBody({
      cid: h,
      contentBase: 'https://hash.example',
      fetchImpl: async (input) => {
        expect(String(input)).toBe(`https://hash.example/content/${h}`)
        return new Response(body, { status: 200 })
      },
    })
    expect(text).toBe(body)
    expect(parsed.kind).toBe('bud_sha256')
    expect(url).toContain(h)
  })
})

describe('resolveEventBodyProgressive', () => {
  test('on-chain first', async () => {
    const r = await resolveEventBodyProgressive({
      on_chain: true,
      e: '{"title":"on"}',
    })
    expect(r.source).toBe('on_chain')
    expect((r.body as { title: string }).title).toBe('on')
  })

  test('off-chain via content plane', async () => {
    const h = '22'.repeat(32)
    const r = await resolveEventBodyProgressive({
      on_chain: false,
      cid: h,
      contentBase: 'https://bud.test',
      fetchImpl: async () => new Response('{"title":"off"}', { status: 200 }),
    })
    expect(r.source).toBe('content_plane')
    expect((r.body as { title: string }).title).toBe('off')
  })

  test('none when missing', async () => {
    const r = await resolveEventBodyProgressive({ on_chain: false })
    expect(r.source).toBe('none')
  })
})

describe('contentResolveUrl', () => {
  test('trims base slash', () => {
    const h = '33'.repeat(32)
    expect(contentResolveUrl('https://x/', h)).toBe(`https://x/content/${h}`)
  })
})

describe('resolveMediaUrl', () => {
  test('passes through https', () => {
    expect(resolveMediaUrl('https://cdn.example/a.png')).toBe(
      'https://cdn.example/a.png'
    )
  })

  test('maps bud cid to content plane', () => {
    const h = 'cd'.repeat(32)
    expect(
      resolveMediaUrl(`sha256:${h}`, { contentBase: 'https://bud.test/' })
    ).toBe(`https://bud.test/content/${h}`)
  })

  test('maps ipfs via gateway when provided', () => {
    expect(
      resolveMediaUrl('ipfs:bafyabc', {
        contentBase: 'https://bud.test',
        ipfsGateway: 'https://ipfs.io/ipfs',
      })
    ).toBe('https://ipfs.io/ipfs/bafyabc')
  })
})

describe('parseMarketplaceContentBody + enrich', () => {
  test('parses name/images', () => {
    const b = parseMarketplaceContentBody({
      name: 'Demo Tee',
      description: 'soft cotton',
      images: ['https://img.example/tee.png'],
    })
    expect(b?.name).toBe('Demo Tee')
    expect(b?.images?.[0]).toContain('tee')
  })

  test('enrich prefers content title when title is sku default', () => {
    const row = enrichListingFromContentBody(
      {
        title: 'SKU-1',
        sku: 'SKU-1',
        contentCid: 'aa'.repeat(32),
      },
      { title: 'Pretty Name', image: 'https://x/y.png' }
    )
    expect(row.title).toBe('Pretty Name')
    expect(row.imageUrl).toBe('https://x/y.png')
  })

  test('enrich resolves bud/ipfs image fields via content plane', () => {
    const sha = 'bb'.repeat(32)
    const row = enrichListingFromContentBody(
      { title: 'SKU-1', sku: 'SKU-1' },
      { image: `bud:${sha}` },
      { contentBase: 'https://hash.example' }
    )
    expect(row.imageUrl).toBe(`https://hash.example/content/${sha}`)

    const ipfs = enrichListingFromContentBody(
      { title: 'A', sku: 'A' },
      { image_url: 'ipfs://bafybeigdyrzt' },
      { contentBase: 'https://hash.example' }
    )
    expect(ipfs.imageUrl).toBe(
      'https://hash.example/content/by-ipfs/bafybeigdyrzt'
    )
  })

  test('enrich does not clobber non-sku title', () => {
    const row = enrichListingFromContentBody(
      {
        title: 'Curated Title',
        sku: 'SKU-1',
      },
      { title: 'Nostr Name' }
    )
    expect(row.title).toBe('Curated Title')
  })
})
