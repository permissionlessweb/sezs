import { RefObject, useCallback, useEffect, useRef } from 'react'

import { useThemeContext } from '@dao-dao/stateless'

import {
  HERMES_OPERATOR_CONTEXT_EXP_SECONDS,
  HERMES_PROTOCOL_VERSION,
} from '../constants'
import { HermesBridgeEnvelope } from '../types'

export type HermesOpsIframeBridgeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>
  embedOrigin: string
  daoAddress: string
  chainId: string
  defaultView: 'kanban' | 'gateway' | 'status'
  address: string | undefined
  isMember: boolean
  isAdmin: boolean
  onResize?: (height: number) => void
  /** Fired when the child sends `ready` (or ping/handshake treated as ready). */
  onReady?: () => void
}

const isHermesEnvelope = (data: unknown): data is HermesBridgeEnvelope =>
  !!data &&
  typeof data === 'object' &&
  (data as HermesBridgeEnvelope).protocol === HERMES_PROTOCOL_VERSION &&
  typeof (data as HermesBridgeEnvelope).type === 'string'

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, '')

/**
 * Parent-side postMessage bridge for `terp-hermes/v1`.
 *
 * Handles ready → init, requestOperatorContext → public membership facts only.
 * Only accepts messages from `embedOrigin`. Ignores foreign protocols.
 * Never posts Hermes API keys, agent tokens, bounty JWT, or Nostr nsec.
 */
export const HermesOpsIframeBridge = ({
  iframeRef,
  embedOrigin,
  daoAddress,
  chainId,
  defaultView,
  address,
  isMember,
  isAdmin,
  onResize,
  onReady,
}: HermesOpsIframeBridgeProps) => {
  const { theme } = useThemeContext()

  const locale =
    typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en'

  const targetOrigin = normalizeOrigin(embedOrigin)

  const postToChild = useCallback(
    (msg: HermesBridgeEnvelope) => {
      const win = iframeRef.current?.contentWindow
      if (!win || !targetOrigin) {
        return
      }
      // Never postMessage(..., '*')
      win.postMessage(msg, targetOrigin)
    },
    [iframeRef, targetOrigin]
  )

  const handleOperatorContext = useCallback(
    (requestId: string | undefined) => {
      if (!isMember || !address) {
        postToChild({
          protocol: HERMES_PROTOCOL_VERSION,
          type: 'sessionDenied',
          requestId,
          payload: {
            reason: !address ? 'wallet_disconnected' : 'not_member',
          },
        })
        return
      }

      const exp =
        Math.floor(Date.now() / 1000) + HERMES_OPERATOR_CONTEXT_EXP_SECONDS

      postToChild({
        protocol: HERMES_PROTOCOL_VERSION,
        type: 'operatorContext',
        requestId,
        payload: {
          address,
          daoAddress,
          chainId,
          isMember: true,
          isAdmin,
          exp,
        },
      })
    },
    [address, chainId, daoAddress, isAdmin, isMember, postToChild]
  )

  const handlersRef = useRef({
    handleOperatorContext,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    defaultView,
  })
  handlersRef.current = {
    handleOperatorContext,
    postToChild,
    onResize,
    onReady,
    theme,
    locale,
    daoAddress,
    chainId,
    defaultView,
  }

  useEffect(() => {
    const allowedOrigin = normalizeOrigin(embedOrigin)
    if (!allowedOrigin) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      if (normalizeOrigin(event.origin) !== allowedOrigin) {
        return
      }
      if (!isHermesEnvelope(event.data)) {
        return
      }

      const {
        handleOperatorContext: opCtx,
        postToChild: post,
        onResize: resize,
        onReady: ready,
        theme: th,
        locale: loc,
        daoAddress: dao,
        chainId: cid,
        defaultView: view,
      } = handlersRef.current

      const { type, payload, requestId } = event.data
      const flat = event.data as HermesBridgeEnvelope & Record<string, unknown>
      const body =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : flat

      switch (type) {
        case 'ready':
        case 'ping':
        case 'handshake':
          post({
            protocol: HERMES_PROTOCOL_VERSION,
            type: 'init',
            requestId,
            payload: {
              daoAddress: dao,
              chainId: cid,
              theme: th,
              locale: loc,
              view,
            },
          })
          // Only treat true `ready` as host-up for friction timeout; ping/handshake
          // still get init so late children can reconnect without false positives.
          if (type === 'ready') {
            ready?.()
          }
          break
        case 'requestOperatorContext':
          opCtx(requestId)
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
    return () => window.removeEventListener('message', onMessage)
  }, [embedOrigin])

  return null
}
