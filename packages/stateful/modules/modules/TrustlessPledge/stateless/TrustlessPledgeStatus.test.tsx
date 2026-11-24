import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { TrustlessPledgeStatus } from './TrustlessPledgeStatus'

describe('TrustlessPledgeStatus', () => {
  test('leads with website CTA and connect message when disconnected', () => {
    const html = renderToStaticMarkup(
      <TrustlessPledgeStatus
        collectionConfigured
        connected={false}
        manifestoCid="bafy1"
        pledgeSiteUrl="https://permissionless.money/pledge"
      />
    )
    expect(html).toContain('Connect to continue')
    expect(html).toContain('Trustlessness Pledge')
    expect(html).toContain('https://permissionless.money/pledge')
    expect(html).toContain('Visit Trustlessness Pledge')
  })

  test('shows pledged badge when hasPledged', () => {
    const html = renderToStaticMarkup(
      <TrustlessPledgeStatus
        collectionConfigured
        connected
        hasPledged
        mintCount={1}
        tokenId="7"
      />
    )
    expect(html).toContain('You have pledged')
    expect(html).toContain('token_id · 7')
    expect(html).toContain('disabled')
  })

  test('shows ready state and enabled button when not pledged', () => {
    const html = renderToStaticMarkup(
      <TrustlessPledgeStatus
        collectionConfigured
        connected
        hasPledged={false}
        manifestoCid="bafy1"
      />
    )
    expect(html).toContain('Ready when you are')
    // renderToStaticMarkup escapes & → &amp;
    expect(html).toMatch(/Sign &amp; mint pledge/)
  })

  test('unconfigured collection message', () => {
    const html = renderToStaticMarkup(
      <TrustlessPledgeStatus collectionConfigured={false} connected />
    )
    expect(html).toContain('Collection not configured')
  })

  test('defaults site URL to permissionless.money/pledge', () => {
    const html = renderToStaticMarkup(
      <TrustlessPledgeStatus collectionConfigured connected={false} />
    )
    expect(html).toContain('href="https://permissionless.money/pledge"')
  })
})
