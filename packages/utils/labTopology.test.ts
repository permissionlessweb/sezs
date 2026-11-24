import { describe, expect, it } from 'vitest'

import {
  LAB_BUZZ_DUAL_HTTP,
  LAB_BUZZ_RELAY_HTTP,
  LAB_CHAIN_ID,
  LAB_HASHMERCHANT_HTTP,
  LAB_HERMES_OPS_HTTP,
  LAB_MARKETPLACE_MIRROR,
  getLabChainAllowlist,
  isForeignPublicChainUrl,
  isLabAllowlistedChain,
  isLabShellMode,
  labModuleDefaultValues,
  resolveLabBuzzEmbedShell,
  resolveLabHermesOps,
} from './labTopology'
import { LAB_BUZZ_RELAY_HTTP_ORIGIN } from './embedFriction'

describe('labTopology (P2.1 smart defaults)', () => {
  it('keeps relay SoT on deploy-host and dual shell on SDA host', () => {
    expect(LAB_BUZZ_RELAY_HTTP).toBe('http://localhost:3000')
    expect(LAB_BUZZ_RELAY_HTTP).toBe(LAB_BUZZ_RELAY_HTTP_ORIGIN)
    expect(LAB_BUZZ_DUAL_HTTP).toBe('http://127.0.0.1:3001')
    expect(LAB_HERMES_OPS_HTTP).toBe('http://127.0.0.1:9119')
    expect(LAB_HASHMERCHANT_HTTP).toBe('http://localhost:19090')
  })

  it('resolveLabBuzzEmbedShell prefers dual shell (not relay root)', () => {
    const shell = resolveLabBuzzEmbedShell()
    expect(shell).toBe(LAB_BUZZ_DUAL_HTTP)
    expect(shell).not.toContain('localhost:3000')
  })

  it('resolveLabHermesOps defaults to SDA-host tunnel', () => {
    expect(resolveLabHermesOps()).toBe(LAB_HERMES_OPS_HTTP)
  })

  it('labModuleDefaultValues: buzz embed shell + hermes build-host', () => {
    const buzz = labModuleDefaultValues('buzz')
    expect(buzz.embedBaseUrl).toBe(LAB_BUZZ_DUAL_HTTP)
    expect(buzz.defaultView).toBe('public')

    const hermes = labModuleDefaultValues('hermes_ops')
    expect(hermes.deepLinkUrl).toBe(LAB_HERMES_OPS_HTTP)
    expect(hermes.deepLinkOnly).toBe(true)
  })

  it('labModuleDefaultValues: event_hub open walkthrough + not relay root', () => {
    const hub = labModuleDefaultValues('event_hub')
    expect(hub.buzzEmbedBaseUrl).toBe(LAB_BUZZ_DUAL_HTTP)
    expect(hub.hermesDeepLinkUrl).toBe(LAB_HERMES_OPS_HTTP)
    expect(hub.buzzGate).toBe('public')
    // No invented ceremony: open policy until NEXT_PUBLIC_CEREMONY is set.
    expect(hub.registrationPolicy).toBe('open')
    expect(hub.ceremonyContract).toBeUndefined()
    expect(hub.defaultEventSlug).toBe('lab-demo')
  })

  it('labModuleDefaultValues: marketplace mirror + HM content base', () => {
    const m = labModuleDefaultValues('marketplace')
    expect(m.fixedPriceContract).toBe(LAB_MARKETPLACE_MIRROR)
    expect(m.contentBase).toBe(LAB_HASHMERCHANT_HTTP)
    expect(m.acceptedDenom).toBe('uterp')
  })

  it('labModuleDefaultValues: collab_ops showLiveEmbeds for lab demos', () => {
    const c = labModuleDefaultValues('collab_ops')
    expect(c.showLiveEmbeds).toBe(true)
    expect(c.buzzEmbedBaseUrl).toBe(LAB_BUZZ_DUAL_HTTP)
  })

  it('flags foreign public RPC hosts (cosmos.directory / polkachu / stargaze)', () => {
    expect(
      isForeignPublicChainUrl('https://rpc.cosmos.directory/stargazetestnet')
    ).toBe(true)
    expect(
      isForeignPublicChainUrl('https://juno-testnet-rpc.polkachu.com')
    ).toBe(true)
    expect(isForeignPublicChainUrl('http://127.0.0.1:3000/lab-rpc')).toBe(false)
    expect(isForeignPublicChainUrl('http://192.168.0.4:26657')).toBe(false)
  })

  it('lab shell mode auto when CHAIN_ID=120u-1 and !MAINNET', () => {
    const prevShell = process.env.NEXT_PUBLIC_LAB_SHELL
    const prevMainnet = process.env.NEXT_PUBLIC_MAINNET
    const prevChain = process.env.NEXT_PUBLIC_CHAIN_ID
    try {
      delete process.env.NEXT_PUBLIC_LAB_SHELL
      process.env.NEXT_PUBLIC_MAINNET = 'false'
      process.env.NEXT_PUBLIC_CHAIN_ID = LAB_CHAIN_ID
      expect(isLabShellMode()).toBe(true)
      expect(getLabChainAllowlist()).toEqual([LAB_CHAIN_ID])
      expect(isLabAllowlistedChain(LAB_CHAIN_ID)).toBe(true)
      expect(isLabAllowlistedChain('elgafar-1')).toBe(false)
      expect(isLabAllowlistedChain('uni-7')).toBe(false)

      process.env.NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST = '120u-1,morocco-1'
      expect(getLabChainAllowlist()).toEqual(['120u-1', 'morocco-1'])
      expect(isLabAllowlistedChain('morocco-1')).toBe(true)
    } finally {
      if (prevShell === undefined) delete process.env.NEXT_PUBLIC_LAB_SHELL
      else process.env.NEXT_PUBLIC_LAB_SHELL = prevShell
      if (prevMainnet === undefined) delete process.env.NEXT_PUBLIC_MAINNET
      else process.env.NEXT_PUBLIC_MAINNET = prevMainnet
      if (prevChain === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ID
      else process.env.NEXT_PUBLIC_CHAIN_ID = prevChain
      delete process.env.NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST
    }
  })
})
