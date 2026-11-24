/**
 * PrivateCorridor (display: "Private Bridge") — Cash App → BTC → private bridge → ZEC.
 *
 * SPEC: docs/plans/spectrum/DEMO-CASHAPP-ZEC-CORRIDOR.md §3 (intent) + §7 (UI).
 * This is a Module wizard for the corridor demo, NOT the Headstash airdrop claim module.
 *
 * DepositIntentV0 fields mirror the canonical packet so the UI can freeze a JSON shape
 * until the Corridor track ships pure encode/types. Prefer string for u64/32B digests
 * to avoid JS number precision issues.
 */

/**
 * Deployment environment for the corridor UI.
 * - production: real mint-router / notes / oracle bases + browser deposit wallet
 * - lab_simulated: CI / local lab only (explicit)
 * - lc_live: light-client-backed BTC/ZEC when lab stack is attached
 * - ict_local_funded: same workflow shape as production against local ict-rs /
 *   hash-market funded endpoints (not mainnet settlement)
 */
export type CorridorAssetBackend =
  | 'production'
  | 'lab_simulated'
  | 'lc_live'
  | 'ict_local_funded'

/** Bitcoin network for P2WPKH deposit address + QR. */
export type BtcNetwork = 'mainnet' | 'testnet'

/** Oracle bound policy from DepositIntentV0. v0 demo uses mid_gte_floor. */
export type OracleBoundPolicy = 'mid_gte_floor' | 'within_band'

/**
 * Canonical deposit intent packet (SPEC §3.1).
 * Preauth: dest_owner_binding + rate bounds are fixed before/with the BTC send.
 */
export type DepositIntentV0 = {
  version: 0
  /** e.g. cashapp-btc-zec-v0 */
  corridor_id: string
  /** bitcoin / sim tag */
  source_chain_tag: string
  /** zcash / sim tag */
  dest_chain_tag: string
  /** Fresh receive address (demo may be sim). */
  btc_deposit_addr: string
  /**
   * Once funded: bind to burn ν / claim_id material.
   * Before fund: intent id (32B hex).
   */
  btc_txid_or_intent_id: string
  /** Preauth diversified destination (opaque 32B hex handle). */
  dest_owner_binding: string
  /**
   * Optional timeout-recovery binding (32B domain hash). After expiry, only this
   * or dest_owner_binding may receive recovery — never operator seize.
   */
  recovery_owner_binding?: string
  /** UI-only truncated UA/bech32; not authority. */
  dest_display_hint?: string
  /** BTC / sim-BTC registry id (32B hex). */
  asset_in_id: string
  /** ZEC / sim-ZEC registry id (32B hex). */
  asset_out_id: string
  /** Absolute min ZEC-side units after swap (u64 as decimal string). */
  min_out_value: string
  /** Optional slip vs oracle mid (bps). */
  max_slippage_bps: number
  /** e.g. BTC-ZEC Connect market. */
  oracle_market_id: string
  oracle_bound_policy: OracleBoundPolicy
  /** Unix seconds. */
  created_at: number
  /** Intent expires; reject late mints. */
  expiry: number
  /**
   * domain_bind = H("terp-cashapp-intent-v0" ‖ canonical_bytes_without_domain_bind)
   * 32B hex.
   */
  domain_bind: string
}

/** DAO-stored variables for the PrivateCorridor module (production deployments). */
export type PrivateCorridorModuleData = {
  /** cw-headstash mint router (BridgeMintNote). Required for production path. */
  headstashContract: string
  /** Private notes HTTP base (hash-market HeadstashStore). */
  notesBase: string
  /** Oracle Connect bounds base (hash-market). */
  oracleBase: string
  /** Corridor id stamped into DepositIntentV0. */
  corridorId: string
  /**
   * production | lab_simulated | lc_live | ict_local_funded
   * Fail-closed reverify on all except lab_simulated.
   */
  assetBackend: CorridorAssetBackend
  /** Bitcoin network for deposit QR (mainnet for real Cash App rails). */
  btcNetwork: BtcNetwork
  /**
   * Optional Esplora HTTP base for D4 client re-verify (local regtest / funded
   * stack). When empty, uses public multi-fallback for mainnet/testnet.
   * Env override: NEXT_PUBLIC_BTC_ESPLORA.
   */
  esploraBase?: string
  /**
   * Season slug or notes path hs_id for list/PIR recover.
   * Defaults to headstashContract when empty.
   */
  notesHsId?: string
  /**
   * Prefer PIR recover when list length ≥ 1 (default true when notesBase set).
   * Direct GET remains available as fallback / debug.
   */
  preferPirRecover?: boolean
  /** Optional markdown intro above the wizard. */
  description: string
}

export type CorridorWizardStep =
  | 'preauth'
  | 'rate_policy'
  | 'deposit_wallet'
  | 'deposit'
  | 'status'
  | 'receipt'

/** Browser-generated deposit wallet (SelfRelay-style HD) + client proof + auth link. */
export type DepositWalletSession = {
  /** CosmJS bech32 identity from DirectSecp256k1HdWallet. */
  cosmosStyleAddress: string
  publicKeyHex: string
  btcDepositAddress: string
  bitcoinPaymentUri: string
  /** Auth deep link after proof (no mnemonic). */
  authLink: string
  /** Client-side proof digest over intent + wallet material. */
  proofDigest: string
  proofScheme: string
}

export type CorridorStatusPhase =
  | 'awaiting_deposit'
  | 'deposit_observed'
  | 'bridging'
  | 'swapping'
  | 'complete'
  | 'failed'

/** Wizard-local form before intent is sealed. */
export type CorridorWizardDraft = {
  /** Full diversified dest string (UA / bech32 / opaque). */
  destDisplay: string
  destOwnerBinding: string
  minOutValue: string
  maxSlippageBps: number
  oracleMarketId: string
  oracleBoundPolicy: OracleBoundPolicy
}

/**
 * Lab residual labels (must match harness SSOT).
 * UI must not celebrate these as chain egress / ZEC consensus success.
 */
export type CorridorFidelityLabel =
  | 'lab_film'
  | 'pure_record_lab'
  | 'lab_inventory_pay_simulated'
  | 'host_automation_film'
  | 'production_shaped'

/** Receipt artifact for demo film / UI (SPEC W7). */
export type CorridorReceipt = {
  intent: DepositIntentV0
  amountInDisplay: string
  amountOutDisplay: string
  /** Oracle mid used at swap (display units). */
  oracleMidUsed: string
  boundPolicy: OracleBoundPolicy
  mockRefs: {
    depositTxId: string
    bridgeMintRef: string
    swapRef: string
  }
  completedAt: number
  assetBackend: CorridorAssetBackend
  /**
   * Honest fidelity label. Lab / pure_record / simulated must never be shown as
   * "ZEC sent" or "egress complete (chain)".
   */
  fidelityLabel?: CorridorFidelityLabel
}
