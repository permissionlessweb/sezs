import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode.react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import {
  Button,
  CopyToClipboard,
  InputLabel,
  SegmentedControls,
  TextInput,
} from '@dao-dao/stateless'

import {
  buildClientWalletProof,
  buildCorridorAuthLink,
  clearDepositMnemonic,
  generateBrowserDepositWallet,
  persistDepositMnemonic,
  type BrowserDepositWallet,
} from './browserWallet'
import {
  hostAutomationHint,
  runProductionPostDepositSequence,
} from './automationClient'
import type { ReverifyResult } from './btcReverify'
import {
  openCorridorWatch,
  reportLabObservation,
  subscribeCorridorDeposits,
  type DepositObservation,
} from './depositNotify'
import {
  STATUS_FILM_PHASES,
  bindingFromDestDisplay,
  buildDepositIntent,
  buildMockSuccessReceipt,
  defaultWizardDraft,
  isIctLocalFundedBackend,
  isIntentExpired,
  isLabSimulatedBackend,
  isProductionBackend,
  statusPhaseLabel,
} from './mock'
import {
  CorridorReceipt,
  CorridorStatusPhase,
  CorridorWizardDraft,
  CorridorWizardStep,
  DepositIntentV0,
  DepositWalletSession,
  PrivateCorridorModuleData,
} from './types'
import {
  formatRecoverSummaryLine,
  listCorridorNoteKeys,
  recoverCorridorNote,
} from './notesRecover'
import {
  fetchZakuraDemoDest,
  softValidateZecDest,
  type SoftValidateDest,
} from './zakuraDest'
import type { NoteRecoverSummary } from '@dao-dao/utils'

const STEPS: { id: CorridorWizardStep; label: string }[] = [
  { id: 'preauth', label: '1. ZEC dest' },
  { id: 'rate_policy', label: '2. Rate' },
  { id: 'deposit_wallet', label: '3. Deposit wallet' },
  { id: 'deposit', label: '4. QR + auth' },
  { id: 'status', label: '5. Status' },
  { id: 'receipt', label: '6. Receipt' },
]

type Props = {
  moduleData: PrivateCorridorModuleData
}

/**
 * Private Bridge demo wizard:
 * 1) Preauth diversified ZEC destination
 * 2) Rate / oracle policy
 * 3) Generate browser HD deposit wallet (SelfRelay-style DirectSecp256k1HdWallet.generate(24))
 * 4) Client proof + auth link + Bitcoin QR to fund that wallet
 * 5–6) Status film + receipt
 */
export const PrivateCorridorWizard = ({ moduleData }: Props) => {
  const { t } = useTranslation()
  const {
    corridorId,
    assetBackend,
    notesBase,
    oracleBase,
    headstashContract,
    btcNetwork,
    esploraBase,
    notesHsId,
    preferPirRecover,
  } = moduleData

  const labOnly = isLabSimulatedBackend(assetBackend)
  const production = isProductionBackend(assetBackend)
  const ictFunded = isIctLocalFundedBackend(assetBackend)

  const [step, setStep] = useState<CorridorWizardStep>('preauth')
  const [draft, setDraft] = useState<CorridorWizardDraft>(defaultWizardDraft)
  const [intent, setIntent] = useState<DepositIntentV0 | null>(null)
  const [browserWallet, setBrowserWallet] =
    useState<BrowserDepositWallet | null>(null)
  const [walletSession, setWalletSession] =
    useState<DepositWalletSession | null>(null)
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [statusPhase, setStatusPhase] =
    useState<CorridorStatusPhase>('awaiting_deposit')
  const [receipt, setReceipt] = useState<CorridorReceipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [bindingPreview, setBindingPreview] = useState('')
  const [depositSubStatus, setDepositSubStatus] = useState<string>('')
  const [oracleMidHint, setOracleMidHint] = useState<string>('')
  const [destSoft, setDestSoft] = useState<SoftValidateDest | null>(null)
  const [zakuraStatus, setZakuraStatus] = useState<string>('')
  const [reverifyHint, setReverifyHint] = useState<string>('')
  const [lastObservation, setLastObservation] =
    useState<DepositObservation | null>(null)
  const [reverifyBlocked, setReverifyBlocked] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)
  const autoAbortRef = useRef({ aborted: false })
  const postDepositStartedRef = useRef(false)

  // Notes recover (PIR preferred) — owner key never leaves browser.
  const [recoverAddr, setRecoverAddr] = useState('')
  const [recoverOwnerKeyHex, setRecoverOwnerKeyHex] = useState('')
  const [recoverList, setRecoverList] = useState<string[]>([])
  const [recoverSummary, setRecoverSummary] =
    useState<NoteRecoverSummary | null>(null)
  const [recoverError, setRecoverError] = useState('')
  const [recoverBusy, setRecoverBusy] = useState(false)

  // Prefer notesBase (unified hash-market); fall back to oracleBase.
  const notifyBase = (notesBase || oracleBase || '').replace(/\/$/, '')
  const notesHs =
    (notesHsId || '').trim() || (headstashContract || '').trim() || 'season-1'
  const preferPir = preferPirRecover !== false

  const onListNotes = useCallback(async () => {
    if (!notesBase) {
      toast.error('Set notesBase in module config')
      return
    }
    setRecoverBusy(true)
    setRecoverError('')
    try {
      const keys = await listCorridorNoteKeys({
        notesBase,
        hsId: notesHs,
      })
      setRecoverList(keys)
      if (keys.length && !recoverAddr) {
        setRecoverAddr(keys[0]!)
      }
      toast.success(`Listed ${keys.length} note key(s)`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRecoverError(msg)
      toast.error(msg)
    } finally {
      setRecoverBusy(false)
    }
  }, [notesBase, notesHs, recoverAddr])

  const onRecoverNote = useCallback(async () => {
    if (!notesBase) {
      toast.error('Set notesBase in module config')
      return
    }
    const hex = recoverOwnerKeyHex.trim().replace(/^0x/i, '')
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      toast.error('Owner key must be 32-byte hex (64 chars)')
      return
    }
    if (!recoverAddr.trim()) {
      toast.error('Note addr required (e.g. cm.<hex>)')
      return
    }
    setRecoverBusy(true)
    setRecoverError('')
    setRecoverSummary(null)
    try {
      const ownerKey = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        ownerKey[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      }
      const result = await recoverCorridorNote({
        notesBase,
        hsId: notesHs,
        addr: recoverAddr.trim(),
        ownerKey,
        preferPir,
      })
      // Never log cleartext — summary only (dest binding).
      setRecoverSummary(result.summary)
      toast.success(
        `Recovered via ${result.summary.path} (binding ${result.summary.ownerBindingHex.slice(0, 12)}…)`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRecoverError(msg)
      setRecoverSummary(null)
      toast.error(msg)
    } finally {
      setRecoverBusy(false)
    }
  }, [
    notesBase,
    notesHs,
    recoverAddr,
    recoverOwnerKeyHex,
    preferPir,
  ])

  /** Map module BTC network → Esplora re-verify network. */
  const reverifyNetwork = (
    btcNetwork === 'testnet' ? 'testnet' : 'mainnet'
  ) as 'mainnet' | 'testnet'

  /**
   * Local/funded Esplora base: module field, then NEXT_PUBLIC_BTC_ESPLORA.
   * Required for regtest; optional override for testnet/mainnet mirrors.
   */
  const resolvedEsploraUrls = useMemo((): string[] | undefined => {
    const fromModule = (esploraBase || '').trim()
    const fromEnv =
      typeof process !== 'undefined' &&
      process.env?.NEXT_PUBLIC_BTC_ESPLORA
        ? String(process.env.NEXT_PUBLIC_BTC_ESPLORA).trim()
        : ''
    const base = fromModule || fromEnv
    return base ? [base.replace(/\/$/, '')] : undefined
  }, [esploraBase])

  /**
   * Production / lc_live / ict_local_funded: pass depositReverify from SSE
   * observation into fail-closed post-deposit sequence, then poll host
   * automation (D3+D4+D7). Call-site is this Wizard — not docs-only.
   */
  const startProductionPostDeposit = useCallback(
    async (
      activeIntent: DepositIntentV0,
      observation?: DepositObservation | null,
      opts?: { skipReverify?: boolean }
    ) => {
      if (labOnly || postDepositStartedRef.current) {
        return
      }
      postDepositStartedRef.current = true
      autoAbortRef.current.aborted = false
      setStep('status')
      setBusy(true)
      setReverifyHint('')
      setReverifyBlocked(false)
      if (observation) {
        setLastObservation(observation)
      }

      const obs = observation ?? lastObservation
      const txid = obs?.txid?.trim() ?? ''
      const addr =
        obs?.btc_deposit_addr?.trim() || activeIntent.btc_deposit_addr
      // Synthetic lab txids (lab-…) skip Esplora re-verify — not on-chain.
      const canReverify =
        txid.length === 64 &&
        !txid.startsWith('lab-') &&
        /^[0-9a-fA-F]{64}$/.test(txid)

      // P0 call-site: SSE/deposit_observed → depositReverify fields.
      const depositReverify = canReverify
        ? {
            address: addr,
            txid,
            minAmountSats: obs?.amount_sats
              ? Math.max(1, Math.floor(obs.amount_sats * 0.9))
              : undefined,
            minConfirmations: Math.max(1, obs?.confirmations ?? 1),
            network: reverifyNetwork,
            esploraUrls: resolvedEsploraUrls,
          }
        : undefined

      const result = await runProductionPostDepositSequence({
        headstashContract,
        notesBase,
        oracleBase,
        notifyBase,
        assetBackend,
        intentId: activeIntent.btc_txid_or_intent_id,
        oracleMarketId: activeIntent.oracle_market_id || 'BTC-ZEC',
        minOutValue: activeIntent.min_out_value,
        maxSlippageBps: activeIntent.max_slippage_bps,
        depositReverify,
        skipReverify: opts?.skipReverify === true,
        onReverify: (r: ReverifyResult) => {
          if (r.ok) {
            setReverifyHint(
              `re-verify OK · ${r.funding.amount_sats} sats · confs=${r.funding.confirmations} · ${r.esploraBase}`
            )
          } else {
            setReverifyHint(`re-verify failed · ${r.error}`)
            setReverifyBlocked(true)
          }
        },
        onPhase: (phase, detail) => {
          setStatusPhase(phase)
          if (detail) {
            setDepositSubStatus(detail)
          }
        },
        onOracleMid: (mid) => {
          const policy = `intent min_out=${activeIntent.min_out_value} slip_bps=${activeIntent.max_slippage_bps} policy=${activeIntent.oracle_bound_policy}`
          if (mid.available) {
            const snippet = mid.raw ? mid.raw.slice(0, 120) : ''
            setOracleMidHint(
              snippet
                ? `oracle mid (${mid.marketId}): ${snippet} · ${policy} · bound_only (oracle never mints)`
                : `oracle mid available (${mid.marketId}) · ${policy} · bound_only (oracle never mints)`
            )
          } else {
            setOracleMidHint(
              `oracle bounds not live — host pure swap still bound_only · ${policy} · oracle never mints`
            )
          }
        },
        signal: autoAbortRef.current,
      })
      setBusy(false)
      if (result === 'complete') {
        const r = buildMockSuccessReceipt(activeIntent, assetBackend)
        setReceipt(r)
        clearDepositMnemonic(activeIntent.btc_txid_or_intent_id)
        setStep('receipt')
        setReverifyBlocked(false)
        // RECOVERY-3: host automation film is not product "ZEC sent" / chain egress celebrate
        toast(
          t('info.corridorHostFilmComplete', {
            defaultValue:
              'Host automation film complete (mock_verify OK). Not mainnet ZEC settlement; pure_record/sim residual if Option D labeled.',
          })
        )
      } else if (result === 'failed') {
        setStatusPhase('failed')
        // Allow retry / dangerous override after fail-closed reverify.
        postDepositStartedRef.current = false
        toast.error(
          t('error.corridorAutomationFailed', {
            defaultValue:
              'Fail-closed: BTC re-verify or automation failed — sequence not advanced. See status detail.',
          })
        )
      } else {
        const waitMsg = canReverify
          ? `awaiting host · ${hostAutomationHint(
              activeIntent.btc_txid_or_intent_id
            )}`
          : txid.startsWith('lab-')
            ? `lab observation (no Esplora re-verify) · ${hostAutomationHint(
                activeIntent.btc_txid_or_intent_id
              )}`
            : `awaiting host (no chain txid for re-verify yet) · ${hostAutomationHint(
                activeIntent.btc_txid_or_intent_id
              )}`
        setDepositSubStatus(waitMsg)
        toast(
          t('info.awaitingHostAutomation', {
            defaultValue:
              'Awaiting host mint-after-observe (BridgeMintNote → note → swap). See status hint.',
          })
        )
      }
    },
    [
      labOnly,
      headstashContract,
      notesBase,
      oracleBase,
      notifyBase,
      assetBackend,
      reverifyNetwork,
      resolvedEsploraUrls,
      lastObservation,
      t,
    ]
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!draft.destDisplay.trim()) {
        if (!cancelled) {
          setBindingPreview('')
          setDestSoft(null)
        }
        return
      }
      const soft = softValidateZecDest(draft.destDisplay)
      if (!cancelled) {
        setDestSoft(soft)
      }
      const b = await bindingFromDestDisplay(draft.destDisplay)
      if (!cancelled) {
        setBindingPreview(b)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [draft.destDisplay])

  const stepIndex = useMemo(
    () => STEPS.findIndex((s) => s.id === step),
    [step]
  )

  const patchDraft = useCallback((partial: Partial<CorridorWizardDraft>) => {
    setDraft((d) => ({ ...d, ...partial }))
  }, [])

  const goPreauthNext = async () => {
    if (!draft.destDisplay.trim()) {
      toast.error(
        t('error.destRequired', {
          defaultValue:
            'Paste a Zakura UA/t-addr or load a local Zakura demo dest.',
        })
      )
      return
    }
    const soft = softValidateZecDest(draft.destDisplay)
    if (!soft.ok) {
      toast.error(
        t('error.destSoftInvalid', {
          defaultValue: soft.hint || 'Destination failed soft validation.',
        })
      )
      return
    }
    setBusy(true)
    try {
      const binding =
        bindingPreview || (await bindingFromDestDisplay(draft.destDisplay))
      patchDraft({ destOwnerBinding: binding })
      setStep('rate_policy')
    } finally {
      setBusy(false)
    }
  }

  const generateDemoDest = () => {
    const suffix = Math.random().toString(36).slice(2, 14)
    patchDraft({
      destDisplay: `u1sim_diversified_zec_${suffix}`,
    })
    setZakuraStatus('demo handle (lab) — not a chain UA')
  }

  /** D6: load dest from local Zakura RPC / demo env. */
  const loadZakuraDest = async () => {
    setBusy(true)
    setZakuraStatus('contacting Zakura…')
    try {
      const r = await fetchZakuraDemoDest()
      if (r.ok) {
        patchDraft({ destDisplay: r.address })
        setZakuraStatus(
          [
            `loaded via ${r.source}`,
            r.method ? `method=${r.method}` : null,
            r.networkHint ? `chain=${r.networkHint}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        )
        toast.success(
          t('success.zakuraDestLoaded', {
            defaultValue: 'Zakura / demo ZEC dest loaded for preauth.',
          })
        )
      } else {
        setZakuraStatus(r.error)
        toast.error(
          t('error.zakuraDestFailed', {
            defaultValue: r.error,
          })
        )
      }
    } finally {
      setBusy(false)
    }
  }

  /** Step 3: generate deposit wallet client-side (SelfRelay pattern). */
  const generateDepositWallet = async () => {
    setBusy(true)
    try {
      const w = await generateBrowserDepositWallet({
        cosmosPrefix: 'terp',
        btcNetwork: btcNetwork || 'mainnet',
        label: corridorId || 'private-bridge-deposit',
      })
      setBrowserWallet(w)
      setWalletSession(null)
      setIntent(null)
      toast.success(
        t('success.depositWalletGenerated', {
          defaultValue:
            'Browser deposit wallet ready — fund the P2WPKH address via QR.',
        })
      )
    } catch (e) {
      console.error(e)
      toast.error(
        t('error.walletGenerateFailed', {
          defaultValue: 'Failed to generate browser deposit wallet.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Seal intent + client proof + auth link, then show QR.
   * Deposit address = browser-generated wallet only.
   */
  const sealProofAndShowQr = async () => {
    if (!browserWallet) {
      toast.error(
        t('error.needDepositWallet', {
          defaultValue: 'Generate a browser deposit wallet first.',
        })
      )
      return
    }
    setBusy(true)
    try {
      const sealed = await buildDepositIntent({
        corridorId: corridorId || 'cashapp-btc-zec-v0',
        draft: {
          ...draft,
          destOwnerBinding:
            draft.destOwnerBinding ||
            bindingPreview ||
            (await bindingFromDestDisplay(draft.destDisplay)),
        },
        assetBackend,
        btcDepositAddr: browserWallet.btcDepositAddress,
      })

      const proof = await buildClientWalletProof({
        domainBind: sealed.domain_bind,
        publicKeyHex: browserWallet.publicKeyHex,
        btcDepositAddress: browserWallet.btcDepositAddress,
        destOwnerBinding: sealed.dest_owner_binding,
      })

      const authLink = buildCorridorAuthLink({
        intentId: sealed.btc_txid_or_intent_id,
        domainBind: sealed.domain_bind,
        btcDepositAddress: sealed.btc_deposit_addr,
        destOwnerBinding: sealed.dest_owner_binding,
        proofDigest: proof.proof_digest,
        corridorId: sealed.corridor_id,
      })

      persistDepositMnemonic(
        sealed.btc_txid_or_intent_id,
        browserWallet.mnemonic
      )

      setIntent(sealed)
      setWalletSession({
        cosmosStyleAddress: browserWallet.cosmosStyleAddress,
        publicKeyHex: browserWallet.publicKeyHex,
        btcDepositAddress: browserWallet.btcDepositAddress,
        bitcoinPaymentUri: browserWallet.bitcoinPaymentUri,
        authLink,
        proofDigest: proof.proof_digest,
        proofScheme: proof.scheme,
      })
      setStatusPhase('awaiting_deposit')
      setReceipt(null)
      setStep('deposit')

      // Open deposit watch on hash-market (UI-bound) + SSE subscribe for automation.
      if (notifyBase) {
        try {
          const watchRes = await openCorridorWatch(notifyBase, {
            intent_id: sealed.btc_txid_or_intent_id,
            corridor_id: sealed.corridor_id,
            btc_deposit_addr: sealed.btc_deposit_addr,
            domain_bind: sealed.domain_bind,
            dest_owner_binding: sealed.dest_owner_binding,
            client_proof_digest: proof.proof_digest,
            client_pubkey_hex: browserWallet.publicKeyHex,
            ttl_secs: 86_400,
          })
          if (!watchRes.ok) {
            setDepositSubStatus(`watch open failed: ${watchRes.status}`)
          } else {
            setDepositSubStatus('watching deposits (SSE/poll)')
            unsubRef.current?.()
            unsubRef.current = subscribeCorridorDeposits(
              notifyBase,
              sealed.btc_txid_or_intent_id,
              (ev) => {
                if (ev.type === 'deposit_observed') {
                  const obs = ev.observation
                  setDepositSubStatus(
                    `deposit observed · txid=${obs.txid.slice(0, 12)}… · ${
                      obs.amount_sats
                    } sats`
                  )
                  setStatusPhase('deposit_observed')
                  setLastObservation(obs)
                  toast.success(
                    t('success.depositObservedNotify', {
                      defaultValue:
                        'Deposit notification received — re-verify then bridge sequence.',
                    })
                  )
                  unsubRef.current?.()
                  unsubRef.current = null
                  // Production-shaped (production | lc_live | ict_local_funded):
                  // SSE deposit_observed → depositReverify → host mint → note → oracle swap.
                  if (isProductionBackend(assetBackend)) {
                    void startProductionPostDeposit(sealed, obs)
                  }
                }
              },
              () => setDepositSubStatus('notify stream reconnecting…')
            )
          }
        } catch (err) {
          console.warn(err)
          setDepositSubStatus('notify base unreachable')
        }
      } else {
        setDepositSubStatus(
          'set notesBase or oracleBase (hash-market) to enable deposit subscribe'
        )
      }
    } catch (e) {
      console.error(e)
      toast.error(
        t('error.intentBuildFailed', {
          defaultValue: 'Failed to build intent / client proof.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * After user funds the browser deposit wallet:
   * - production: advance to status; await real observation / mint (wired via
   *   headstashContract + notesBase + oracleBase when present)
   * - lab_simulated only: short local pipeline for CI/dev without chain
   */
  const onDepositFunded = async () => {
    if (!intent) {
      return
    }
    // RECOVERY-1: expiry fail-closed before mint film / host automation
    if (isIntentExpired(intent)) {
      toast.error(
        t('error.intentExpired', {
          defaultValue:
            'Intent expired — late mint refused (fail-closed). Sweep deposit HD UTXO or use timeout recovery binding if configured.',
        })
      )
      setStatusPhase('failed')
      setStep('status')
      return
    }
    setStep('status')
    setStatusPhase('awaiting_deposit')
    setBusy(true)

    if (labOnly) {
      for (const phase of STATUS_FILM_PHASES) {
        await new Promise((r) => setTimeout(r, 400))
        setStatusPhase(phase)
      }
      const r = buildMockSuccessReceipt(intent, assetBackend)
      setReceipt(r)
      clearDepositMnemonic(intent.btc_txid_or_intent_id)
      setBusy(false)
      setStep('receipt')
      // RECOVERY-3: no toast.success celebrate — lab film ≠ ZEC sent / chain egress
      toast(
        t('info.corridorLabFilmOnly', {
          defaultValue:
            'Lab film only (lab_simulated) — not chain egress, not ZEC sent. Residual labels: pure_record_lab / lab_inventory_pay_simulated when used.',
        })
      )
      return
    }

    // Production / lc_live: deposit observed → host automation (mint + note + swap).
    toast.success(
      t('success.depositRecorded', {
        defaultValue:
          'Deposit marked. Polling host automation for BridgeMintNote + note persist + oracle-bound swap (mock_verify OK; oracle never mints).',
      })
    )
    await startProductionPostDeposit(intent)
  }

  const resetWizard = () => {
    unsubRef.current?.()
    unsubRef.current = null
    autoAbortRef.current.aborted = true
    postDepositStartedRef.current = false
    if (intent) {
      clearDepositMnemonic(intent.btc_txid_or_intent_id)
    }
    setStep('preauth')
    setDraft(defaultWizardDraft())
    setIntent(null)
    setBrowserWallet(null)
    setWalletSession(null)
    setShowMnemonic(false)
    setStatusPhase('awaiting_deposit')
    setReceipt(null)
    setBindingPreview('')
    setDepositSubStatus('')
    setOracleMidHint('')
    setDestSoft(null)
    setZakuraStatus('')
    setReverifyHint('')
    setLastObservation(null)
    setReverifyBlocked(false)
  }

  /** Lab: publish observation to open hub so SSE fires (local trustless loop). */
  const publishLabDepositNotify = async () => {
    if (!intent || !notifyBase) {
      return
    }
    setBusy(true)
    try {
      const res = await reportLabObservation(notifyBase, {
        intent_id: intent.btc_txid_or_intent_id,
        btc_deposit_addr: intent.btc_deposit_addr,
        txid: `lab-${Date.now().toString(16)}`,
        amount_sats: 100_000,
        confirmations: 1,
        observed_at: Math.floor(Date.now() / 1000),
        reporter: 'lab_sim',
        domain_bind: intent.domain_bind,
      })
      if (!res.ok) {
        toast.error(`lab observation ${res.status}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {labOnly ? (
        <div className="rounded-md border border-border-interactive-warning bg-background-secondary px-3 py-2">
          <p className="primary-text text-sm text-text-interactive-warning-body">
            {t('info.labOnlyBanner', {
              defaultValue:
                'Lab mode (lab_simulated) — not production. Synthetic film only; not mainnet settlement.',
            })}
          </p>
        </div>
      ) : ictFunded ? (
        <div className="rounded-md border border-border-interactive-warning bg-background-secondary px-3 py-2">
          <p className="primary-text text-sm text-text-interactive-warning-body">
            {t('info.ictLocalFundedBanner', {
              defaultValue:
                'Local test network (ict_local_funded) — same workflow shape as production (intent → fund → observe → reverify → mint → oracle-bound swap). Not mainnet settlement.',
            })}{' '}
            <span className="font-mono">
              ({assetBackend} · btc={btcNetwork || 'testnet'})
            </span>
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2">
          <p className="secondary-text text-xs">
            {t('info.productionCorridorBanner', {
              defaultValue:
                'Production Private Bridge: deposit wallet is generated in this browser (SelfRelay HD). QR funds a real P2WPKH address. Auth link after client proof never includes the mnemonic. Fail-closed BTC re-verify before automation. Configure mint-router, notes, and oracle bases for this deployment.',
            })}{' '}
            <span className="font-mono">
              ({assetBackend} · {btcNetwork || 'mainnet'})
            </span>
          </p>
        </div>
      )}

      <SegmentedControls
        onSelect={(id) => {
          const target = STEPS.findIndex((s) => s.id === id)
          if (
            target <= stepIndex ||
            (intent && target <= 3) ||
            receipt ||
            (browserWallet && target <= 2)
          ) {
            setStep(id)
          }
        }}
        selected={step}
        tabs={STEPS.map((s) => ({ label: s.label, value: s.id }))}
      />

      {step === 'preauth' && (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.preauthDestination', {
              defaultValue: 'Preauth diversified ZEC destination',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.preauthDestination', {
              defaultValue:
                'Where ZEC lands after the private bridge + swap. Prefer a Zakura UA / t-addr (D6). Fixed before BTC is sent — the deposit authorizes this dest only. No mainnet ZEC send required for lab film.',
            })}
          </p>

          <div className="space-y-2">
            <InputLabel
              name={t('form.destDisplay', {
                defaultValue: 'ZEC dest (Zakura UA / t-addr / handle)',
              })}
            />
            <textarea
              className="secondary-text w-full appearance-none rounded-md bg-transparent py-3 px-4 text-text-body ring-1 ring-border-primary transition placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-border-interactive-focus"
              onChange={(e) => patchDraft({ destDisplay: e.target.value })}
              placeholder="u1… / t1… / tm… or paste from local Zakura"
              rows={2}
              value={draft.destDisplay}
            />
          </div>

          <div className="flex flex-row flex-wrap gap-2">
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => void loadZakuraDest()}
              size="sm"
              variant="primary"
            >
              {t('button.useLocalZakuraDest', {
                defaultValue: 'Use local Zakura demo dest',
              })}
            </Button>
            <Button onClick={generateDemoDest} size="sm" variant="secondary">
              {t('button.generateDemoDest', {
                defaultValue: 'Generate demo handle',
              })}
            </Button>
          </div>

          {zakuraStatus ? (
            <p className="secondary-text font-mono text-xs break-all">
              zakura: {zakuraStatus}
            </p>
          ) : null}

          {destSoft ? (
            <p
              className={`text-xs ${
                destSoft.ok
                  ? 'text-text-secondary'
                  : 'text-text-interactive-warning-body'
              }`}
            >
              {destSoft.kind}: {destSoft.hint}
            </p>
          ) : null}

          {bindingPreview ? (
            <div className="space-y-1">
              <InputLabel
                name={t('form.ownerBinding', {
                  defaultValue: 'owner_binding digest',
                })}
              />
              <CopyToClipboard takeAll value={bindingPreview} />
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => void goPreauthNext()}
              variant="primary"
            >
              {t('button.continue', { defaultValue: 'Continue' })}
            </Button>
          </div>
        </div>
      )}

      {step === 'rate_policy' && (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.ratePolicy', { defaultValue: 'Rate policy' })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.ratePolicy', {
              defaultValue:
                'Min out / slip vs oracle mid (bound_only — oracle never mints).',
            })}
          </p>

          <div className="space-y-2">
            <InputLabel
              name={t('form.minOutValue', {
                defaultValue: 'Min out (ZEC-side units)',
              })}
            />
            <TextInput
              onChange={(e) => patchDraft({ minOutValue: e.target.value })}
              value={draft.minOutValue}
            />
          </div>

          <div className="space-y-2">
            <InputLabel
              name={t('form.maxSlippageBps', {
                defaultValue: 'Max slippage (bps)',
              })}
            />
            <TextInput
              onChange={(e) => {
                const n = Number(e.target.value)
                patchDraft({
                  maxSlippageBps: Number.isFinite(n) ? Math.max(0, n) : 0,
                })
              }}
              value={String(draft.maxSlippageBps)}
            />
          </div>

          <div className="space-y-2">
            <InputLabel
              name={t('form.oracleMarketId', {
                defaultValue: 'Oracle market id',
              })}
            />
            <TextInput
              onChange={(e) =>
                patchDraft({ oracleMarketId: e.target.value })
              }
              value={draft.oracleMarketId}
            />
          </div>

          {oracleBase ? (
            <p className="secondary-text font-mono text-xs break-all">
              oracleBase: {oracleBase}
            </p>
          ) : null}

          <div className="flex flex-row justify-between gap-2">
            <Button onClick={() => setStep('preauth')} variant="secondary">
              {t('button.back', { defaultValue: 'Back' })}
            </Button>
            <Button
              onClick={() => setStep('deposit_wallet')}
              variant="primary"
            >
              {t('button.continue', { defaultValue: 'Continue' })}
            </Button>
          </div>
        </div>
      )}

      {step === 'deposit_wallet' && (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.browserDepositWallet', {
              defaultValue: 'Browser deposit wallet',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.browserDepositWallet', {
              defaultValue:
                'Production deposit wallet: generated in this browser with DirectSecp256k1HdWallet.generate(24) — same pattern as dao-dao SelfRelay. P2WPKH address for Cash App / wallet QR. Keys never leave the client; mnemonic is optional backup and is never in the auth link.',
            })}
          </p>

          <Button
            disabled={busy}
            loading={busy}
            onClick={() => void generateDepositWallet()}
            variant="primary"
          >
            {browserWallet
              ? t('button.regenerateDepositWallet', {
                  defaultValue: 'Generate new deposit wallet',
                })
              : t('button.generateDepositWallet', {
                  defaultValue: 'Generate deposit wallet',
                })}
          </Button>

          {browserWallet ? (
            <div className="flex flex-col gap-3 rounded-md bg-background-tertiary p-3">
              <div className="space-y-1">
                <InputLabel
                  name={t('form.btcDepositAddr', {
                    defaultValue: 'BTC deposit address (P2WPKH)',
                  })}
                />
                <CopyToClipboard
                  takeAll
                  value={browserWallet.btcDepositAddress}
                />
              </div>
              <div className="space-y-1">
                <InputLabel
                  name={t('form.browserWalletId', {
                    defaultValue: 'Browser wallet id (CosmJS bech32)',
                  })}
                />
                <CopyToClipboard
                  takeAll
                  value={browserWallet.cosmosStyleAddress}
                />
              </div>
              <div className="space-y-1">
                <InputLabel
                  name={t('form.publicKey', {
                    defaultValue: 'Public key (hex)',
                  })}
                />
                <CopyToClipboard takeAll value={browserWallet.publicKeyHex} />
              </div>

              <Button
                onClick={() => setShowMnemonic((v) => !v)}
                size="sm"
                variant="ghost"
              >
                {showMnemonic
                  ? t('button.hideMnemonic', { defaultValue: 'Hide mnemonic' })
                  : t('button.showMnemonic', {
                      defaultValue: 'Show mnemonic (backup)',
                    })}
              </Button>
              {showMnemonic ? (
                <div className="space-y-1">
                  <p className="text-xs text-text-interactive-warning-body">
                    {t('info.mnemonicWarning', {
                      defaultValue:
                        'Client-only. Never paste into a website you do not trust. Cleared from localStorage when corridor completes.',
                    })}
                  </p>
                  <CopyToClipboard takeAll value={browserWallet.mnemonic} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-row justify-between gap-2">
            <Button
              onClick={() => setStep('rate_policy')}
              variant="secondary"
            >
              {t('button.back', { defaultValue: 'Back' })}
            </Button>
            <Button
              disabled={busy || !browserWallet}
              loading={busy}
              onClick={() => void sealProofAndShowQr()}
              variant="primary"
            >
              {t('button.createProofAndQr', {
                defaultValue: 'Create proof + deposit QR',
              })}
            </Button>
          </div>
        </div>
      )}

      {step === 'deposit' && intent && walletSession && (
        <div className="flex flex-col gap-4 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.fundDepositQr', {
              defaultValue: 'Scan to send Bitcoin',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.fundDepositQr', {
              defaultValue:
                'Scan to send Bitcoin to the browser-generated deposit wallet. Auth link is created after client-side proof of that wallet + sealed deposit intent (mnemonic never in the link).',
            })}
          </p>

          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-md bg-white p-3">
              <QRCode
                size={220}
                value={walletSession.bitcoinPaymentUri}
              />
            </div>
            <p className="secondary-text font-mono text-xs break-all text-center max-w-md">
              {walletSession.bitcoinPaymentUri}
            </p>
            <CopyToClipboard
              takeAll
              value={walletSession.btcDepositAddress}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border-secondary p-3">
            <InputLabel
              name={t('form.authLink', {
                defaultValue: 'Auth / intent link',
              })}
            />
            <p className="secondary-text text-xs">
              {t('info.authLink', {
                defaultValue:
                  'Created after client-side proof of wallet material + deposit intent. Share for session recovery or ops — does not include the HD mnemonic.',
              })}
            </p>
            <CopyToClipboard takeAll value={walletSession.authLink} />
          </div>

          <div className="space-y-1">
            <InputLabel
              name={t('form.clientProof', {
                defaultValue: 'Client proof digest',
              })}
            />
            <CopyToClipboard takeAll value={walletSession.proofDigest} />
            <p className="secondary-text text-xs font-mono">
              scheme: {walletSession.proofScheme}
            </p>
          </div>

          <div className="space-y-1">
            <InputLabel
              name={t('form.domainBind', { defaultValue: 'domain_bind' })}
            />
            <CopyToClipboard takeAll value={intent.domain_bind} />
          </div>

          <div className="space-y-1">
            <InputLabel
              name={t('form.ownerBinding', {
                defaultValue: 'dest_owner_binding',
              })}
            />
            <CopyToClipboard takeAll value={intent.dest_owner_binding} />
          </div>

          {depositSubStatus ? (
            <p className="secondary-text text-xs">
              notify: {depositSubStatus}
            </p>
          ) : null}

          {labOnly && notifyBase ? (
            <Button
              disabled={busy}
              onClick={() => void publishLabDepositNotify()}
              size="sm"
              variant="secondary"
            >
              {t('button.labPublishDeposit', {
                defaultValue: 'Lab: publish deposit.observed',
              })}
            </Button>
          ) : null}

          <details className="secondary-text text-xs">
            <summary className="cursor-pointer">
              {t('info.showIntentJson', {
                defaultValue: 'Show DepositIntentV0 JSON',
              })}
            </summary>
            <pre className="mt-2 overflow-auto rounded-md bg-background-tertiary p-2 font-mono text-xs">
              {JSON.stringify(intent, null, 2)}
            </pre>
          </details>

          {notesBase ? (
            <p className="secondary-text font-mono text-xs break-all">
              notesBase: {notesBase}
            </p>
          ) : null}

          <div className="flex flex-row justify-between gap-2">
            <Button
              onClick={() => setStep('deposit_wallet')}
              variant="secondary"
            >
              {t('button.back', { defaultValue: 'Back' })}
            </Button>
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => void onDepositFunded()}
              variant="primary"
            >
              {labOnly
                ? t('button.iveFundedLab', {
                    defaultValue: "I've funded (lab pipeline)",
                  })
                : t('button.iveFunded', {
                    defaultValue: 'I have funded this address',
                  })}
            </Button>
          </div>
        </div>
      )}

      {step === 'status' && (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.corridorStatus', {
              defaultValue: 'Corridor status',
            })}
          </p>
          <ol className="flex flex-col gap-2">
            {(
              [
                'deposit_observed',
                'bridging',
                'swapping',
                'complete',
              ] as CorridorStatusPhase[]
            ).map((phase) => {
              const order = STATUS_FILM_PHASES.indexOf(
                phase as (typeof STATUS_FILM_PHASES)[number]
              )
              const current = STATUS_FILM_PHASES.indexOf(
                statusPhase as (typeof STATUS_FILM_PHASES)[number]
              )
              const done =
                statusPhase === 'complete' ||
                (current >= 0 && order >= 0 && order < current)
              const active = statusPhase === phase
              return (
                <li
                  className={`flex flex-row items-center gap-2 rounded-md px-3 py-2 text-sm ${
                    active
                      ? 'border border-border-interactive-active bg-background-secondary'
                      : done
                        ? 'border border-border-primary opacity-80'
                        : 'border border-border-secondary opacity-50'
                  }`}
                  key={phase}
                >
                  <span className="font-mono text-xs w-4">
                    {done ? '✓' : active ? '…' : '·'}
                  </span>
                  <span>{statusPhaseLabel(phase)}</span>
                </li>
              )
            })}
          </ol>
          {busy && labOnly ? (
            <p className="secondary-text text-sm">
              {t('info.runningLabPipeline', {
                defaultValue: 'Running lab deposit → mint → swap pipeline…',
              })}
            </p>
          ) : null}
          {busy && production ? (
            <p className="secondary-text text-sm">
              {t('info.pollingHostAutomation', {
                defaultValue:
                  'Polling host automation (BridgeMintNote → put_note → oracle-bound swap)…',
              })}
            </p>
          ) : null}
          {statusPhase === 'failed' ? (
            <div className="rounded-md border border-border-interactive-error bg-background-secondary px-3 py-2 space-y-2">
              <p className="primary-text text-sm text-text-interactive-error-body">
                {t('error.corridorFailClosed', {
                  defaultValue:
                    'Fail-closed: sequence stopped. Re-verify or host automation did not pass — success path not advanced.',
                })}
              </p>
              {intent && production ? (
                <div className="flex flex-row flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    loading={busy}
                    onClick={() =>
                      void startProductionPostDeposit(intent, lastObservation)
                    }
                    size="sm"
                    variant="primary"
                  >
                    {t('button.retryReverify', {
                      defaultValue: 'Retry re-verify + automation',
                    })}
                  </Button>
                  <Button
                    disabled={busy || !reverifyBlocked}
                    onClick={() =>
                      void startProductionPostDeposit(intent, lastObservation, {
                        skipReverify: true,
                      })
                    }
                    size="sm"
                    variant="ghost"
                  >
                    {t('button.dangerousSkipReverify', {
                      defaultValue:
                        'DANGEROUS: continue without re-verify',
                    })}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {production ? (
            <div className="secondary-text text-sm space-y-1">
              <p>
                {t('info.productionStatusHooks', {
                  defaultValue: ictFunded
                    ? 'ict_local_funded: deposit_observed → fail-closed BTC re-verify (D4) → host mint-after-observe (cw-headstash) → note persist → oracle-bound private swap (oracle never mints). Local test network — not mainnet.'
                    : 'Production-shaped: deposit_observed → fail-closed BTC re-verify (D4) → host mint-after-observe (cw-headstash mock_verify OK) → note persist → oracle-bound private swap (oracle never mints). Lab banner only when assetBackend=lab_simulated.',
                })}
              </p>
              {reverifyHint ? (
                <p
                  className={`font-mono text-xs break-all ${
                    reverifyHint.includes('failed')
                      ? 'text-text-interactive-warning-body'
                      : ''
                  }`}
                >
                  re-verify: {reverifyHint}
                </p>
              ) : (
                <p className="font-mono text-xs text-text-tertiary">
                  re-verify: pending observation with 64-hex txid (lab-…
                  skipped); fail-closed when configured
                </p>
              )}
              {depositSubStatus ? (
                <p className="font-mono text-xs break-all">
                  status: {depositSubStatus}
                </p>
              ) : null}
              {oracleMidHint ? (
                <p className="font-mono text-xs break-all">{oracleMidHint}</p>
              ) : null}
              {intent ? (
                <p className="font-mono text-xs break-all">
                  {hostAutomationHint(intent.btc_txid_or_intent_id)}
                </p>
              ) : null}
              {headstashContract ? (
                <p className="font-mono text-xs break-all">
                  mint-router: {headstashContract}
                </p>
              ) : (
                <p className="text-text-interactive-warning-body text-xs">
                  {t('info.missingMintRouter', {
                    defaultValue:
                      'Set mint-router (cw-headstash) in module config for BridgeMintNote.',
                  })}
                </p>
              )}
              {notesBase ? (
                <p className="font-mono text-xs break-all">
                  notes: {notesBase}
                </p>
              ) : null}
              {oracleBase ? (
                <p className="font-mono text-xs break-all">
                  oracle: {oracleBase} (bounds only — never mints)
                </p>
              ) : null}
              {resolvedEsploraUrls?.[0] ? (
                <p className="font-mono text-xs break-all">
                  esplora: {resolvedEsploraUrls[0]}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Recover private note — PIR preferred when multi-note / notesBase */}
          {notesBase ? (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-border-secondary p-3">
              <p className="primary-text text-sm">
                {t('title.recoverPrivateNote', {
                  defaultValue: 'Recover private note',
                })}
              </p>
              <p className="secondary-text text-xs">
                {t('info.recoverPrivateNote', {
                  defaultValue:
                    preferPir
                      ? 'Prefers PIR (POST /notes/{hs}/pir) when list has keys; direct GET fallback. Decrypt client-side only — shows dest binding, not full cleartext.'
                      : 'Direct GET recover (debug). Set preferPirRecover for access-pattern privacy.',
                })}
              </p>
              <p className="font-mono text-xs break-all">
                hs_id: {notesHs}
              </p>
              <div className="flex flex-row flex-wrap gap-2">
                <Button
                  disabled={recoverBusy}
                  loading={recoverBusy}
                  onClick={() => void onListNotes()}
                  size="sm"
                  variant="secondary"
                >
                  {t('button.listNotes', { defaultValue: 'List notes' })}
                </Button>
              </div>
              {recoverList.length > 0 ? (
                <div className="space-y-1">
                  <InputLabel
                    name={t('form.noteAddr', {
                      defaultValue: 'Note addr',
                    })}
                  />
                  <select
                    className="rounded-md border border-border-primary bg-background-primary px-2 py-1 text-sm font-mono w-full"
                    onChange={(e) => setRecoverAddr(e.target.value)}
                    value={recoverAddr}
                  >
                    {recoverList.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <InputLabel
                    name={t('form.noteAddr', {
                      defaultValue: 'Note addr (cm.…)',
                    })}
                  />
                  <TextInput
                    onChange={(e) => setRecoverAddr(e.target.value)}
                    placeholder="cm.<hex>"
                    value={recoverAddr}
                  />
                </div>
              )}
              <div className="space-y-1">
                <InputLabel
                  name={t('form.ownerKeyHex', {
                    defaultValue: 'Owner key (32B hex, local only)',
                  })}
                />
                <TextInput
                  onChange={(e) => setRecoverOwnerKeyHex(e.target.value)}
                  placeholder="64 hex chars — never sent to server"
                  value={recoverOwnerKeyHex}
                />
              </div>
              <Button
                disabled={recoverBusy}
                loading={recoverBusy}
                onClick={() => void onRecoverNote()}
                size="sm"
                variant="primary"
              >
                {t('button.pirRecover', {
                  defaultValue: preferPir
                    ? 'PIR recover + decrypt'
                    : 'Direct recover + decrypt',
                })}
              </Button>
              {recoverSummary ? (
                <div className="rounded-md bg-background-tertiary p-2 space-y-1">
                  <p className="font-mono text-xs break-all">
                    {formatRecoverSummaryLine(recoverSummary)}
                  </p>
                  <p className="font-mono text-xs break-all">
                    owner_binding: {recoverSummary.ownerBindingHex}
                  </p>
                  <p className="font-mono text-xs break-all">
                    cm_public: {recoverSummary.cmPublicHex}
                  </p>
                  <p className="secondary-text text-xs">
                    path={recoverSummary.path} · layout=
                    {recoverSummary.cleartextLayout}
                  </p>
                </div>
              ) : null}
              {recoverError ? (
                <p className="text-xs text-text-interactive-error-body break-all">
                  {recoverError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {step === 'receipt' && receipt && (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
          <p className="primary-text">
            {t('title.corridorReceipt', {
              defaultValue: 'Receipt',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.receiptDestMatch', {
              defaultValue:
                'Payout only to preauth dest_owner_binding. Deposit was to a browser-generated wallet.',
            })}
          </p>

          {isLabSimulatedBackend(receipt.assetBackend) ||
          receipt.fidelityLabel === 'lab_film' ||
          receipt.fidelityLabel === 'pure_record_lab' ||
          receipt.fidelityLabel === 'lab_inventory_pay_simulated' ? (
            <p className="text-xs text-text-interactive-warning-body">
              {t('info.labOnlyBanner', {
                defaultValue:
                  'Lab residual receipt — not production settlement. Not “ZEC sent”; not “egress complete (chain)”. Labels: lab_film / pure_record_lab / lab_inventory_pay_simulated when applicable.',
              })}
            </p>
          ) : isIctLocalFundedBackend(receipt.assetBackend) ||
            receipt.fidelityLabel === 'host_automation_film' ? (
            <p className="text-xs text-text-interactive-warning-body">
              {t('info.ictLocalFundedReceipt', {
                defaultValue:
                  'Local test network receipt (ict_local_funded) — not mainnet settlement. Host film / labeled residual only if Option D pure_record or sim pay.',
              })}
            </p>
          ) : null}

          <div className="space-y-1">
            <InputLabel
              name={t('form.btcDepositAddr', {
                defaultValue: 'Funded deposit address',
              })}
            />
            <CopyToClipboard
              takeAll
              value={receipt.intent.btc_deposit_addr}
            />
          </div>
          <div className="space-y-1">
            <InputLabel
              name={t('form.ownerBinding', {
                defaultValue: 'dest_owner_binding',
              })}
            />
            <CopyToClipboard
              takeAll
              value={receipt.intent.dest_owner_binding}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <span className="secondary-text">In: </span>
              {receipt.amountInDisplay}
            </div>
            <div>
              <span className="secondary-text">Out: </span>
              {receipt.amountOutDisplay}
            </div>
            <div>
              <span className="secondary-text">Oracle mid: </span>
              {receipt.oracleMidUsed}
            </div>
            <div>
              <span className="secondary-text">Bound: </span>
              {receipt.boundPolicy}
            </div>
          </div>

          {walletSession?.authLink ? (
            <div className="space-y-1">
              <InputLabel
                name={t('form.authLink', {
                  defaultValue: 'Auth link (session)',
                })}
              />
              <CopyToClipboard takeAll value={walletSession.authLink} />
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={resetWizard} variant="secondary">
              {t('button.startOver', { defaultValue: 'Start over' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
