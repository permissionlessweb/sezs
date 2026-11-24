/**
 * Presentational Trustlessness Pledge card — inviting hero + clear CTAs.
 * Stateful renderer owns queries; this paints status + actions.
 */
import {
  ArrowOutward,
  CheckCircleOutline,
  DescriptionOutlined,
  GppGoodOutlined,
  PublicOutlined,
  VerifiedRounded,
} from '@mui/icons-material'
import clsx from 'clsx'
import { ReactNode } from 'react'

export type TrustlessPledgeStatusProps = {
  connected: boolean
  loading?: boolean
  error?: string | null
  hasPledged?: boolean
  tokenId?: string
  mintCount?: number
  collectionConfigured: boolean
  manifestoCid?: string
  /** Human-readable manifesto / Fileverse deep link */
  pledgeDocUrl?: string
  /**
   * Public marketing / pledge home (permissionless.money/pledge).
   * Primary “Visit site” destination — not the raw Fileverse URL.
   */
  pledgeSiteUrl?: string
  /** IPFS gateway URL for manifesto CID */
  manifestoIpfsUrl?: string
  teamNote?: string
  description?: string
  buttonLabel?: string
  signDisabled?: boolean
  onSignAndMint?: () => void
  /**
   * Static pledge document body (fetched HTML/MD). Rendered in the product
   * “Pledge content” slot — not digests or mesh dumps.
   */
  documentBody?: ReactNode
  /** Optional team-variant document body under the canonical text. */
  teamDocumentBody?: ReactNode
  /** Optional footer notes (ADR-36 honesty, collection addr, attestation). */
  footer?: ReactNode
  /** Extra blocks under the main CTA (project_id, attestation, etc.). */
  children?: ReactNode
}

const ExternalLink = ({
  href,
  children,
  primary,
}: {
  href: string
  children: ReactNode
  primary?: boolean
}) => (
  <a
    className={clsx(
      'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-opacity hover:opacity-90',
      primary
        ? 'bg-background-button text-text-button-primary'
        : 'border border-border-primary bg-background-secondary text-text-body'
    )}
    href={href}
    rel="noopener noreferrer"
    target="_blank"
  >
    {children}
    <ArrowOutward className="!h-3.5 !w-3.5 opacity-80" />
  </a>
)

export const TrustlessPledgeStatus = ({
  connected,
  loading,
  error,
  hasPledged,
  tokenId,
  mintCount,
  collectionConfigured,
  manifestoCid,
  pledgeDocUrl,
  pledgeSiteUrl,
  manifestoIpfsUrl,
  teamNote,
  description,
  buttonLabel = 'Sign & mint pledge',
  signDisabled,
  onSignAndMint,
  documentBody,
  teamDocumentBody,
  footer,
  children,
}: TrustlessPledgeStatusProps) => {
  const siteUrl =
    pledgeSiteUrl ||
    (typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_PLEDGE_SITE_URL) ||
    'https://permissionless.money/pledge'

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-primary bg-background-secondary">
      {/* Soft accent wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 80% 100% at 20% 0%, rgba(177, 235, 235, 0.18), transparent 70%), radial-gradient(ellipse 60% 80% at 90% 10%, rgba(189, 147, 249, 0.14), transparent 65%)',
        }}
      />

      <div className="relative flex flex-col gap-6 p-5 sm:p-6">
        {/* Hero */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-interactive-hover bg-background-primary shadow-sm">
                <VerifiedRounded className="!h-5 !w-5 text-icon-interactive-valid" />
              </span>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-interactive-valid">
                Team integrity · on-chain
              </p>
            </div>
            <h2 className="hero-text text-2xl leading-tight sm:text-3xl">
              Trustlessness Pledge
            </h2>
            <p className="body-text max-w-xl text-text-secondary">
              {description ||
                'A public commitment to build without hidden backdoors—signed with your wallet, minted as an NFT, verifiable by anyone.'}
            </p>
            {teamNote && (
              <p className="secondary-text max-w-xl text-sm italic text-text-tertiary">
                {teamNote}
              </p>
            )}
          </div>

          {/* Primary site CTA — real website, not a raw doc hash */}
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <ExternalLink href={siteUrl} primary>
              <PublicOutlined className="!h-4 !w-4" />
              Visit Trustlessness Pledge
            </ExternalLink>
            {pledgeDocUrl && (
              <a
                className="link-text inline-flex items-center gap-1 text-xs text-text-tertiary"
                href={pledgeDocUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <DescriptionOutlined className="!h-3.5 !w-3.5" />
                Full text (Fileverse)
                <ArrowOutward className="!h-3 !w-3" />
              </a>
            )}
          </div>
        </header>

        {/* Value props */}
        <ul className="grid gap-2 sm:grid-cols-3">
          {[
            {
              icon: GppGoodOutlined,
              title: 'Wallet-bound',
              body: 'ADR-36 auth + ADR-032 digest—not a screenshot of a signature.',
            },
            {
              icon: PublicOutlined,
              title: 'Public home',
              body: 'Read the pledge on permissionless.money before you mint.',
            },
            {
              icon: CheckCircleOutline,
              title: 'Chain truth',
              body: 'Ownership of the pledge NFT is the only source of “has pledged.”',
            },
          ].map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col gap-1 rounded-lg border border-border-secondary bg-background-primary/60 p-3"
            >
              <div className="flex items-center gap-1.5">
                <Icon className="!h-4 !w-4 text-icon-secondary" />
                <span className="primary-text text-sm">{title}</span>
              </div>
              <p className="secondary-text text-xs leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>

        {/* Static pledge document (HTML/MD) — product body, not CID dump */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <p className="primary-text text-sm">Pledge content</p>
            <div className="flex flex-wrap gap-2">
              <ExternalLink href={siteUrl}>Open site</ExternalLink>
              {manifestoIpfsUrl && (
                <ExternalLink href={manifestoIpfsUrl}>IPFS</ExternalLink>
              )}
            </div>
          </div>
          {documentBody ??
            (manifestoCid ? (
              <p className="secondary-text font-mono text-xs break-all opacity-80">
                Manifesto CID · {manifestoCid}
              </p>
            ) : (
              <p className="text-xs text-text-interactive-warning">
                Manifesto CID not configured yet—curators set it in the module
                editor. You can still read the public pledge site.
              </p>
            ))}
          {teamDocumentBody}
        </div>

        {/* Status */}
        <section className="flex flex-col gap-3">
          {!collectionConfigured ? (
            <div className="rounded-lg border border-border-interactive-warning bg-background-interactive-warning/10 p-4">
              <p className="primary-text text-sm text-text-interactive-warning">
                Collection not configured
              </p>
              <p className="secondary-text mt-1 text-sm">
                Set a cw721_svg collection address in the module editor to enable
                on-chain status and mint.
              </p>
            </div>
          ) : !connected ? (
            <div className="rounded-lg border border-border-primary bg-background-primary p-4">
              <p className="primary-text text-sm">Connect to continue</p>
              <p className="secondary-text mt-1 text-sm">
                Connect a wallet to see whether you already hold a pledge NFT
                and to sign & mint.
              </p>
            </div>
          ) : loading ? (
            <p className="secondary-text text-sm animate-pulse">
              Checking on-chain pledge status…
            </p>
          ) : error ? (
            <p className="text-sm text-text-interactive-error">{error}</p>
          ) : hasPledged ? (
            <div className="rounded-lg border border-border-interactive-valid bg-background-interactive-valid/10 p-4">
              <div className="flex items-center gap-2">
                <CheckCircleOutline className="!h-5 !w-5 text-icon-interactive-valid" />
                <p className="primary-text text-sm text-text-interactive-valid">
                  You have pledged
                </p>
              </div>
              {tokenId && (
                <p className="secondary-text mt-2 font-mono text-xs">
                  token_id · {tokenId}
                </p>
              )}
              {mintCount != null && (
                <p className="secondary-text text-xs">mint_count · {mintCount}</p>
              )}
              <p className="secondary-text mt-2 text-xs">
                Chain ownership is source of truth—thank you for standing with
                the team.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border-primary bg-background-primary p-4">
              <p className="primary-text text-sm">Ready when you are</p>
              <p className="secondary-text mt-1 text-sm">
                Not pledged yet. Read the site, then sign with your wallet to
                mint the pledge NFT.
              </p>
            </div>
          )}
        </section>

        {/* CTA row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className={clsx(
              'rounded-md px-5 py-2.5 text-sm font-medium transition-opacity',
              'bg-background-button text-text-button-primary',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
            disabled={
              signDisabled ||
              !connected ||
              !collectionConfigured ||
              hasPledged ||
              loading
            }
            onClick={onSignAndMint}
            type="button"
          >
            {buttonLabel}
          </button>
          <a
            className="link-text inline-flex items-center justify-center gap-1 text-sm"
            href={siteUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Learn more on the website
            <ArrowOutward className="!h-3.5 !w-3.5" />
          </a>
        </div>

        {children}

        {footer && (
          <div className="border-t border-border-secondary pt-4 text-xs text-text-tertiary">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
