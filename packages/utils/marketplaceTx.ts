/**
 * Marketplace payment TX helpers — explorer link + clipboard copy (EN-F5).
 * Pure URL build is testable; clipboard needs browser navigator.
 */

import { getSupportedChainConfig } from './chain'

/** Build chain explorer TX URL, or null if the chain has no template. */
export const getExplorerTxUrl = (
  chainId: string,
  txHash: string
): string | null => {
  if (!chainId || !txHash) return null
  const template = getSupportedChainConfig(chainId)?.explorerUrlTemplates?.tx
  if (!template) return null
  return template.replace('REPLACE', txHash)
}

/**
 * Prefer explorer URL for external paste; fall back to raw hash.
 * Returns the string that should be shown / copied.
 */
export const resolveTxLink = (
  chainId: string,
  txHash: string
): { text: string; kind: 'url' | 'hash' } => {
  const url = getExplorerTxUrl(chainId, txHash)
  if (url) return { text: url, kind: 'url' }
  return { text: txHash, kind: 'hash' }
}

/**
 * Copy explorer TX link (or hash) to the clipboard.
 * Safe no-op when clipboard API is missing (SSR / restricted iframe).
 */
export const copyTxLinkToClipboard = async (
  chainId: string,
  txHash: string
): Promise<{ text: string; kind: 'url' | 'hash'; ok: boolean }> => {
  const resolved = resolveTxLink(chainId, txHash)
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(resolved.text)
      return { ...resolved, ok: true }
    }
  } catch {
    /* permission / insecure context */
  }
  return { ...resolved, ok: false }
}
