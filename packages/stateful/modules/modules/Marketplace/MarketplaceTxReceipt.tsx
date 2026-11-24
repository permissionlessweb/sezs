import { ArrowOutwardRounded } from '@mui/icons-material'
import { useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { CopyToClipboard } from '@dao-dao/stateless'
import {
  copyTxLinkToClipboard,
  resolveTxLink,
} from '@dao-dao/utils'

export type MarketplaceTxReceiptProps = {
  chainId: string
  txHash: string
  /** Auto-copy explorer/tx link once when hash first appears (EN-F5). */
  autoCopy?: boolean
  className?: string
}

/**
 * Post-payment TX receipt: explorer link + clipboard copy.
 * Auto-copies the explorer URL (or raw hash) once per hash for external paste.
 */
export const MarketplaceTxReceipt = ({
  chainId,
  txHash,
  autoCopy = true,
  className,
}: MarketplaceTxReceiptProps) => {
  const { t } = useTranslation()
  const copiedFor = useRef<string | null>(null)

  const link = useMemo(
    () => resolveTxLink(chainId, txHash),
    [chainId, txHash]
  )

  useEffect(() => {
    if (!autoCopy || !txHash) return
    if (copiedFor.current === txHash) return
    copiedFor.current = txHash
    void copyTxLinkToClipboard(chainId, txHash).then((r) => {
      if (r.ok) {
        toast.success(
          r.kind === 'url'
            ? t('success.marketplaceTxLinkCopied', {
                defaultValue: 'TX explorer link copied to clipboard.',
              })
            : t('success.marketplaceTxHashCopied', {
                defaultValue: 'TX hash copied to clipboard.',
              })
        )
      }
    })
  }, [autoCopy, chainId, txHash, t])

  return (
    <div className={className ?? 'flex flex-col gap-1.5'}>
      <p className="secondary-text text-[11px]">
        {t('info.marketplaceTxReceipt', {
          defaultValue: 'On-chain transaction',
        })}
      </p>
      <CopyToClipboard
        success={
          link.kind === 'url'
            ? t('success.marketplaceTxLinkCopied', {
                defaultValue: 'TX explorer link copied to clipboard.',
              })
            : t('success.marketplaceTxHashCopied', {
                defaultValue: 'TX hash copied to clipboard.',
              })
        }
        takeAll
        tooltip={t('button.copyToClipboard')}
        value={link.text}
      />
      {link.kind === 'url' ? (
        <a
          className="inline-flex items-center gap-1 text-xs text-text-interactive-valid underline"
          href={link.text}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('button.openInChainExplorer')}
          <ArrowOutwardRounded className="!h-3.5 !w-3.5" />
        </a>
      ) : (
        <p className="break-all font-mono text-[10px] text-text-tertiary">
          tx {txHash}
        </p>
      )}
    </div>
  )
}
