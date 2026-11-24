import { ContentCopy } from '@mui/icons-material'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { HugeDecimal } from '@dao-dao/math'
import { chainQueries } from '@dao-dao/state/query'
import { Button, TokenDepositModal } from '@dao-dao/stateless'
import { GenericToken, TokenType } from '@dao-dao/types'
import { CHAIN_GAS_MULTIPLIER, processError } from '@dao-dao/utils'

import { useWallet } from '../../../../hooks/useWallet'
import { FOUNDATION_RELAYER_GROUPS } from '../constants'
import { FoundationRelayerAccount } from '../types'
import { shortAddress } from '../utils'

const buildToken = (acct: FoundationRelayerAccount): GenericToken => ({
  chainId: acct.chainId,
  type: TokenType.Native,
  denomOrAddress: acct.denom,
  symbol: acct.symbol,
  decimals: acct.decimals,
  imageUrl: undefined,
  source: {
    chainId: acct.chainId,
    type: TokenType.Native,
    denomOrAddress: acct.denom,
  },
})

const RelayerCard = ({
  acct,
  balance,
  balanceLoading,
  onFund,
}: {
  acct: FoundationRelayerAccount
  balance?: string
  balanceLoading: boolean
  onFund: (acct: FoundationRelayerAccount) => void
}) => {
  const { t } = useTranslation()
  const low =
    balance !== undefined &&
    BigInt(acct.minSuggested || '0') > 0n &&
    BigInt(balance || '0') < BigInt(acct.minSuggested)

  const display =
    balance === undefined
      ? '—'
      : HugeDecimal.from(balance).toHumanReadableString(acct.decimals)

  return (
    <div
      className={`flex min-w-[11rem] max-w-[14rem] flex-col gap-1.5 rounded-md border p-3 ${
        low ? 'border-border-interactive-warning' : 'border-border-primary'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="primary-text text-sm capitalize">{acct.chainKey}</p>
        {low ? (
          <span className="text-[10px] uppercase text-text-interactive-warning-body">
            low
          </span>
        ) : null}
      </div>
      <p className="font-mono text-lg text-text-body">
        {balanceLoading ? '…' : display}
        <span className="ml-1 text-xs text-text-tertiary">{acct.symbol}</span>
      </p>
      <button
        className="flex items-center gap-1 text-left font-mono text-[11px] text-text-tertiary hover:text-text-secondary"
        onClick={() => {
          void navigator.clipboard.writeText(acct.address)
          toast.success(t('info.copiedToClipboard'))
        }}
        type="button"
      >
        {shortAddress(acct.address)}
        <ContentCopy className="!h-3 !w-3" />
      </button>
      <p className="text-[11px] text-text-tertiary">
        {t('info.suggestedDeposit', {
          defaultValue: 'Suggested: {{amount}}',
          amount: acct.recommendedDisplay,
        })}
      </p>
      <Button
        className="mt-1"
        onClick={() => onFund(acct)}
        size="sm"
        variant="secondary"
      >
        {t('button.deposit')}
      </Button>
    </div>
  )
}

export const RelayerFundPanel = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const accounts = FOUNDATION_RELAYER_GROUPS.flatMap((g) => g.accounts)

  const balanceQueries = useQueries({
    queries: accounts.map((acct) => ({
      ...chainQueries.balance({
        chainId: acct.chainId,
        address: acct.address,
        denom: acct.denom,
      }),
      staleTime: 30_000,
    })),
  })

  const [funding, setFunding] = useState<FoundationRelayerAccount>()
  const [amount, setAmount] = useState(HugeDecimal.zero)
  const [submitting, setSubmitting] = useState(false)

  const fundChainId = funding?.chainId
  const {
    address: walletAddress,
    isWalletConnected,
    getSigningStargateClient,
    connect,
    refreshBalances,
  } = useWallet({
    chainId: fundChainId,
    attemptConnection: !!fundChainId,
  })

  const openFund = useCallback((acct: FoundationRelayerAccount) => {
    setFunding(acct)
    // Prefer min suggested micro amount as default deposit.
    setAmount(HugeDecimal.from(acct.minSuggested || '0'))
  }, [])

  const closeFund = useCallback(() => {
    setFunding(undefined)
    setAmount(HugeDecimal.zero)
  }, [])

  const onDeposit = useCallback(
    async (depositAmount: HugeDecimal) => {
      if (!funding || !walletAddress) {
        toast.error(t('error.logInToContinue'))
        return
      }
      if (!depositAmount.isPositive()) {
        return
      }

      setSubmitting(true)
      try {
        const client = await getSigningStargateClient()
        await client.sendTokens(
          walletAddress,
          funding.address,
          depositAmount.toCoins(funding.denom),
          CHAIN_GAS_MULTIPLIER,
          'terp foundation relayer gas'
        )
        toast.success(
          t('success.relayerFunded', {
            defaultValue: 'Relayer deposit submitted',
          })
        )
        refreshBalances()
        await queryClient.invalidateQueries({
          queryKey: ['chain', 'balance'],
        })
        closeFund()
      } catch (err) {
        console.error(err)
        toast.error(processError(err))
      } finally {
        setSubmitting(false)
      }
    },
    [
      funding,
      walletAddress,
      getSigningStargateClient,
      queryClient,
      closeFund,
      refreshBalances,
      t,
    ]
  )

  const group = FOUNDATION_RELAYER_GROUPS[0]
  const fundToken = funding ? buildToken(funding) : undefined

  const walletBal = useQuery({
    ...chainQueries.balance({
      chainId: funding?.chainId || '',
      address: walletAddress || '',
      denom: funding?.denom || '',
    }),
    enabled: !!funding && !!walletAddress,
    staleTime: 15_000,
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="primary-text">{group?.label}</p>
        <p className="secondary-text mt-1 text-sm">{group?.note}</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {accounts.map((acct, i) => {
          const q = balanceQueries[i]
          return (
            <RelayerCard
              key={`${acct.chainId}-${acct.address}`}
              acct={acct}
              balance={q?.data?.amount}
              balanceLoading={!!q?.isLoading}
              onFund={openFund}
            />
          )
        })}
      </div>

      {funding && fundToken ? (
        <TokenDepositModal
          ConnectWallet={() => (
            <Button onClick={() => connect()} variant="primary">
              {t('button.connectWallet')}
            </Button>
          )}
          amount={amount}
          connected={isWalletConnected}
          loading={submitting}
          loadingBalance={
            !walletAddress || walletBal.isLoading
              ? { loading: true }
              : {
                  loading: false,
                  data: {
                    amount: HugeDecimal.from(
                      walletBal.data?.amount || '0'
                    ).toHumanReadableNumber(funding.decimals),
                    timestamp: Date.now(),
                  },
                }
          }
          onClose={closeFund}
          onDeposit={onDeposit}
          setAmount={setAmount}
          subtitle={
            <span className="secondary-text text-sm">
              {t('info.fundRelayerSubtitle', {
                defaultValue:
                  'Send gas to the foundation relayer on {{chain}} so public IBC stays online.',
                chain: funding.chainKey,
              })}
              <br />
              <span className="font-mono text-xs">{funding.address}</span>
            </span>
          }
          token={fundToken}
          visible
          warning={
            funding.note ||
            t('info.fundRelayerWarning', {
              defaultValue:
                'Deposits go to a public relayer gas wallet, not a DAO treasury.',
            })
          }
        />
      ) : null}
    </div>
  )
}
