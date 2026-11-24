/**
 * Fetch + render static pledge HTML/Markdown from IPFS gateway URL.
 * Offline / fail: honest empty state (no mesh/RPC dump).
 */
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo } from 'react'

import { Loader, MarkdownRenderer } from '@dao-dao/stateless'
import {
  detectPledgeDocKind,
  fetchPledgeDocument,
  resolvePledgeDocUrl,
} from '@dao-dao/utils'

export type PledgeDocumentBodyProps = {
  /** Bare CID, ipfs://, /ipfs/, or absolute URL */
  uriOrCid?: string
  ipfsGateway?: string
  /** Section label */
  title?: string
  className?: string
  /** When false, skip network fetch */
  enabled?: boolean
}

/**
 * Render a single pledge document slot (canonical or team variant).
 */
export const PledgeDocumentBody = ({
  uriOrCid,
  ipfsGateway,
  title = 'Pledge text',
  className,
  enabled = true,
}: PledgeDocumentBodyProps) => {
  const resolved = useMemo(
    () => resolvePledgeDocUrl(uriOrCid, ipfsGateway),
    [uriOrCid, ipfsGateway]
  )

  const query = useQuery({
    queryKey: ['trustlessPledge', 'document', resolved?.url || ''],
    queryFn: () => fetchPledgeDocument(resolved!.url),
    enabled: enabled && !!resolved?.url,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  if (!uriOrCid?.trim()) {
    return (
      <section
        className={clsx(
          'rounded-lg border border-border-secondary bg-background-primary/60 p-4',
          className
        )}
      >
        <p className="primary-text text-sm">{title}</p>
        <p className="secondary-text mt-2 text-sm">
          No document CID configured. Open the public pledge site, or ask a
          curator to set the manifesto in the module editor.
        </p>
      </section>
    )
  }

  if (query.isLoading || query.isFetching) {
    return (
      <section
        className={clsx(
          'flex flex-col items-center gap-2 rounded-lg border border-border-primary bg-background-primary/80 p-6',
          className
        )}
      >
        <Loader size={24} />
        <p className="secondary-text text-sm">Loading pledge text…</p>
      </section>
    )
  }

  if (query.isError || !query.data?.text?.trim()) {
    return (
      <section
        className={clsx(
          'rounded-lg border border-border-interactive-warning bg-background-interactive-warning/10 p-4',
          className
        )}
      >
        <p className="primary-text text-sm text-text-interactive-warning">
          {title} unavailable offline
        </p>
        <p className="secondary-text mt-2 text-sm">
          Could not load the pledge document from IPFS right now. Use Visit
          site or the Fileverse link — nothing is wrong with your wallet.
        </p>
        {resolved?.url && (
          <a
            className="link-text mt-2 inline-block text-xs"
            href={resolved.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open raw document
          </a>
        )}
      </section>
    )
  }

  const kind =
    query.data.kind === 'unknown'
      ? detectPledgeDocKind(query.data.text, query.data.contentType)
      : query.data.kind

  return (
    <section
      className={clsx(
        'rounded-lg border border-border-primary bg-background-primary/80 p-4 sm:p-5',
        className
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="primary-text text-sm">{title}</p>
        <span className="secondary-text text-xs uppercase tracking-wide opacity-70">
          {kind === 'html' ? 'HTML' : 'Markdown'}
        </span>
      </div>
      {kind === 'html' ? (
        // MarkdownRenderer already runs rehype-raw + rehype-sanitize; wrap HTML
        // fragments as markdown-passthrough so we do not introduce a second
        // dangerouslySetInnerHTML path without sanitization.
        <MarkdownRenderer
          className="!max-w-none text-sm"
          markdown={query.data.text}
        />
      ) : (
        <MarkdownRenderer
          className="!max-w-none text-sm"
          markdown={query.data.text}
        />
      )}
    </section>
  )
}
