import { RefObject, useCallback, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { useThemeContext } from '@dao-dao/stateless'

import { useWallet } from '../../../../hooks'
import {
  BUZZ_DAO_ATTEST_EXP_SECONDS,
  BUZZ_IFRAME_MIN_HEIGHT,
  BUZZ_PROTOCOL_VERSION,
  buildBuzzDaoAttestMessage,
} from '../constants'
import { BuzzBridgeEnvelope } from '../types'

export type BuzzIframeBridgeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>
  embedOrigin: string
  daoAddress: string
  chainId: string
  enableDaoAttest?: boolean
  onResize?: (height: number) => void
  /** Fired once when the child sends a real `ready` (not resize). */
  onReady?: () => void
}

const isBridgeEnvelope = (data: unknown): data is BuzzBridgeEnvelope =>
  !!data &&
  typeof data === 'object' &&
  (data as BuzzBridgeEnvelope).protocol === BUZZ_PROTOCOL_VERSION &&
  typeof (data as BuzzBridgeEnvelope).type === 'string'

/** Strip trailing slash so `https://x.com` and `https://x.com/` match. */
const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, '')

/**
 * Parent-side postMessage bridge for `terp-buzz/v1`.
 *
 * Message flow:
 * 1. Child sends `ready` → parent sends `init` with DAO context.
 * 2. Child may send `requestDaoAttest` → parent signs ADR-36 daoAttest message,
 *    sends `daoAttest` result or `daoAttestDenied`.
 * 3. Child sends `resize` → parent updates iframe height.
 * 4. Child sends `ping` → parent responds with `handshake`.
 *
 * Never mix with terp-bounties/v1 JWT or terp-hermes/v1 tokens.
 */
export const BuzzIframeBridge = ({
  iframeRef,
  embedOrigin,
  daoAddress,
  chainId,
  enableDaoAttest = true,
  onResize,
  onReady,
}: BuzzIframeBridgeProps) => {
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
    (msg: BuzzBridgeEnvelope) => {
      const win = iframeRef.current?.contentWindow
      if (!win || !targetOrigin) {
        return
      }
      win.postMessage(msg, targetOrigin)
    },
    [iframeRef, targetOrigin]
  )

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
        // Keplr / Leap global fallback when cosmos-kit client lacks the method.
        const keplr = (
          window as unknown as {
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
          }
        ).keplr
        if (!keplr?.signArbitrary) {
          throw new Error(
            t('error.unsupportedAminoWallet', {
              name: chainWallet?.walletPrettyName || 'wallet',
              defaultValue:
                'This wallet does not support signArbitrary (ADR-36).',
            })
          )
        }
        return keplr.signArbitrary(chainId, address, message)
      }

      return client.signArbitrary(chainId, address, message)
    },
    [address, chainId, chainWallet, isWalletConnected, t]
  )

  const handleDaoAttest = useCallback(
    async (requestId: string | undefined, payload: unknown) => {
      try {
        if (!enableDaoAttest) {
          postToChild({
            protocol: BUZZ_PROTOCOL_VERSION,
            type: 'daoAttestDenied',
            requestId,
            payload: { reason: 'DAO attestation disabled' },
          })
          return
        }

        const req = (payload || {}) as {
          nonce?: string
          exp?: number
          purpose?: string
        }
        const purpose = req.purpose?.trim() || 'room-gate'
        const exp =
          typeof req.exp === 'number' && req.exp > 0
            ? req.exp
            : Math.floor(Date.now() / 1000) + BUZZ_DAO_ATTEST_EXP_SECONDS
        const nonce = req.nonce || crypto.randomUUID()

        if (!address) {
          toast.error(
            t('error.logInToContinue', {
              defaultValue: 'Connect a wallet to continue.',
            })
          )
          postToChild({
            protocol: BUZZ_PROTOCOL_VERSION,
            type: 'daoAttestDenied',
            requestId,
            payload: { code: 'WALLET_DISCONNECTED' },
          })
          return
        }

        const message = buildBuzzDaoAttestMessage({
          chainId,
          daoAddress,
          addr: address,
          nonce,
          purpose,
          exp,
        })

        const signed = await signArbitrary(message)

        postToChild({
          protocol: BUZZ_PROTOCOL_VERSION,
          type: 'daoAttest',
          requestId,
          payload: {
            message,
            signature: signed.signature,
            pub_key: signed.pub_key,
            address,
            chainId,
            dao: daoAddress,
            nonce,
            exp,
            purpose,
          },
        } as BuzzBridgeEnvelope)
      } catch (err) {
        console.error('[BuzzIframeBridge] daoAttest failed', err)
        toast.error(
          err instanceof Error
            ? err.message
            : t('error.unexpectedError', {
                defaultValue: 'Unexpected error',
              })
        )
        postToChild({
          protocol: BUZZ_PROTOCOL_VERSION,
          type: 'daoAttestDenied',
          requestId,
          payload: {
            code: 'DAO_ATTEST_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    },
    [address, chainId, daoAddress, enableDaoAttest, postToChild, signArbitrary, t]
  )

  // Stable refs so the listener always sees latest handlers without rebind churn.
  const handlersRef = useRef({
    handleDaoAttest,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    address,
  })
  handlersRef.current = {
    handleDaoAttest,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    address,
  }

  useEffect(() => {
    const allowedOrigin = normalizeOrigin(embedOrigin)
    if (!allowedOrigin) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      // Origin allowlist — trailing-slash normalized embed origin only.
      if (normalizeOrigin(event.origin) !== allowedOrigin) {
        return
      }
      if (!isBridgeEnvelope(event.data)) {
        return
      }

      const { type, payload, requestId } = event.data as BuzzBridgeEnvelope
      const h = handlersRef.current

      switch (type) {
        case 'ready': {
          // Send init with DAO context; surface true child-ready (not resize).
          postToChild({
            protocol: BUZZ_PROTOCOL_VERSION,
            type: 'init',
            payload: {
              dao: daoAddress,
              chainId,
              address: h.address,
              theme: h.theme,
              locale: h.locale,
              enableDaoAttest,
            },
          })
          h.onReady?.()
          break
        }

        case 'requestDaoAttest': {
          void h.handleDaoAttest(requestId, payload)
          break
        }

        case 'ping': {
          postToChild({
            protocol: BUZZ_PROTOCOL_VERSION,
            type: 'handshake',
            payload: { ts: Date.now() },
          })
          break
        }

        case 'resize': {
          const height =
            payload && typeof payload === 'object'
              ? (payload as { height?: number }).height
              : undefined
          if (typeof height === 'number' && height >= BUZZ_IFRAME_MIN_HEIGHT) {
            h.onResize?.(height)
          }
          break
        }

        case 'navigate': {
          // Informational — no action required by default.
          break
        }

        case 'error': {
          console.error('[BuzzIframeBridge] embed error', payload)
          break
        }

        default:
          break
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [embedOrigin, postToChild, daoAddress, chainId, enableDaoAttest])

  return null
}