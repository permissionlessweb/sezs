/**
 * Shared module tab header: title + lede + optional primary trailing CTA + info Modal.
 * Used by Event Hub, Calendar, Marketplace, Buzz, HermesOps, Bounties, CollabOps.
 */
import { ReactNode } from 'react'

import { ModuleInfoPopover } from './ModuleInfoPopover'

export type ModuleSectionHeaderProps = {
  title: string
  /** Short intro under the title (string or rendered markdown node) */
  lede?: ReactNode
  /** Optional primary action (e.g. Start here / Open Buzz) */
  trailing?: ReactNode
  /** Markdown for the centered “?” info Modal (product copy only) */
  infoMarkdown?: string
  infoTitle?: string
  className?: string
}

export const ModuleSectionHeader = ({
  title,
  lede,
  trailing,
  infoMarkdown,
  infoTitle,
  className,
}: ModuleSectionHeaderProps) => (
  <header
    className={
      className ||
      'flex flex-col gap-3 border-b border-border-secondary pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'
    }
  >
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="title-text text-text-body">{title}</h2>
        {infoMarkdown ? (
          <ModuleInfoPopover
            markdown={infoMarkdown}
            title={infoTitle || title}
          />
        ) : null}
      </div>
      {lede ? (
        typeof lede === 'string' ? (
          <p className="secondary-text text-sm">{lede}</p>
        ) : (
          <div className="secondary-text text-sm">{lede}</div>
        )
      ) : null}
    </div>
    {trailing ? (
      <div className="flex shrink-0 flex-wrap items-center gap-2">{trailing}</div>
    ) : null}
  </header>
)
