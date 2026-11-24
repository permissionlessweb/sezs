import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { HugeDecimal } from '@dao-dao/math'
import {
  cwShitstrapExtraQueries,
  cwShitstrapFactoriesExtraQuery,
} from '@dao-dao/state/query'
import {
  AddressInput,
  InputErrorMessage,
  InputLabel,
  Loader,
  NumericInput,
  SegmentedControls,
  useActionOptions,
} from '@dao-dao/stateless'
import { ActionComponent, ActionContextType, ChainId } from '@dao-dao/types'
import {
  SvgMintPaymentPath,
  buildCompatibleStraps,
  computeSvgMintPaymentPlan,
  getNativeTokenForChainId,
  makeValidateAddress,
  validateRequired,
} from '@dao-dao/utils'

import { useTokenBalances } from '../../../hooks'
import { MintSvgWithShitstrapData } from './types'

const TERP_SHITSTRAP_FACTORY =
  'terp1cdd3w85507gaw6ljrkqy2urx4u0fwjfgyj6jgahnq0c4wlwmr57selwx65'

/**
 * UI for 1-click SVG mint via wallet THIOL and/or shitstrap deposit+swap.
 */
export const MintSvgWithShitstrapComponent: ActionComponent = ({
  fieldNamePrefix,
  errors,
  isCreating,
}) => {
  const { t } = useTranslation()
  const { chain, context, queryClient } = useActionOptions()
  const { watch, setValue, register, getValues } =
    useFormContext<MintSvgWithShitstrapData>()

  const chainId =
    watch((fieldNamePrefix + 'chainId') as 'chainId') || chain.chainId
  const quantity = Number(
    watch((fieldNamePrefix + 'quantity') as 'quantity') || 1
  )
  const pricePerToken =
    watch((fieldNamePrefix + 'pricePerToken') as 'pricePerToken') || '0'
  const mintDenom =
    watch((fieldNamePrefix + 'mintDenom') as 'mintDenom') ||
    getNativeTokenForChainId(chainId).denomOrAddress
  const path = (watch((fieldNamePrefix + 'path') as 'path') ||
    'wallet') as SvgMintPaymentPath

  const tokens = useTokenBalances()

  // List shitstraps from default Terp factory (wallet + DAO).
  const factoryQuery = useQuery({
    ...cwShitstrapFactoriesExtraQuery.listAllShitstrapContracts(queryClient, {
      chainId,
      address: TERP_SHITSTRAP_FACTORY,
    }),
    enabled: chainId === ChainId.TerpMainnet && isCreating,
  })

  // Fetch info for first few straps to build payment plan.
  const strapContracts = useMemo(() => {
    const list = factoryQuery.data?.contracts || []
    return list.slice(0, 20).map((c: { contract: string }) => c.contract)
  }, [factoryQuery.data])

  const strapInfos = useQuery({
    queryKey: ['mintSvgShitstrap', 'infos', chainId, strapContracts],
    enabled: strapContracts.length > 0 && isCreating,
    queryFn: async () => {
      const infos = await Promise.all(
        strapContracts.map((contractAddress: string) =>
          queryClient
            .fetchQuery(
              cwShitstrapExtraQueries.info(queryClient, {
                chainId,
                contractAddress,
              })
            )
            .catch(() => null)
        )
      )
      return infos.filter(Boolean)
    },
  })

  const balancesMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (!tokens.loading) {
      for (const row of tokens.data) {
        if (row.token.chainId === chainId) {
          map[row.token.denomOrAddress] = row.balance
        }
      }
    }
    return map
  }, [tokens, chainId])

  const plan = useMemo(() => {
    const straps = buildCompatibleStraps({
      mintDenom,
      balances: balancesMap,
      straps: (strapInfos.data || []).map((info: any) => ({
        contract: info.shitstrapContractAddr || info.contractAddress || '',
        accepted: (info.possibleShit || info.accepted || []).map((p: any) => ({
          shit_rate: p.shit_rate,
          token:
            typeof p.token === 'string'
              ? p.token
              : p.token?.denomOrAddress
                ? { native: p.token.denomOrAddress }
                : p.token,
        })),
        toShit: info.cutoff || info.toShit || '0',
      })),
    })

    return computeSvgMintPaymentPlan({
      quantity: Math.max(1, quantity),
      pricePerToken,
      walletMintDenomBalance: balancesMap[mintDenom] || '0',
      mintDenom,
      straps,
      feeWaived: path === 'whitelist',
      atomicSupported: true,
    })
  }, [
    strapInfos.data,
    balancesMap,
    mintDenom,
    quantity,
    pricePerToken,
    path,
  ])

  // Sync form fields when path / plan changes.
  useEffect(() => {
    if (!isCreating) {
      return
    }
    const preferred =
      path === 'whitelist'
        ? 'whitelist'
        : plan.canAtomicMint
          ? 'atomic'
          : plan.preferredPath

    if (path !== preferred && path === 'wallet' && plan.canAtomicMint) {
      // Don't force if user already picked; only auto-suggest atomic default once.
    }

    if (plan.canAtomicMint && plan.steps[0] && path === 'atomic') {
      setValue(
        (fieldNamePrefix + 'shitstrapAddress') as 'shitstrapAddress',
        plan.steps[0].contract
      )
      setValue(
        (fieldNamePrefix + 'slopDenom') as 'slopDenom',
        plan.steps[0].slopDenom
      )
      setValue(
        (fieldNamePrefix + 'slopAmount') as 'slopAmount',
        plan.steps[0].slopAmount
      )
    }
    if (path === 'legacy' && plan.steps[0]) {
      setValue(
        (fieldNamePrefix + 'shitstrapAddress') as 'shitstrapAddress',
        plan.steps[0].contract
      )
      setValue(
        (fieldNamePrefix + 'slopDenom') as 'slopDenom',
        plan.steps[0].slopDenom
      )
      setValue(
        (fieldNamePrefix + 'slopAmount') as 'slopAmount',
        plan.steps[0].slopAmount
      )
    }
  }, [plan, path, isCreating, fieldNamePrefix, setValue])

  const pathTabs: { label: string; value: SvgMintPaymentPath }[] = [
    { label: 'Wallet', value: 'wallet' },
    {
      label: plan.canAtomicMint ? '1-click atomic' : 'Atomic (N/A)',
      value: 'atomic',
    },
    { label: 'Shitstrap + mint', value: 'legacy' },
    { label: 'Whitelist', value: 'whitelist' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.mintSvgWithShitstrapDescription', {
          defaultValue:
            'Mint SVG NFTs with wallet funds or a 1-click shitstrap deposit+swap. Atomic path executes shit_strap_and_mint in a single message.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel
          name={t('form.collectionAddress', {
            defaultValue: 'SVG collection',
          })}
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.collectionAddress}
          fieldName={
            (fieldNamePrefix + 'collectionAddress') as 'collectionAddress'
          }
          register={register}
          type="contract"
          validation={[
            validateRequired,
            makeValidateAddress(chain.bech32Prefix),
          ]}
        />
        <InputErrorMessage error={errors?.collectionAddress} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <InputLabel name={t('form.quantity', { defaultValue: 'Quantity' })} />
          <NumericInput
            disabled={!isCreating}
            error={errors?.quantity}
            fieldName={(fieldNamePrefix + 'quantity') as 'quantity'}
            getValues={getValues}
            min={1}
            register={register}
            setValue={setValue}
            sizing="fill"
            step={1}
            validation={[validateRequired]}
          />
        </div>
        <div className="space-y-2">
          <InputLabel
            name={t('form.pricePerToken', {
              defaultValue: 'Price per token (base units)',
            })}
          />
          <NumericInput
            disabled={!isCreating}
            error={errors?.pricePerToken}
            fieldName={(fieldNamePrefix + 'pricePerToken') as 'pricePerToken'}
            getValues={getValues}
            min={0}
            register={register}
            setValue={setValue}
            sizing="fill"
            validation={[validateRequired]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.paymentPath', { defaultValue: 'Payment path' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue((fieldNamePrefix + 'path') as 'path', value, {
              shouldValidate: true,
            })
          }
          selected={path}
          tabs={pathTabs}
        />
      </div>

      {(factoryQuery.isLoading || strapInfos.isLoading) && isCreating && (
        <Loader fill={false} size={24} />
      )}

      <div className="rounded-md bg-background-tertiary p-3 text-sm">
        <p className="primary-text mb-1">
          {t('title.paymentPlan', { defaultValue: 'Payment plan' })}
        </p>
        <ul className="secondary-text list-disc space-y-1 pl-4 text-xs">
          <li>
            Total mint denom:{' '}
            {HugeDecimal.from(plan.totalMintDenom).toFormattedString({
              decimals: 0,
            })}{' '}
            {mintDenom}
          </li>
          <li>
            From wallet:{' '}
            {HugeDecimal.from(plan.mintDenomFromWallet).toFormattedString({
              decimals: 0,
            })}
          </li>
          <li>Shitstrap steps: {plan.steps.length}</li>
          <li>
            Can afford: {plan.canAfford ? 'yes' : 'no'}
            {plan.canAtomicMint ? ' · atomic ready' : ''}
          </li>
        </ul>
        {plan.steps.length > 0 && (
          <div className="mt-2 space-y-1">
            {plan.steps.map((s, i) => (
              <p key={i} className="font-mono text-xs break-all">
                {s.slopAmount} {s.slopDenom} → {s.uthiolOut} via{' '}
                {s.contract.slice(0, 12)}…
              </p>
            ))}
          </div>
        )}
      </div>

      {(path === 'atomic' || path === 'legacy') && (
        <div className="space-y-2">
          <InputLabel
            name={t('form.shitstrapAddress', {
              defaultValue: 'Shitstrap contract',
            })}
          />
          <AddressInput
            disabled={!isCreating}
            error={errors?.shitstrapAddress}
            fieldName={
              (fieldNamePrefix + 'shitstrapAddress') as 'shitstrapAddress'
            }
            register={register}
            type="contract"
            validation={[makeValidateAddress(chain.bech32Prefix)]}
          />
        </div>
      )}

      {context.type === ActionContextType.Dao && (
        <p className="secondary-text text-xs">
          {t('info.daoProposalWillEncode', {
            defaultValue:
              'This action encodes into the proposal for wallet or DAO execution — same polytone-ready path as other modules.',
          })}
        </p>
      )}
    </div>
  )
}
