import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import { getSupportedChainConfig } from '@dao-dao/utils'

import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { BountiesIframeBridge } from './components/BountiesIframeBridge'
import { BOUNTIES_IFRAME_MIN_HEIGHT, DEFAULT_BOUNTIES_EMBED } from './constants'
import { BountiesModuleData } from './types'

const resolveEmbedBase = (
  embedBaseUrl: string | undefined,
  chainId: string
): string => {
  const trimmed = embedBaseUrl?.trim()
  if (trimmed) {
    return trimmed.replace(/\/$/, '')
  }
  const fromChain = getSupportedChainConfig(chainId)?.services?.bountiesEmbed
  return (fromChain || DEFAULT_BOUNTIES_EMBED).replace(/\/$/, '')
}

/**
 * Build embed URL:
 * `{embedBase}/embed?dao={daoAddress}&chain={chainId}&view={defaultView}&parent=daodao&auth=adr36`
 */
export const buildBountiesEmbedUrl = ({
  embedBase,
  daoAddress,
  chainId,
  defaultView,
}: {
  embedBase: string
  daoAddress: string
  chainId: string
  defaultView: 'public' | 'members'
}): string => {
  const url = new URL(`${embedBase}/embed`)
  url.searchParams.set('dao', daoAddress)
  url.searchParams.set('chain', chainId)
  url.searchParams.set('view', defaultView)
  url.searchParams.set('parent', 'daodao')
  url.searchParams.set('auth', 'adr36')
  return url.toString()
}

/**
 * Bounties tab — iframe shell + terp-bounties/v1 postMessage bridge.
 */
export const BountiesRenderer = ({
  variables: {
    description,
    embedBaseUrl = '',
    defaultView = 'members',
    bountiesChainId,
  },
}: ModuleRendererProps<BountiesModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(BOUNTIES_IFRAME_MIN_HEIGHT)
  const [iframeFailed, setIframeFailed] = useState(false)

  const chainId = bountiesChainId?.trim() || dao.chainId
  const daoAddress = dao.coreAddress

  const embedBase = useMemo(
    () => resolveEmbedBase(embedBaseUrl, chainId),
    [embedBaseUrl, chainId]
  )

  const embedOrigin = useMemo(() => {
    try {
      return new URL(embedBase).origin
    } catch {
      return ''
    }
  }, [embedBase])

  const src = useMemo(
    () =>
      buildBountiesEmbedUrl({
        embedBase,
        daoAddress,
        chainId,
        defaultView: defaultView === 'public' ? 'public' : 'members',
      }),
    [embedBase, daoAddress, chainId, defaultView]
  )

  const apiBaseUrl =
    getSupportedChainConfig(chainId)?.services?.bountiesApi || undefined

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : null}

      {!embedOrigin ? (
        <div className="rounded-md border border-dashed border-border-primary px-4 py-6">
          <p className="primary-text text-sm">
            {t('info.bountiesInvalidEmbed', {
              defaultValue:
                'Bounties board URL is missing or invalid. Operators set embedBaseUrl or chain services.bountiesEmbed.',
            })}
          </p>
        </div>
      ) : iframeFailed ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-secondary p-4">
          <p className="primary-text text-sm">
            {t('info.bountiesOffline', {
              defaultValue: 'Bounties board could not load in this view.',
            })}
          </p>
          <ButtonLink href={src} openInNewTab variant="primary">
            {t('button.openBounties', { defaultValue: 'Open bounties' })}
          </ButtonLink>
          <DevOpsDisclosure>
            <DevOpsMonoLine label="embed" value={src} />
          </DevOpsDisclosure>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="secondary-text text-sm">
              {t('info.bountiesEmbedHintShort', {
                defaultValue:
                  'Board loads below. Keys and membership proofs stay in this parent window.',
              })}
            </p>
            <ButtonLink href={src} openInNewTab size="sm" variant="ghost">
              {t('button.openInNewTab', { defaultValue: 'Open in new tab' })}
            </ButtonLink>
          </div>

          <BountiesIframeBridge
            apiBaseUrl={apiBaseUrl}
            chainId={chainId}
            daoAddress={daoAddress}
            embedOrigin={embedOrigin}
            iframeRef={iframeRef}
            onResize={(height) =>
              setIframeHeight(Math.max(BOUNTIES_IFRAME_MIN_HEIGHT, height))
            }
          />

          <iframe
            allow="clipboard-write"
            className="w-full rounded-md border border-border-primary bg-background-base"
            onError={() => setIframeFailed(true)}
            ref={iframeRef}
            // Match AppsRenderer capabilities + design sandbox notes.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            src={src}
            style={{
              height: iframeHeight,
              minHeight: BOUNTIES_IFRAME_MIN_HEIGHT,
            }}
            title={t('title.bounties', { defaultValue: 'Bounties' })}
          />
          <DevOpsDisclosure>
            <DevOpsMonoLine label="embed" value={src} />
          </DevOpsDisclosure>
        </>
      )}
    </div>
  )
}
