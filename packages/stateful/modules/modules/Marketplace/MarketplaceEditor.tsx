import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  AddressInput,
  InputErrorMessage,
  InputLabel,
  NumericInput,
  SwitchCard,
  TextAreaInput,
  TextInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import {
  LAB_HASHMERCHANT_HTTP,
  LAB_MARKETPLACE_MIRROR,
  MESH_STORAGE_KEY,
  makeValidateAddress,
  validatePositive,
} from '@dao-dao/utils'

import { MarketplaceModuleData } from './types'

export const MarketplaceEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<MarketplaceModuleData>) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, setValue, watch } = useFormContext<
    MarketplaceModuleData & Record<string, unknown>
  >()

  const minBuffer = watch(
    (fieldNamePrefix + 'minBufferBlocks') as 'minBufferBlocks'
  )
  const useChainMeshDefault = watch(
    (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault'
  )

  // Contracts are optional individually (fixed XOR auction is enough for enable),
  // but any non-empty value must be a valid bech32 contract address.
  const optionalContract = makeValidateAddress(bech32Prefix, false)

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.marketplaceModuleEditor', {
          defaultValue:
            'Point this DAO at marketplace-mirror (fixed price) and/or auction contracts. Enabling writes mesh.v1.marketplace so frontends discover contracts and the content plane. Money and stock stay on-chain; Nostr is progressive only.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel
          name={t('form.fixedPriceContract', {
            defaultValue: 'Fixed-price contract (marketplace-mirror)',
          })}
          optional
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.fixedPriceContract}
          fieldName={
            (fieldNamePrefix + 'fixedPriceContract') as 'fixedPriceContract'
          }
          placeholder={LAB_MARKETPLACE_MIRROR}
          register={register}
          type="contract"
          validation={[optionalContract]}
        />
        <p className="secondary-text text-xs">
          {t('info.marketplaceFixedPriceLabHint', {
            defaultValue: `Lab 120u-1 community-marketplace: ${LAB_MARKETPLACE_MIRROR}. Content plane / HM ingress: ${LAB_HASHMERCHANT_HTTP} (deploy-host when up).`,
          })}
        </p>
        <InputErrorMessage error={errors?.fixedPriceContract} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.auctionContract', {
            defaultValue: 'Auction contract',
          })}
          optional
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.auctionContract}
          fieldName={(fieldNamePrefix + 'auctionContract') as 'auctionContract'}
          register={register}
          type="contract"
          validation={[optionalContract]}
        />
        <InputErrorMessage error={errors?.auctionContract} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.nftCollections', {
            defaultValue: 'NFT collections (auction catalog)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.nftCollections}
          fieldName={(fieldNamePrefix + 'nftCollections') as 'nftCollections'}
          placeholder="terp1nft…, terp1other…"
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.nftCollectionsHelp', {
            defaultValue:
              'Comma-separated CW721 addresses for auction_by_contract. Without these, the catalog still loads auctions where this DAO is the seller.',
          })}
        </p>
        <InputErrorMessage error={errors?.nftCollections} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.contentBase', {
            defaultValue: 'Content plane base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.contentBase}
          fieldName={(fieldNamePrefix + 'contentBase') as 'contentBase'}
          placeholder={LAB_HASHMERCHANT_HTTP}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.marketplaceContentBaseLabHint', {
            defaultValue: `Lab HM ingress on deploy-host: ${LAB_HASHMERCHANT_HTTP} (soft-fail when G2 down). Production may use public hash.terp.network.`,
          })}
        </p>
        <InputErrorMessage error={errors?.contentBase} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.acceptedDenom', {
            defaultValue: 'Accepted denom',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.acceptedDenom}
          fieldName={(fieldNamePrefix + 'acceptedDenom') as 'acceptedDenom'}
          placeholder="uterp"
          register={register}
        />
        <InputErrorMessage error={errors?.acceptedDenom} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.minBufferBlocks', {
            defaultValue: 'Min buffer blocks (fixed-price escrow)',
          })}
        />
        <NumericInput
          disabled={!isCreating}
          error={errors?.minBufferBlocks}
          fieldName={
            (fieldNamePrefix + 'minBufferBlocks') as 'minBufferBlocks'
          }
          min={1}
          numericValue
          register={register}
          setValue={setValue}
          step={1}
          validation={[validatePositive]}
          watch={watch}
        />
        <p className="secondary-text text-xs">
          {t('info.minBufferBlocksHelp', {
            defaultValue:
              'Default on marketplace-mirror is 7. UI must show escrow honesty until settle_after.',
            count: typeof minBuffer === 'number' ? minBuffer : 7,
          })}
        </p>
        <InputErrorMessage error={errors?.minBufferBlocks} />
      </div>

      <div className="space-y-2">
        <InputLabel name={t('form.description')} optional />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={3}
        />
        <InputErrorMessage error={errors?.description} />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={useChainMeshDefault !== false}
        label={t('form.useChainMeshDefault', {
          defaultValue: 'Use chain headstash mesh defaults',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix +
              'useChainMeshDefault') as 'useChainMeshDefault',
            useChainMeshDefault === false,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
        tooltip={t('info.useChainMeshDefaultTooltip', {
          defaultValue: `When on, resolveMesh falls back to chain headstash/query defaults if DAO storage “${MESH_STORAGE_KEY}” is missing. Enabling still writes mesh.v1 when contracts are set.`,
        })}
      />
    </div>
  )
}
