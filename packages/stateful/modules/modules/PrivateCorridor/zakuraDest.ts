/**
 * Zakura / ZEC destination helpers for Private Bridge preauth (D6).
 *
 * UX primary = **paste-first**. Optional “use local Zakura demo dest” falls back to
 * corridor regtest miner when node has no wallet RPC (Zakura core ≠ wallet).
 *
 * Soft-validate bech32-ish prefixes; fail-closed on empty dest.
 * Binding domain **must** match harness `zakura_local.rs` + golden vector:
 *   docs/plans/spectrum/e2e/zakura/golden-dest-binding.json
 *
 * Env (browser): NEXT_PUBLIC_ZAKURA_RPC — JSON-RPC base
 *   Corridor regtest default: http://127.0.0.1:18232
 *   (see docs/plans/spectrum/e2e/zakura/)
 * Optional: NEXT_PUBLIC_ZAKURA_DEMO_DEST — fixed demo UA/t-addr when no wallet RPC
 *
 * No mainnet ZEC send required for lab / local funded film.
 */

/** Domain tag — SSOT with harness DEST_BINDING_DOMAIN_PREFIX. */
export const DEST_BINDING_DOMAIN = 'terp-dest-binding-v0'

/** Transparent regtest P2PKH from e2e/zakura/node-corridor.toml miner_address. */
export const CORRIDOR_REGTEST_MINER_DEST =
  'tmJymvcUCn1ctbghvTJpXBwHiMEB8P6wxNV'

/**
 * Primary golden owner_binding hex for CORRIDOR_REGTEST_MINER_DEST.
 * Must match golden-dest-binding.json sample id=corridor_regtest_miner.
 */
export const GOLDEN_OWNER_BINDING_HEX =
  '8b5cac11e39905d56126a0c538b84ff8daa379d8009d4e8b121112479607f09b'

/** Default local RPC (corridor compose, host network). */
export const DEFAULT_ZAKURA_RPC = 'http://127.0.0.1:18232'

/** Preimage string for dest → owner_binding (debug / tests). */
export const destBindingPreimage = (destDisplay: string): string =>
  `${DEST_BINDING_DOMAIN}|${destDisplay.trim()}`

export type ZecDestKind =
  | 'unified'
  | 'sapling'
  | 'transparent'
  | 'demo_handle'
  | 'unknown'

export type SoftValidateDest = {
  ok: boolean
  kind: ZecDestKind
  /** Short operator-facing note */
  hint: string
  normalized: string
}

/**
 * Domain-separated dest → owner_binding hex (32 bytes).
 * Same digest as harness `owner_binding_hex` / shell `zakura-local.sh dest`.
 * Prefer this (or mock.bindingFromDestDisplay) — both use DEST_BINDING_DOMAIN.
 */
export const destOwnerBindingHex = async (
  destDisplay: string
): Promise<string> => {
  const pre = destBindingPreimage(destDisplay)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(pre)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  }
  // Non-browser fallback is not cryptographic — operators must use browser /
  // harness for production seals. Keep deterministic for tests only.
  let h = 0
  for (let i = 0; i < pre.length; i++) {
    h = (Math.imul(31, h) + pre.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return (hex.repeat(8)).slice(0, 64).padEnd(64, '0')
}

/** Fail-closed empty dest (Wizard preauth gate). */
export const requireZecDest = (raw: string): SoftValidateDest => {
  const soft = softValidateZecDest(raw)
  if (!soft.ok) {
    return soft
  }
  return soft
}

/**
 * Assert UI digest matches primary golden (when SubtleCrypto available).
 * Returns false in non-crypto envs rather than throwing.
 */
export const assertMatchesGoldenPrimary = async (
  destDisplay: string = CORRIDOR_REGTEST_MINER_DEST
): Promise<boolean> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return false
  }
  const got = await destOwnerBindingHex(destDisplay)
  return (
    destDisplay.trim() === CORRIDOR_REGTEST_MINER_DEST &&
    got === GOLDEN_OWNER_BINDING_HEX
  )
}

/** Soft prefix check — not full bech32m decode (minimize deps). */
export const softValidateZecDest = (raw: string): SoftValidateDest => {
  const s = raw.trim()
  if (!s) {
    return {
      ok: false,
      kind: 'unknown',
      hint: 'Empty destination — paste a UA/t-addr or use local Zakura demo dest',
      normalized: '',
    }
  }

  // Unified addresses (mainnet / testnet / regtest-ish)
  if (
    s.startsWith('u1') ||
    s.startsWith('utest1') ||
    s.startsWith('uregtest1')
  ) {
    const minLen = s.startsWith('u1') ? 50 : 40
    return {
      ok: s.length >= minLen,
      kind: 'unified',
      hint: s.length >= minLen ? 'Unified address (UA)' : 'UA looks truncated',
      normalized: s,
    }
  }

  // Sapling
  if (s.startsWith('zs1') || s.startsWith('ztestsapling1')) {
    return {
      ok: s.length >= 50,
      kind: 'sapling',
      hint: s.length >= 50 ? 'Sapling address' : 'Sapling address looks short',
      normalized: s,
    }
  }

  // Transparent: t1/t3 mainnet, tm testnet, tex / t-addr variants
  if (
    s.startsWith('t1') ||
    s.startsWith('t3') ||
    s.startsWith('tm') ||
    s.startsWith('tex1')
  ) {
    return {
      ok: s.length >= 30,
      kind: 'transparent',
      hint: s.length >= 30 ? 'Transparent ZEC address' : 't-addr looks short',
      normalized: s,
    }
  }

  // Local demo / sim handles used in STATUS film
  if (
    s.startsWith('u1sim_') ||
    s.includes('diversified_zec') ||
    s.startsWith('demo_zec_')
  ) {
    return {
      ok: true,
      kind: 'demo_handle',
      hint: 'Demo handle (not a chain UA — lab / preauth digest only)',
      normalized: s,
    }
  }

  // Opaque pastes still bind via H(dest); warn softly
  if (s.length >= 16) {
    return {
      ok: true,
      kind: 'unknown',
      hint:
        'Unrecognized prefix — will still bind as owner_binding digest (paste UA preferred)',
      normalized: s,
    }
  }

  return {
    ok: false,
    kind: 'unknown',
    hint: 'Too short for a ZEC dest / demo handle',
    normalized: s,
  }
}

export type ZakuraDestResult =
  | {
      ok: true
      address: string
      source: 'rpc' | 'demo_env' | 'health_only'
      method?: string
      networkHint?: string
    }
  | { ok: false; error: string; reachable?: boolean }

const trimSlash = (u: string) => u.replace(/\/$/, '')

/** Resolve RPC base from env (Next public) or optional override. */
export const resolveZakuraRpcBase = (override?: string): string => {
  if (override?.trim()) {
    return trimSlash(override.trim())
  }
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ZAKURA_RPC) {
    return trimSlash(process.env.NEXT_PUBLIC_ZAKURA_RPC)
  }
  // Empty = paste-first / offline demo dest (no browser→node CORS assumption).
  // Operators may set NEXT_PUBLIC_ZAKURA_RPC=http://127.0.0.1:18232 for health.
  return ''
}

/**
 * Offline / funded-stack demo dest without browser RPC.
 * Same string as harness REGTEST_MINER_DEST + golden primary sample.
 */
export const localZakuraDemoDestOffline = (): {
  address: string
  ownerBindingHex: typeof GOLDEN_OWNER_BINDING_HEX
  source: 'golden_regtest_miner'
} => ({
  address: CORRIDOR_REGTEST_MINER_DEST,
  ownerBindingHex: GOLDEN_OWNER_BINDING_HEX,
  source: 'golden_regtest_miner',
})

export const resolveZakuraDemoDestEnv = (): string => {
  if (
    typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_ZAKURA_DEMO_DEST
  ) {
    return process.env.NEXT_PUBLIC_ZAKURA_DEMO_DEST.trim()
  }
  return ''
}

type JsonRpcResponse = {
  result?: unknown
  error?: { code?: number; message?: string }
  id?: number | string
}

/**
 * POST JSON-RPC 2.0 to Zakura / zcashd-compat.
 * Browser requires CORS on the node or a local proxy.
 */
export const zakuraJsonRpc = async <T = unknown>(
  rpcBase: string,
  method: string,
  params: unknown[] = [],
  signal?: AbortSignal
): Promise<{ ok: true; result: T } | { ok: false; error: string }> => {
  const base = trimSlash(rpcBase)
  if (!base) {
    return { ok: false, error: 'ZAKURA_RPC not set' }
  }
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal,
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} from ${base}` }
    }
    const body = (await res.json()) as JsonRpcResponse
    if (body.error) {
      return {
        ok: false,
        error: body.error.message || `rpc error ${body.error.code ?? ''}`,
      }
    }
    return { ok: true, result: body.result as T }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

const extractAddressString = (result: unknown): string | null => {
  if (typeof result === 'string' && result.trim()) {
    return result.trim()
  }
  if (result && typeof result === 'object') {
    const o = result as Record<string, unknown>
    for (const k of ['address', 'unified', 'transparent', 'result']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) {
        return (o[k] as string).trim()
      }
    }
  }
  return null
}

/**
 * Try wallet-style RPCs for a fresh receive address.
 * Zakura (Zebra) often has no wallet — then fall back to demo env dest.
 */
export const fetchZakuraDemoDest = async (opts?: {
  rpcBase?: string
  signal?: AbortSignal
}): Promise<ZakuraDestResult> => {
  const rpc = resolveZakuraRpcBase(opts?.rpcBase)
  const demoEnv = resolveZakuraDemoDestEnv()

  if (!rpc) {
    // No RPC env: demo dest env, else corridor regtest miner for lab preauth.
    const address = demoEnv || CORRIDOR_REGTEST_MINER_DEST
    return {
      ok: true,
      address,
      source: 'demo_env',
      method: demoEnv
        ? 'NEXT_PUBLIC_ZAKURA_DEMO_DEST'
        : 'corridor_regtest_miner_offline',
    }
  }

  // Probe reachability
  const info = await zakuraJsonRpc<Record<string, unknown>>(
    rpc,
    'getblockchaininfo',
    [],
    opts?.signal
  )
  let networkHint: string | undefined
  if (info.ok && info.result && typeof info.result === 'object') {
    const chain = (info.result as { chain?: string }).chain
    if (chain) {
      networkHint = chain
    }
  }

  // Wallet methods (zcashd-compat / lightwalletd-adjacent stacks)
  const attempts: { method: string; params: unknown[] }[] = [
    { method: 'z_getnewaddress', params: [] },
    { method: 'z_getnewaddress', params: ['unified'] },
    { method: 'getnewaddress', params: [] },
    { method: 'z_listunifiedreceivers', params: [] },
  ]

  for (const a of attempts) {
    const r = await zakuraJsonRpc(rpc, a.method, a.params, opts?.signal)
    if (!r.ok) {
      continue
    }
    const addr = extractAddressString(r.result)
    if (addr) {
      return {
        ok: true,
        address: addr,
        source: 'rpc',
        method: a.method,
        networkHint,
      }
    }
    // z_listunifiedreceivers may return map of receivers
    if (r.result && typeof r.result === 'object' && !Array.isArray(r.result)) {
      const map = r.result as Record<string, unknown>
      for (const v of Object.values(map)) {
        if (typeof v === 'string' && softValidateZecDest(v).ok) {
          return {
            ok: true,
            address: v,
            source: 'rpc',
            method: a.method,
            networkHint,
          }
        }
      }
    }
  }

  if (demoEnv) {
    return {
      ok: true,
      address: demoEnv,
      source: 'demo_env',
      method: 'NEXT_PUBLIC_ZAKURA_DEMO_DEST',
      networkHint,
    }
  }

  // Zakura core has no wallet — on regtest use corridor miner_address as demo dest.
  const chainLower = (networkHint || '').toLowerCase()
  if (info.ok && (chainLower.includes('regtest') || chainLower === 'regtest')) {
    return {
      ok: true,
      address: CORRIDOR_REGTEST_MINER_DEST,
      source: 'rpc',
      method: 'regtest_miner_address',
      networkHint: networkHint || 'regtest',
    }
  }

  if (info.ok) {
    return {
      ok: false,
      reachable: true,
      error: networkHint
        ? `Zakura RPC reachable (chain=${networkHint}) but no wallet address RPC. Paste a UA, set NEXT_PUBLIC_ZAKURA_DEMO_DEST, or run: bash docs/plans/spectrum/e2e/zakura/zakura-local.sh dest`
        : 'Zakura RPC reachable but no wallet address method. Paste a UA or set NEXT_PUBLIC_ZAKURA_DEMO_DEST.',
    }
  }

  // RPC down / CORS: still offer corridor regtest miner so preauth film works offline.
  return {
    ok: true,
    address: CORRIDOR_REGTEST_MINER_DEST,
    source: 'demo_env',
    method: 'corridor_regtest_miner_offline',
    networkHint: !info.ok ? `rpc_error:${info.error}` : undefined,
  }
}
