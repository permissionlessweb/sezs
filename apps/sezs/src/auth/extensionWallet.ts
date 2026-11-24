/**
 * Zafu Cosmos provider helpers used only where an on-chain signature is
 * required (usher consume via window.zafu enable / signAmino). Login no
 * longer uses this path; see zidLogin.ts and docs/ZAFU-CONNECT.md.
 *
 * Zafu’s prefixFor uses chainId.split('-')[0] when the chain is not in its
 * registry. enable('sezs-local-1') would yield a sezs1 address. Request
 * terp-1 so the derived bech32 prefix is terp. See rotkonetworks/zafu#198.
 */
import { CHAIN, isTerp1 } from './chainConfig.ts'

export type ExtensionKind = 'zafu'

type CosmosExtension = {
  enable: (chainId: string) => Promise<void>
  getKey: (chainId: string) => Promise<{ bech32Address?: string; address?: string; pubKey?: Uint8Array }>
  signAmino?: (chainId: string, signer: string, signDoc: unknown) => Promise<unknown>
  experimentalSuggestChain?: (info: unknown) => Promise<void>
}

export type ExtensionWindow = {
  zafu?: CosmosExtension
  document?: { readyState?: string }
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

export const ZAFU_TERP_CHAIN_ID = 'terp-1'
export const EXTENSION_READY_EVENTS: Record<ExtensionKind, readonly string[]> = {
  zafu: ['zafu_keystorechange'],
}

const WAIT_MS = 3000
const POLL_MS = 50

export const extensionLabel = (_k: ExtensionKind = 'zafu') => 'Zafu'

export const requestChainId = (kind: ExtensionKind = 'zafu'): string => {
  void kind
  const head = CHAIN.chainId.split('-')[0]
  return head === 'terp' ? CHAIN.chainId : ZAFU_TERP_CHAIN_ID
}

const hostWindow = (): ExtensionWindow | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as ExtensionWindow)

export function extensionPresent(kind: ExtensionKind = 'zafu', win: ExtensionWindow | undefined = hostWindow()): boolean {
  void kind
  if (!win) return false
  const api = win.zafu
  return !!api && typeof api.enable === 'function' && typeof api.getKey === 'function'
}

export function waitForExtension(
  kind: ExtensionKind = 'zafu',
  opts: { timeoutMs?: number; pollMs?: number; clock?: { now?: () => number; sleep?: (ms: number, cb: () => void) => void } } = {},
  win: ExtensionWindow | undefined = hostWindow(),
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? WAIT_MS
  const pollMs = opts.pollMs ?? POLL_MS
  if (!win) return Promise.resolve(false)
  if (extensionPresent(kind, win)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const events = new Set<string>(EXTENSION_READY_EVENTS[kind])
    if (win.document?.readyState && win.document.readyState !== 'complete') events.add('load')
    const sleep = opts.clock?.sleep || ((ms, cb) => setTimeout(cb, ms))

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      for (const ev of events) win.removeEventListener(ev, onMaybe)
      resolve(ok)
    }

    const onMaybe = () => {
      if (extensionPresent(kind, win)) finish(true)
    }

    for (const ev of events) win.addEventListener(ev, onMaybe)
    const poll = () => {
      if (settled) return
      onMaybe()
      if (!settled) sleep(pollMs, poll)
    }
    sleep(timeoutMs, () => finish(false))
    poll()
    onMaybe()
  })
}
