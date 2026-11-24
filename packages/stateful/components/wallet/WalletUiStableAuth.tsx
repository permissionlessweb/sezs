import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import {
  Adr36AuthStage,
  OcidJwtAuthStage,
  PasskeyAuthStage,
  SmartAccountAuthStage,
  StableAuthSection,
  ZcashLoginAuthStage,
  type PasskeyMode,
} from '@dao-dao/stateless'
import {
  AuthMethodId,
  isSmartAccountChain,
  allowPasskeyDevFallback,
  buildCapabilityGrant,
  buildLoginChallenge,
  listChooserAuthMethods,
  safeLogAdapterError,
  setChosenAuthMethod,
  ZCASH_ADAPTER_CATALOG,
  type ZcashAdapterId,
  processError,
} from '@dao-dao/utils'

import { usePfpkClient } from '../../hooks/usePfpkClient'
import { useSmartAccount } from '../../hooks/useSmartAccount'
import { useWallet } from '../../hooks/useWallet'
import {
  LocalPasskeyAccount,
  getActiveLocalPasskeyAccount,
  isWebAuthnAvailable,
  listLocalPasskeyAccounts,
  loadPasskeyCredentialId,
  makeLocalAccountId,
  pairLocalPasskeyToAddress,
  savePasskeyCredentialId,
  setActiveLocalPasskeyAccount,
  upsertLocalPasskeyAccount,
} from './stableAuthFlags'

export type WalletUiStableAuthProps = {
  /**
   * Compact list shown on the connect modal (pre-login).
   * Full status when wallet is connected.
   */
  variant?: 'connect' | 'connected'
  /** Optional close parent modal after navigation-style actions. */
  onDone?: () => void
}

/**
 * First-class stable-auth entry points on the wallet card:
 * passkey existing/create local accounts, OCID JWT (PFPK / OIDC), smart-account.
 * Does not use WalletConnect relay. Never handles nsec secrets.
 * Pairing controls only surface after a wallet is connected.
 * Presentation lives in @dao-dao/stateless (Clear) wallet/auth stages.
 */
export const WalletUiStableAuth = ({
  variant = 'connect',
  onDone,
}: WalletUiStableAuthProps) => {
  const { t } = useTranslation()
  const { address, isWalletConnected, hexPublicKey, chain, chainWallet } =
    useWallet({
      loadAccount: true,
    })
  const chainId = chain?.chainId || ''

  const { pfpkClient, isWalletConnected: pfpkReady } = usePfpkClient({
    // Only sign when connected; query-only otherwise.
  })

  const {
    supported: smartAccountSupported,
    authenticators,
    isLoading: smartAccountLoading,
    selectedAuthenticatorId,
  } = useSmartAccount()

  const identityKey =
    address ||
    (hexPublicKey && !hexPublicKey.loading ? hexPublicKey.data : undefined) ||
    ''

  const [passkeyId, setPasskeyId] = useState<string | null>(null)
  const [busyPasskey, setBusyPasskey] = useState(false)
  const [passkeyMode, setPasskeyMode] = useState<PasskeyMode>('choose')
  const [accounts, setAccounts] = useState<LocalPasskeyAccount[]>([])
  const [jwtStatus, setJwtStatus] = useState<
    'unknown' | 'none' | 'session' | 'error'
  >('unknown')
  const [jwtDetail, setJwtDetail] = useState<string>()

  const refreshAccounts = useCallback(() => {
    setAccounts(listLocalPasskeyAccounts())
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  useEffect(() => {
    if (!identityKey) {
      setPasskeyId(null)
      return
    }
    const stored = loadPasskeyCredentialId(identityKey)
    setPasskeyId(stored)
    if (isWalletConnected && address && stored) {
      pairLocalPasskeyToAddress(address, stored)
      refreshAccounts()
    }
  }, [identityKey, isWalletConnected, address, refreshAccounts])

  // Probe PFPK / OCID JWT session when wallet can sign.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!isWalletConnected || !pfpkReady || !pfpkClient) {
        setJwtStatus('none')
        setJwtDetail(undefined)
        return
      }
      try {
        const tokens = await pfpkClient.fetchTokens()
        if (cancelled) {
          return
        }
        const count = Array.isArray(tokens) ? tokens.length : 0
        setJwtStatus(count > 0 ? 'session' : 'none')
        setJwtDetail(
          count > 0
            ? t('info.pfpkSessionTokens', {
                count,
                defaultValue: '{{count}} PFPK / JWT token(s) on this profile',
              })
            : t('info.pfpkNoSessionTokens', {
                defaultValue:
                  'No PFPK session tokens yet — connect + sign to mint, or use an OCID/OIDC onboarding invite',
              })
        )
      } catch (err) {
        if (cancelled) {
          return
        }
        setJwtStatus('error')
        setJwtDetail(processError(err, { forceCapture: false }))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [isWalletConnected, pfpkReady, pfpkClient, t])

  const createPasskeyCredentialId = useCallback(async (): Promise<string> => {
    if (!isWebAuthnAvailable()) {
      if (!allowPasskeyDevFallback()) {
        throw new Error(
          'WebAuthn is required for passkeys. Lab-only: set NEXT_PUBLIC_ENABLE_PASSKEY_DEV_FALLBACK=true in non-production.'
        )
      }
      const seed = identityKey || `anon-${Date.now()}`
      return `dev-passkey-${seed.slice(0, 24)}`
    }
    if (!identityKey && variant === 'connected') {
      throw new Error('Connect a wallet before creating a passkey')
    }
    const userSeed = identityKey || makeLocalAccountId()
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const userId = new TextEncoder().encode(userSeed.slice(0, 32))
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Terp DAO — stable auth',
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: address || userSeed.slice(0, 16),
          displayName: 'Local passkey account',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null

    if (!credential?.id) {
      throw new Error('Passkey creation cancelled')
    }
    return credential.id
  }, [address, identityKey, variant])

  const handleCreateLocalAccount = useCallback(async () => {
    setBusyPasskey(true)
    try {
      const credentialId = await createPasskeyCredentialId()
      const account = upsertLocalPasskeyAccount({
        id: makeLocalAccountId(),
        credentialId,
        label: t('info.localPasskeyAccount', {
          defaultValue: 'Local passkey account',
        }),
        createdAt: Date.now(),
        pairedAddress: address || undefined,
      })
      if (identityKey) {
        savePasskeyCredentialId(identityKey, credentialId)
      }
      setPasskeyId(credentialId)
      refreshAccounts()
      setPasskeyMode('choose')
      toast.success(
        isWebAuthnAvailable()
          ? t('success.passkeyBound', { defaultValue: 'Passkey bound' })
          : t('success.passkeyBoundDev', {
              defaultValue:
                'Passkey binding recorded (dev fallback — enable WebAuthn for production).',
            })
      )
      if (account.pairedAddress) {
        toast.success(
          t('success.passkeyPaired', {
            defaultValue: 'Passkey paired to connected wallet',
          })
        )
      }
    } catch (err) {
      toast.error(processError(err, { forceCapture: false }))
    } finally {
      setBusyPasskey(false)
    }
  }, [address, createPasskeyCredentialId, identityKey, refreshAccounts, t])

  const handleSelectExisting = useCallback(
    (account: LocalPasskeyAccount) => {
      setActiveLocalPasskeyAccount(account.id)
      setPasskeyId(account.credentialId)
      if (identityKey) {
        savePasskeyCredentialId(identityKey, account.credentialId)
      }
      if (isWalletConnected && address) {
        pairLocalPasskeyToAddress(address, account.credentialId)
      }
      refreshAccounts()
      setPasskeyMode('choose')
      toast.success(
        t('success.passkeySelected', {
          defaultValue: 'Using existing passkey account',
        })
      )
    },
    [address, identityKey, isWalletConnected, refreshAccounts, t]
  )

  const openOnboarding = () => {
    // Deep-link only — never force /onboard as sole wallet-connect path.
    if (typeof window !== 'undefined') {
      window.location.assign('/onboard')
    }
    onDone?.()
  }

  const chainSupportsSa =
    !!chainId && isSmartAccountChain(chainId) && smartAccountSupported

  const activeAccount = useMemo(
    () => getActiveLocalPasskeyAccount(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh via accounts
    [accounts, passkeyId]
  )

  const showPairing = isWalletConnected && !!address

  const chooserSurface =
    variant === 'connect' ? 'wallet_connect_modal' : 'wallet_connected_card'

  const chooserMethods = useMemo(
    () =>
      listChooserAuthMethods(chooserSurface, {
        walletConnected: isWalletConnected,
        webAuthnAvailable: isWebAuthnAvailable(),
      }).filter(
        // Extension wallets already listed above this component; email/password
        // is standalone host-only. Keep multi-auth discovery for the rest.
        (m) =>
          m.id !== 'extension_wallet' && m.id !== 'bounties_email_password'
      ),
    [chooserSurface, isWalletConnected]
  )

  const [focusedMethod, setFocusedMethod] = useState<AuthMethodId | null>(null)
  const [zcashBusy, setZcashBusy] = useState(false)
  const [zcashCapabilityJson, setZcashCapabilityJson] = useState<string | null>(
    null
  )



  const signArbitrary = useCallback(
    async (message: string) => {
      if (!isWalletConnected || !address || !chainId) {
        throw new Error('Connect a wallet to continue.')
      }
      const client = chainWallet?.client as
        | {
            signArbitrary?: (
              chainId: string,
              signer: string,
              data: string | Uint8Array
            ) => Promise<{
              signature: string
              pub_key: { type: string; value: string }
            }>
          }
        | undefined
      if (client?.signArbitrary) {
        return client.signArbitrary(chainId, address, message)
      }
      const win = window as unknown as {
        keplr?: {
          signArbitrary: (
            chainId: string,
            signer: string,
            data: string | Uint8Array
          ) => Promise<{ signature: string }>
        }
        leap?: {
          signArbitrary: (
            chainId: string,
            signer: string,
            data: string | Uint8Array
          ) => Promise<{ signature: string }>
        }
      }
      const injected =
        win.keplr?.signArbitrary?.bind(win.keplr) ||
        win.leap?.signArbitrary?.bind(win.leap)
      if (!injected) {
        throw new Error(
          'Wallet does not support signArbitrary (ADR-36). Use Keplr or Leap for lab adapters.'
        )
      }
      return injected(chainId, address, message)
    },
    [address, chainId, chainWallet, isWalletConnected]
  )

  const runZcashLabAdapter = useCallback(
    async (adapter: ZcashAdapterId) => {
      if (!isWalletConnected || !address || !chainId) {
        toast.error(
          t('error.zcashLabNeedWallet', {
            defaultValue:
              'Connect an extension wallet first — lab adapters use auth-isolated cosmos signArbitrary (not spending keys).',
          })
        )
        return
      }
      setZcashBusy(true)
      setZcashCapabilityJson(null)
      try {
        const challenge = buildLoginChallenge({
          adapter,
          chainId,
          daoAddress: undefined,
          addressHint: address,
        })
        // Auth-isolated stand-in: signArbitrary on cosmos key (ZecAuth-shaped challenge).
        const sig: unknown = await signArbitrary(challenge.message)
        const transcript = (() => {
          if (typeof sig === 'string') {
            return sig.slice(0, 128)
          }
          if (sig && typeof sig === 'object' && 'signature' in sig) {
            const s = (sig as { signature?: string }).signature
            if (typeof s === 'string') {
              return s.slice(0, 128)
            }
          }
          return JSON.stringify(sig).slice(0, 128)
        })()
        const grant = buildCapabilityGrant({
          adapter,
          proofTranscript: transcript,
          subjectHint: address,
          chainId,
          scopes: [
            'identify',
            'read_profile',
            'bounties_view',
            'bounties_register_intent',
          ],
        })
        setChosenAuthMethod(adapter)
        setZcashCapabilityJson(JSON.stringify(grant, null, 2))
        toast.success(
          t('success.zcashLabCapability', {
            defaultValue:
              'Lab capability grant built (second step still required for funds). No UFVK/seed used.',
          })
        )
      } catch (err) {
        toast.error(safeLogAdapterError(err))
      } finally {
        setZcashBusy(false)
      }
    },
    [address, chainId, isWalletConnected, signArbitrary, t]
  )

  const focusMethod = useCallback((id: AuthMethodId) => {
    setFocusedMethod(id)
    setChosenAuthMethod(id)
    // Scroll-friendly focus: method-specific panels live below the chooser.
    if (typeof document !== 'undefined') {
      const el = document.getElementById(`auth-method-panel-${id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    if (id === 'adr36_bounties') {
      toast.success(
        t('info.adr36UseBountiesModule', {
          defaultValue:
            'ADR-36 membership: open the Bounties / members view and complete wallet proof. Fund/claim identity is a second step.',
        })
      )
    }
    if (id === 'smart_account') {
      toast(
        t('info.smartAccountManageHint', {
          defaultValue:
            'Smart-account authenticators: connect wallet, then manage under profile. Sign paths use the selected authenticator.',
        }),
        { icon: 'ℹ️' }
      )
    }
    if (id.startsWith('zcash_')) {
      void runZcashLabAdapter(id as ZcashAdapterId)
    }
  }, [runZcashLabAdapter, t])

  const passkeyCredentialShort = passkeyId
    ? passkeyId.slice(0, 18)
    : null

  const smartAccountState = !chainId || !isWalletConnected
    ? ('need_wallet' as const)
    : !chainSupportsSa
      ? ('unsupported' as const)
      : smartAccountLoading
        ? ('loading' as const)
        : ('ready' as const)

  const smartAccountMessage =
    smartAccountState === 'need_wallet'
      ? t('info.smartAccountConnectHint', {
          defaultValue:
            'Connect on a smartaccount-enabled chain (e.g. Terp lab 120u-1) to view authenticators.',
        })
      : smartAccountState === 'unsupported'
        ? t('info.smartAccountUnsupported', {
            defaultValue:
              'This chain does not expose x/smartaccount authenticators.',
          })
        : smartAccountState === 'ready'
          ? t('info.smartAccountStatus', {
              count: authenticators.length,
              selected: selectedAuthenticatorId?.toString() || '—',
              defaultValue:
                '{{count}} authenticator(s); selected id: {{selected}}. Manage under profile when connected.',
            })
          : undefined

  return (
    <StableAuthSection
      chooser={{
        title: t('title.authMethodChooser', {
          defaultValue: 'Auth methods',
        }),
        hint: t('info.authMethodChooserHint', {
          defaultValue:
            'Pick a method below. Fund movement and bounty authorize always need an explicit second step after session/membership proof.',
        }),
        methods: chooserMethods.map((method) => ({
          id: method.id,
          label: method.label,
          description: method.description,
          availability: method.availability,
          selectable: method.selectable,
          disabledReason: method.disabledReason,
        })),
        focusedMethodId: focusedMethod,
        onSelect: (id) => {
          focusMethod(id as AuthMethodId)
          if (id === 'passkey') {
            setPasskeyMode('choose')
          }
        },
      }}
      description={t('info.stableAuthDescription', {
        defaultValue:
          'Choose among planned auth methods for DAO membership. Extension wallets are listed above. Passkey, OCID/JWT, smart-account, and ADR-36 bounties paths stay available without forcing /onboard. Experimental Zcash Login adapters stay flag-gated.',
      })}
      title={t('title.stableAuth', {
        defaultValue: 'Stable auth',
      })}
      variant={variant}
    >
      <PasskeyAuthStage
        accounts={accounts}
        activeAccount={activeAccount}
        activeCredentialShort={passkeyCredentialShort}
        busy={busyPasskey}
        highlighted={focusedMethod === 'passkey'}
        labels={{
          title: t('title.passkeyWebAuthn', {
            defaultValue: 'Passkey / WebAuthn',
          }),
          boundHint: t('info.passkeyBoundShort', {
            id: passkeyId?.slice(0, 18) || '',
            defaultValue: 'Active credential: {{id}}…',
          }),
          notBoundHint: t('info.passkeyNotBound', {
            defaultValue:
              'No active passkey yet — use an existing local account or create one.',
          }),
          activeLocal: activeAccount
            ? t('info.activeLocalPasskey', {
                label: activeAccount.label,
                defaultValue: 'Local account: {{label}}',
              })
            : undefined,
          useExisting: t('button.useExistingPasskey', {
            defaultValue: 'Use existing',
          }),
          create: t('button.createPasskeyAccount', {
            defaultValue: 'Create passkey account',
          }),
          noAccounts: t('info.noLocalPasskeys', {
            defaultValue: 'No local passkey accounts yet.',
          }),
          back: t('button.back', { defaultValue: 'Back' }),
          pairingOn: t('info.passkeyPairingHint', {
            defaultValue:
              'Wallet connected — passkey can pair to this address for local account continuity.',
          }),
          pairingOff: t('info.passkeyPairingHidden', {
            defaultValue:
              'Pairing to a chain address is available after you connect a wallet (extensions / hardware via cosmos-kit).',
          }),
        }}
        mode={passkeyMode}
        onCreate={() => void handleCreateLocalAccount()}
        onModeChange={setPasskeyMode}
        onSelectExisting={(account) => {
          const full = accounts.find((a) => a.id === account.id)
          if (full) {
            handleSelectExisting(full)
          }
        }}
        showPairing={showPairing}
      />

      <OcidJwtAuthStage
        highlighted={focusedMethod === 'ocid_jwt'}
        connectHint={t('info.ocidConnectHint', {
          defaultValue:
            'Optional: open an onboarding invite (PFPK JWT or OIDC) if you use that plane — wallet connect does not require it.',
        })}
        detail={jwtDetail}
        openOnboardingLabel={t('button.openOnboardingOptional', {
          defaultValue: 'Onboarding invite (optional)',
        })}
        onOpenOnboarding={openOnboarding}
        showSessionDetail={variant === 'connected' && isWalletConnected}
        status={jwtStatus}
        title={t('title.ocidJwtSession', {
          defaultValue: 'OCID / JWT session',
        })}
      />

      <Adr36AuthStage
        highlighted={focusedMethod === 'adr36_bounties'}
        description={t('info.adr36BountiesSessionHint', {
          defaultValue:
            'On the Bounties tab embed, membership uses wallet signArbitrary (ADR-36). Claiming or fund-related derive is a separate explicit prompt — the iframe never auto-authorizes payouts.',
        })}
        statusLine={
          isWalletConnected
            ? t('info.adr36BountiesReady', {
                defaultValue:
                  'Wallet connected — open Bounties module to complete membership proof when prompted.',
              })
            : t('info.adr36BountiesNeedWallet', {
                defaultValue:
                  'Connect an extension wallet (Keplr/Leap/etc.) that supports signArbitrary first.',
              })
        }
        title={t('title.adr36BountiesSession', {
          defaultValue: 'ADR-36 bounties session',
        })}
      />

      <SmartAccountAuthStage
        authenticatorCount={authenticators.length}
        highlighted={focusedMethod === 'smart_account'}
        message={smartAccountMessage}
        selectedId={selectedAuthenticatorId?.toString()}
        state={smartAccountState}
        title={t('title.smartAccount', {
          defaultValue: 'Smart account',
        })}
      />

      <ZcashLoginAuthStage
        highlighted={!!focusedMethod?.startsWith('zcash_')}
        adapters={ZCASH_ADAPTER_CATALOG.map((a) => ({
          id: a.id,
          label: a.label,
          summary: a.summary,
        }))}
        busy={zcashBusy}
        capabilityJson={zcashCapabilityJson}
        description={t('info.zcashLoginLabHint', {
          defaultValue:
            'Patterns from ZecAuth / zns-login / ZecPass (hackathon). Flag-gated. Uses cosmos signArbitrary as auth-isolated stand-in — never seeds or UFVKs. Capability grants do not authorize funds.',
        })}
        experimentalNote={t('info.zcashLoginAdaptersHint', {
          defaultValue:
            'ZecAuth / zns-login / ZecPass adapter spikes stay behind NEXT_PUBLIC_ENABLE_ZCASH_* flags (default off). No seeds, UFVKs, or spending keys in the FE. Escalate security-auditor before any flag-on default.',
        })}
        experimentalTitle={t('title.zcashLoginAdapters', {
          defaultValue: 'Zcash Login adapters (experimental)',
        })}
        focusedAdapterId={focusedMethod}
        onRunAdapter={(id) => {
          setFocusedMethod(id as AuthMethodId)
          void runZcashLabAdapter(id as ZcashAdapterId)
        }}
        title={t('title.zcashLoginLab', {
          defaultValue: 'Zcash Login lab adapters',
        })}
        walletConnected={isWalletConnected}
      />
    </StableAuthSection>
  )
}
