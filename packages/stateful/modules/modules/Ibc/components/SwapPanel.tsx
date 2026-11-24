import { useTranslation } from 'react-i18next'

/**
 * Swap entry — full Skip/PFM path lives in the Spend action.
 * This tab documents the high-value entry points until a dedicated swap UI lands.
 */
export const SwapPanel = () => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
      <p className="primary-text">
        {t('title.ibcSwap', { defaultValue: 'IBC swap / transfer' })}
      </p>
      <p className="secondary-text text-sm">
        {t('info.ibcSwapStub', {
          defaultValue:
            'Cross-chain spends and Skip routes are available from proposal actions (Spend with destination chain) and wallet transfer flows. A dedicated swap form (quote → MsgTransfer / PFM memo) will plug in here next — same encode heuristics as Spend so DAO proposals and wallet txs stay consistent.',
        })}
      </p>
      <ul className="secondary-text list-inside list-disc text-sm">
        <li>
          {t('info.ibcSwapSpend', {
            defaultValue:
              'DAO treasury: create a proposal → Spend → pick destination chain (IBC).',
          })}
        </li>
        <li>
          {t('info.ibcSwapWallet', {
            defaultValue:
              'Wallet: use chain picker + transfer on supported assets; routes use curated Terp IBC channels.',
          })}
        </li>
        <li>
          {t('info.ibcSwapChannels', {
            defaultValue:
              'Channels tab lists preferred transfer paths from terp-state.',
          })}
        </li>
      </ul>
    </div>
  )
}
