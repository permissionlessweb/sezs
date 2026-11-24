import { describe, expect, test } from 'vitest'

import {
  PLEDGE_DEFAULT_IPFS_GATEWAY,
  PLEDGE_ETH_SSOT,
  detectPledgeDocKind,
  resolvePledgeDocUrl,
} from './pledgeDocument'

describe('pledgeDocument', () => {
  test('resolve bare CID with default gateway', () => {
    const r = resolvePledgeDocUrl('bafybeigdyrzt')
    expect(r).not.toBeNull()
    expect(r!.url).toBe(`${PLEDGE_DEFAULT_IPFS_GATEWAY}bafybeigdyrzt`)
    expect(r!.cid).toBe('bafybeigdyrzt')
  })

  test('resolve ipfs:// URI', () => {
    const r = resolvePledgeDocUrl(
      'ipfs://bafyabc/path.md',
      'https://ipfs.example/ipfs/'
    )
    expect(r!.url).toBe('https://ipfs.example/ipfs/bafyabc/path.md')
    expect(r!.cid).toBe('bafyabc')
  })

  test('resolve /ipfs/ path', () => {
    const r = resolvePledgeDocUrl(
      '/ipfs/QmHash123',
      'https://gw.test/ipfs'
    )
    expect(r!.url).toBe('https://gw.test/ipfs/QmHash123')
    expect(r!.cid).toBe('QmHash123')
  })

  test('absolute https passthrough', () => {
    const r = resolvePledgeDocUrl('https://example.com/pledge.html')
    expect(r!.url).toBe('https://example.com/pledge.html')
    expect(r!.cid).toBeUndefined()
  })

  test('empty input yields null', () => {
    expect(resolvePledgeDocUrl('')).toBeNull()
    expect(resolvePledgeDocUrl('   ')).toBeNull()
    expect(resolvePledgeDocUrl(null)).toBeNull()
  })

  test('detect HTML via content-type', () => {
    expect(detectPledgeDocKind('<p>x</p>', 'text/html; charset=utf-8')).toBe(
      'html'
    )
  })

  test('detect HTML via doctype sniff', () => {
    expect(
      detectPledgeDocKind('<!DOCTYPE html><html><body>hi</body></html>')
    ).toBe('html')
  })

  test('detect markdown via heading', () => {
    expect(detectPledgeDocKind('# Trustlessness\n\nWe pledge…')).toBe(
      'markdown'
    )
  })

  test('ETH SSOT does not invent a contract address', () => {
    expect(PLEDGE_ETH_SSOT.contract).toBeUndefined()
    expect(PLEDGE_ETH_SSOT.status).toBe('unknown')
  })

  test('fixture-style markdown body sniffs as markdown', () => {
    const fixture = [
      '# Trustlessness Pledge (test fixture)',
      '',
      'This is **fixture** markdown for unit and soft Playwright tests.',
      '',
      '## Commitments',
      '',
      '1. Prefer open verification over trust.',
    ].join('\n')
    expect(detectPledgeDocKind(fixture)).toBe('markdown')
    expect(detectPledgeDocKind(fixture, 'text/markdown')).toBe('markdown')
  })

  test('custom gateway trailing slash normalized', () => {
    const r = resolvePledgeDocUrl('bafyxx', 'https://gw.example/ipfs')
    expect(r!.url).toBe('https://gw.example/ipfs/bafyxx')
  })
})
