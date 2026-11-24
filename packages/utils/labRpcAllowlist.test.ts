import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChainId } from '@dao-dao/types'

/**
 * Unit tests for lab RPC gating. Import chain helpers only after env is set so
 * isLabShellMode() is true at call time (runtime env read).
 */
describe('lab RPC allowlist (getRpcForChainId)', () => {
  const prev = {
    shell: process.env.NEXT_PUBLIC_LAB_SHELL,
    mainnet: process.env.NEXT_PUBLIC_MAINNET,
    chain: process.env.NEXT_PUBLIC_CHAIN_ID,
    allow: process.env.NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST,
    labRpc: process.env.NEXT_PUBLIC_LAB_RPC,
    labLcd: process.env.NEXT_PUBLIC_LAB_LCD,
  }

  afterEach(() => {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    restore('NEXT_PUBLIC_LAB_SHELL', prev.shell)
    restore('NEXT_PUBLIC_MAINNET', prev.mainnet)
    restore('NEXT_PUBLIC_CHAIN_ID', prev.chain)
    restore('NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST', prev.allow)
    restore('NEXT_PUBLIC_LAB_RPC', prev.labRpc)
    restore('NEXT_PUBLIC_LAB_LCD', prev.labLcd)
    vi.resetModules()
  })

  it('blocks stargaze/juno RPC and never returns cosmos.directory in lab shell', async () => {
    process.env.NEXT_PUBLIC_LAB_SHELL = 'true'
    process.env.NEXT_PUBLIC_MAINNET = 'false'
    process.env.NEXT_PUBLIC_CHAIN_ID = '120u-1'
    process.env.NEXT_PUBLIC_LAB_RPC = 'http://127.0.0.1:3000/lab-rpc'
    process.env.NEXT_PUBLIC_LAB_LCD = 'http://127.0.0.1:3000/lab-lcd'
    delete process.env.NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST

    vi.resetModules()
    const { getRpcForChainId, getLcdForChainId } = await import('./chain')

    const labRpc = getRpcForChainId(ChainId.TerpTestnet)
    expect(labRpc).toContain('lab-rpc')
    expect(labRpc).not.toMatch(/cosmos\.directory/)

    // Preferred lab RPC is sticky across offsets (no foreign fallback).
    expect(getRpcForChainId(ChainId.TerpTestnet, 5)).toBe(labRpc)

    expect(() => getRpcForChainId(ChainId.StargazeTestnet)).toThrow(
      /Lab shell: foreign chain RPC blocked/
    )
    expect(() => getRpcForChainId(ChainId.JunoTestnet)).toThrow(
      /Lab shell: foreign chain RPC blocked/
    )
    expect(() => getLcdForChainId(ChainId.StargazeMainnet)).toThrow(
      /Lab shell: foreign chain LCD blocked/
    )
  })
})
