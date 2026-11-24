import { RefObject, useCallback, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { useThemeContext } from '@dao-dao/stateless'
import {
  BOUNTIES_PROTOCOL,
  buildBountiesAuthCapabilitiesPayload,
  buildBountiesDeriveMessage,
  buildBountiesLoginMessage,
  deriveBountyIdentityFromSignature,
  getSupportedChainConfig,
} from '@dao-dao/utils'

import { useWallet } from '../../../../hooks'
import {
  BOUNTIES_LOGIN_EXP_SECONDS,
  BOUNTIES_PROTOCOL_VERSION,
  DEFAULT_BOUNTIES_API,
} from '../constants'
import { BountiesBridgeEnvelope } from '../types'

export type BountiesIframeBridgeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>
  embedOrigin: string
  daoAddress: string
  chainId: string
  apiBaseUrl?: string
  onResize?: (height: number) => void
  /** Fired once when the child sends a real `ready` (not resize). */
  onReady?: () => void
}

const isBridgeEnvelope = (
  data: unknown
): data is BountiesBridgeEnvelope =>
  !!data &&
  typeof data === 'object' &&
  (data as BountiesBridgeEnvelope).protocol === BOUNTIES_PROTOCOL_VERSION &&
  typeof (data as BountiesBridgeEnvelope).type === 'string'

/** Strip trailing slash so `https://x.com` and `https://x.com/` match. */
const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, '')

type ChallengeResult = {
  nonce: string | null
  /** Server-issued exp (unix seconds); prefer when building login message. */
  exp?: number
  /**
   * Full ADR-36 message from API when present — sign as-is so parent/child/server
   * stay in sync (overrides local buildBountiesLoginMessage).
   */
  messageTemplate?: string
}

/**
 * Parent-side postMessage bridge for `terp-bounties/v1`.
 *
 * Handles ready → init, ADR-36 membership proofs, Mode A zcash derive, resize.
 * Only accepts messages from `embedOrigin` (trailing-slash normalized).
 *
 * Identity path (default): child may call `requestMembershipProof` then
 * `requestZcashDerive` sequentially (two wallet prompts). Optional
 * `includeDerive: true` on the membership request auto-chains derive after
 * a successful membershipProof (same accountIndex when provided).
 */
export const BountiesIframeBridge = ({
  iframeRef,
  embedOrigin,
  daoAddress,
  chainId,
  apiBaseUrl,
  onResize,
  onReady,
}: BountiesIframeBridgeProps) => {
  const { t } = useTranslation()
  const { theme } = useThemeContext()
  const { address, isWalletConnected, chainWallet } = useWallet({
    chainId,
    attemptConnection: true,
  })

  const locale =
    typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en'

  const targetOrigin = normalizeOrigin(embedOrigin)

  const postToChild = useCallback(
    (msg: BountiesBridgeEnvelope) => {
      const win = iframeRef.current?.contentWindow
      if (!win || !targetOrigin) {
        return
      }
      win.postMessage(msg, targetOrigin)
    },
    [iframeRef, targetOrigin]
  )

  const resolveApiBase = useCallback((): string => {
    if (apiBaseUrl?.trim()) {
      return apiBaseUrl.replace(/\/$/, '')
    }
    const fromChain = getSupportedChainConfig(chainId)?.services?.bountiesApi
    return (fromChain || DEFAULT_BOUNTIES_API).replace(/\/$/, '')
  }, [apiBaseUrl, chainId])

  const signArbitrary = useCallback(
    async (message: string) => {
      if (!isWalletConnected || !address) {
        throw new Error(
          t('error.logInToContinue', {
            defaultValue: 'Connect a wallet to continue.',
          })
        )
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

      if (!client?.signArbitrary) {
        // Prefer cosmos-kit client; fall back to injected providers that expose
        // ADR-36 (Keplr/Leap/Visor). Hardware (Keystone/Zodl) must go through
        // the cosmos-kit client path above — inject-only is last resort.
        const w = window as unknown as {
          keplr?: {
            signArbitrary: (
              chainId: string,
              signer: string,
              data: string | Uint8Array
            ) => Promise<{
              signature: string
              pub_key: { type: string; value: string }
            }>
          }
          leap?: {
            signArbitrary: (
              chainId: string,
              signer: string,
              data: string | Uint8Array
            ) => Promise<{
              signature: string
              pub_key: { type: string; value: string }
            }>
          }
        }
        const injected =
          w.keplr?.signArbitrary?.bind(w.keplr) ||
          w.leap?.signArbitrary?.bind(w.leap)
        if (!injected) {
          throw new Error(
            t('error.unsupportedAminoWallet', {
              name: chainWallet?.walletPrettyName || 'wallet',
              defaultValue:
                'This wallet does not support signArbitrary (ADR-36). Use Keplr, Leap, Visor, or a cosmos-kit client that exposes signArbitrary (Keystone/Zodl via their adapter).',
            })
          )
        }
        return injected(chainId, address, message)
      }

      return client.signArbitrary(chainId, address, message)
    },
    [address, chainId, chainWallet, isWalletConnected, t]
  )

  const fetchChallenge = useCallback(async (): Promise<ChallengeResult> => {
    const base = resolveApiBase()
    const url = `${base}/auth/adr36/challenge?dao=${encodeURIComponent(
      daoAddress
    )}&chainId=${encodeURIComponent(chainId)}`
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        return { nonce: null }
      }
      const body = (await res.json()) as {
        nonce?: string
        challenge?: string
        exp?: number
        fields?: { exp?: number; nonce?: string }
        messageTemplate?: string
        message?: string
      }
      const nonce =
        body.nonce || body.challenge || body.fields?.nonce || null
      const exp =
        typeof body.exp === 'number' && body.exp > 0
          ? body.exp
          : typeof body.fields?.exp === 'number' && body.fields.exp > 0
            ? body.fields.exp
            : undefined
      const messageTemplate =
        typeof body.messageTemplate === 'string' && body.messageTemplate.trim()
          ? body.messageTemplate
          : typeof body.message === 'string' && body.message.trim()
            ? body.message
            : undefined
      return { nonce, exp, messageTemplate }
    } catch {
      return { nonce: null }
    }
  }, [chainId, daoAddress, resolveApiBase])

  const handleZcashDerive = useCallback(
    async (requestId: string | undefined, payload: unknown) => {
      try {
        const req = (payload || {}) as {
          accountIndex?: number
          purpose?: string
        }
        const accountIndex =
          typeof req.accountIndex === 'number' && req.accountIndex >= 0
            ? req.accountIndex
            : 0

        if (!address) {
          toast.error(
            t('error.logInToContinue', {
              defaultValue: 'Connect a wallet to continue.',
            })
          )
          postToChild({
            protocol: BOUNTIES_PROTOCOL,
            type: 'error',
            requestId,
            payload: { code: 'WALLET_DISCONNECTED' },
          })
          return
        }

        const deriveMessage = buildBountiesDeriveMessage({
          chainId,
          daoAddress,
          addr: address,
          accountIndex,
        })

        const signed = await signArbitrary(deriveMessage)
        const identity = deriveBountyIdentityFromSignature({
          signature: signed.signature,
          chainId,
          daoAddress,
          accountIndex,
          deriveMessage,
        })

        // NEVER send sk / IKM / full OKM — public identity only.
        postToChild({
          protocol: BOUNTIES_PROTOCOL,
          type: 'zcashDeriveResult',
          requestId,
          bountyPk: identity.bountyPk,
          algo: identity.algo,
          transcriptHash: identity.transcriptHash,
          accountIndex,
          purpose: req.purpose,
          payload: {
            bountyPk: identity.bountyPk,
            algo: identity.algo,
            transcriptHash: identity.transcriptHash,
            accountIndex,
            purpose: req.purpose,
          },
        } as BountiesBridgeEnvelope)
      } catch (err) {
        console.error('[BountiesIframeBridge] zcash derive failed', err)
        toast.error(
          err instanceof Error
            ? err.message
            : t('error.unexpectedError', {
                defaultValue: 'Unexpected error',
              })
        )
        postToChild({
          protocol: BOUNTIES_PROTOCOL,
          type: 'error',
          requestId,
          payload: {
            code: 'ZCASH_DERIVE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    },
    [address, chainId, daoAddress, postToChild, signArbitrary, t]
  )

  const handleMembershipProof = useCallback(
    async (requestId: string | undefined, payload: unknown) => {
      try {
        const req = (payload || {}) as {
          nonce?: string
          exp?: number
          /** When true, parent auto-chains Mode A derive after membershipProof. */
          includeDerive?: boolean
          needBountyPk?: boolean
          accountIndex?: number
          purpose?: string
        }

        let nonce = req.nonce?.trim() || ''
        let challengeExp: number | undefined
        let messageTemplate: string | undefined

        // Fetch challenge for nonce (if needed) and optional server messageTemplate/exp
        // so parent/child/API verify the same ADR-36 bytes.
        const challenge = await fetchChallenge()
        if (!nonce) {
          if (!challenge.nonce) {
            toast.error(
              t('error.bountiesChallengeUnavailable', {
                defaultValue:
                  'Bounties auth challenge unavailable (API offline or 404). Try again later or ask the child embed to supply a nonce.',
              })
            )
            postToChild({
              protocol: BOUNTIES_PROTOCOL,
              type: 'error',
              requestId,
              payload: {
                code: 'CHALLENGE_UNAVAILABLE',
                message: 'ADR-36 challenge fetch failed',
              },
            })
            return
          }
          nonce = challenge.nonce
          challengeExp = challenge.exp
          messageTemplate = challenge.messageTemplate
        } else {
          // Child-supplied nonce: still adopt server exp/template only if they
          // clearly match this nonce (avoid signing a different challenge).
          challengeExp = challenge.exp
          if (
            challenge.messageTemplate &&
            challenge.messageTemplate.includes(`nonce=${nonce}`)
          ) {
            messageTemplate = challenge.messageTemplate
          }
        }

        if (!address) {
          toast.error(
            t('error.logInToContinue', {
              defaultValue: 'Connect a wallet to continue.',
            })
          )
          postToChild({
            protocol: BOUNTIES_PROTOCOL,
            type: 'error',
            requestId,
            payload: { code: 'WALLET_DISCONNECTED' },
          })
          return
        }

        // Prefer server messageTemplate when present (parent/child/server sync).
        // exp in the proof MUST match the exp inside the signed message bytes.
        let exp =
          typeof req.exp === 'number' && req.exp > 0
            ? req.exp
            : typeof challengeExp === 'number' && challengeExp > 0
              ? challengeExp
              : Math.floor(Date.now() / 1000) + BOUNTIES_LOGIN_EXP_SECONDS

        const message =
          messageTemplate ||
          buildBountiesLoginMessage({
            chainId,
            daoAddress,
            addr: address,
            nonce,
            exp,
          })

        // If server template embeds exp=…, surface that same value in the proof.
        const expFromMessage = message.match(/(?:^|\n)exp=(\d+)(?:\n|$)/)
        if (expFromMessage) {
          exp = Number(expFromMessage[1])
        }

        const signed = await signArbitrary(message)

        // Flat + nested shapes so embed FE can read either contract.
        // `exp` / `expiresAt` match the signed login message.
        const proofInner = {
          message,
          signature: signed.signature,
          pub_key: signed.pub_key,
          pubkey:
            typeof signed.pub_key === 'object' && signed.pub_key
              ? (signed.pub_key as { value?: string }).value
              : undefined,
          address,
          chainId,
          dao: daoAddress,
          daoAddress,
          nonce,
          exp,
          expiresAt: exp,
        }
        postToChild({
          protocol: BOUNTIES_PROTOCOL,
          type: 'membershipProof',
          requestId,
          proofType: 'adr36',
          ...proofInner,
          expiresAt: exp,
          exp,
          payload: {
            proofType: 'adr36',
            ...proofInner,
            payload: proofInner,
            expiresAt: exp,
            exp,
          },
        } as BountiesBridgeEnvelope)

        // Optional auto-chain: child may set includeDerive/needBountyPk so
        // JWT-style flows that need bountyPk get a second sign without a
        // separate button. Default remains sequential requestZcashDerive.
        const shouldDerive =
          req.includeDerive === true || req.needBountyPk === true
        if (shouldDerive) {
          // requestId only correlates membershipProof; derive uses no id
          // unless child later sends requestZcashDerive with its own id.
          void handleZcashDerive(undefined, {
            accountIndex: req.accountIndex,
            purpose: req.purpose || 'register',
          })
        }
      } catch (err) {
        console.error('[BountiesIframeBridge] membership proof failed', err)
        toast.error(
          err instanceof Error
            ? err.message
            : t('error.unexpectedError', {
                defaultValue: 'Unexpected error',
              })
        )
        postToChild({
          protocol: BOUNTIES_PROTOCOL,
          type: 'error',
          requestId,
          payload: {
            code: 'MEMBERSHIP_PROOF_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    },
    [
      address,
      chainId,
      daoAddress,
      fetchChallenge,
      handleZcashDerive,
      postToChild,
      signArbitrary,
      t,
    ]
  )

  const buildAuthCapsPayload = useCallback(
    () =>
      /**
       * Threat AC: parent never auto-authorizes fund movement / bounty claims.
       * Child must request membershipProof and requestZcashDerive as distinct steps
       * unless the user explicitly opts into includeDerive on membership (still two signs).
       */
      buildBountiesAuthCapabilitiesPayload({
        resolveOptions: { walletConnected: isWalletConnected },
        activeWallet: address || null,
      }),
    [address, isWalletConnected]
  )

  // Stable refs so the listener always sees latest handlers without rebind churn.
  const handlersRef = useRef({
    handleMembershipProof,
    handleZcashDerive,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    buildAuthCapsPayload,
  })
  handlersRef.current = {
    handleMembershipProof,
    handleZcashDerive,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    buildAuthCapsPayload,
  }

  useEffect(() => {
    const allowedOrigin = normalizeOrigin(embedOrigin)
    if (!allowedOrigin) {
      return
    }

    let childReady = false

    const onMessage = (event: MessageEvent) => {
      // Origin allowlist — trailing-slash normalized embed origin only.
      if (normalizeOrigin(event.origin) !== allowedOrigin) {
        return
      }
      if (!isBridgeEnvelope(event.data)) {
        return
      }

      const {
        handleMembershipProof: membership,
        handleZcashDerive: derive,
        postToChild: post,
        onResize: resize,
        onReady: ready,
        theme: th,
        locale: loc,
        daoAddress: dao,
        chainId: cid,
        buildAuthCapsPayload: authCaps,
      } = handlersRef.current

      const { type, payload, requestId } = event.data
      // Child may send flat fields (nonce, height, …) or nested `payload`.
      const flat = event.data as BountiesBridgeEnvelope & Record<string, unknown>
      const body =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : flat

      switch (type) {
        case 'ready': {
          childReady = true
          const caps = authCaps()
          // Flat init fields for embed FE + nested payload for envelope parsers.
          // authCapabilities: multi-auth chooser for child; never auto-funds.
          post({
            protocol: BOUNTIES_PROTOCOL,
            type: 'init',
            requestId,
            daoAddress: dao,
            chainId: cid,
            theme: th,
            locale: loc,
            authCapabilities: caps,
            payload: {
              daoAddress: dao,
              chainId: cid,
              theme: th,
              locale: loc,
              authCapabilities: caps,
            },
          } as BountiesBridgeEnvelope)
          ready?.()
          break
        }
        case 'requestAuthCapabilities': {
          const caps = authCaps()
          post({
            protocol: BOUNTIES_PROTOCOL,
            type: 'authCapabilities',
            requestId,
            ...caps,
            payload: caps,
          } as BountiesBridgeEnvelope)
          break
        }
        case 'requestMembershipProof':
          void membership(requestId, body)
          break
        case 'requestZcashDerive':
          // Sequential path after membershipProof (button or child auto-request).
          // Explicit second step for fund/claim-related derive (threat AC).
          void derive(requestId, body)
          break
        case 'resize': {
          const height =
            typeof body.height === 'number'
              ? body.height
              : (payload as { height?: number } | undefined)?.height
          if (typeof height === 'number' && height > 0) {
            resize?.(height)
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('message', onMessage)

    // Proactive ping so child can learn event.origin when referrer is stripped
    // and parentOrigin query is missing/stale. Child reply path: ready → init.
    const sendPing = () => {
      if (childReady) return
      handlersRef.current.postToChild({
        protocol: BOUNTIES_PROTOCOL,
        type: 'ping',
        payload: { source: 'parent' },
      })
    }
    // After iframe has a chance to load + register its listener.
    const t0 = window.setTimeout(sendPing, 400)
    const t1 = window.setTimeout(sendPing, 1500)
    const t2 = window.setTimeout(sendPing, 4000)
    const iframe = iframeRef.current
    const onLoad = () => sendPing()
    iframe?.addEventListener('load', onLoad)

    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(t0)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      iframe?.removeEventListener('load', onLoad)
    }
  }, [embedOrigin, iframeRef])

  return null
}
