/**
 * Client-side BTC deposit re-verify (D4 honesty — Tacit-style "hint then re-check").
 *
 * Observations from hash-market are coordination only. Before advancing production
 * automation, optionally re-fetch UTXOs via Esplora multi-fallback.
 */

export type FundingCheck = {
  txid: string
  amount_sats: number
  confirmations: number
}

export type ReverifyResult =
  | { ok: true; funding: FundingCheck; esploraBase: string }
  | { ok: false; error: string }

/** Tacit-ordered Esplora bases by network. */
export const defaultEsploraUrls = (
  network: 'mainnet' | 'testnet' | 'signet' = 'mainnet'
): string[] => {
  switch (network) {
    case 'testnet':
      return [
        'https://mempool.space/testnet/api',
        'https://blockstream.info/testnet/api',
      ]
    case 'signet':
      return [
        'https://mempool.space/signet/api',
        'https://blockstream.info/signet/api',
      ]
    default:
      return [
        'https://mempool.space/api',
        'https://btcscan.org/api',
        'https://blockstream.info/api',
      ]
  }
}

type EsploraUtxo = {
  txid: string
  value: number
  status: { confirmed: boolean; block_height?: number }
}

/**
 * Confirm observation still appears on-chain via Esplora.
 * Does not advance mint — caller decides.
 */
export const reverifyDepositObservation = async (args: {
  address: string
  txid: string
  minAmountSats?: number
  minConfirmations?: number
  esploraUrls?: string[]
  network?: 'mainnet' | 'testnet' | 'signet'
}): Promise<ReverifyResult> => {
  const bases =
    args.esploraUrls?.length
      ? args.esploraUrls
      : defaultEsploraUrls(args.network ?? 'mainnet')
  const minAmt = args.minAmountSats ?? 0
  const minConf = args.minConfirmations ?? 1
  let lastErr = 'all esplora bases failed'

  for (const base of bases) {
    const b = base.replace(/\/$/, '')
    try {
      const tipRes = await fetch(`${b}/blocks/tip/height`)
      if (!tipRes.ok) {
        lastErr = `tip ${tipRes.status} @ ${b}`
        continue
      }
      const tip = parseInt(await tipRes.text(), 10) || 0
      const utxoRes = await fetch(`${b}/address/${encodeURIComponent(args.address)}/utxo`)
      if (utxoRes.status === 429 || utxoRes.status >= 500) {
        lastErr = `utxo ${utxoRes.status} @ ${b}`
        continue
      }
      if (!utxoRes.ok) {
        lastErr = `utxo ${utxoRes.status} @ ${b}`
        continue
      }
      const utxos = (await utxoRes.json()) as EsploraUtxo[]
      const hit = utxos.find(
        (u) => u.txid.toLowerCase() === args.txid.toLowerCase()
      )
      if (!hit) {
        lastErr = `txid not on address @ ${b}`
        continue
      }
      const confs = hit.status.confirmed
        ? hit.status.block_height != null
          ? Math.max(0, tip - hit.status.block_height + 1)
          : 1
        : 0
      if (hit.value < minAmt) {
        return {
          ok: false,
          error: `amount ${hit.value} < min ${minAmt}`,
        }
      }
      if (confs < minConf) {
        return {
          ok: false,
          error: `confs ${confs} < min ${minConf}`,
        }
      }
      return {
        ok: true,
        funding: {
          txid: hit.txid,
          amount_sats: hit.value,
          confirmations: confs,
        },
        esploraBase: b,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, error: lastErr }
}
