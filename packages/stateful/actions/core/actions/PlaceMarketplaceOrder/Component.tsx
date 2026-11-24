import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  NumericInput,
  SegmentedControlsTitle,
  TextInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ActionComponent } from '@dao-dao/types/actions'
import {
  MARKETPLACE_NOSTR_KINDS,
  makeValidateAddress,
  validatePositive,
  validateRequired,
} from '@dao-dao/utils'

export type PlaceMarketplaceOrderMode =
  | 'purchase'
  | 'bid'
  | 'buy_now'
  | 'settle_auction'
  | 'settle_fixed'
  | 'cancel_fixed'

export type PlaceMarketplaceOrderData = {
  mode: PlaceMarketplaceOrderMode
  /** marketplace-mirror or TerpAuction contract */
  contract: string
  // fixed
  sku: string
  qty: number
  orderId: number
  // auction
  auctionId: string
  /** Micro-denom funds for purchase/bid/buy_now */
  fundsAmount: string
  fundsDenom: string
}

export const PlaceMarketplaceOrderComponent: ActionComponent<
  undefined,
  PlaceMarketplaceOrderData
> = ({ fieldNamePrefix, errors, isCreating }) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, watch, setValue } =
    useFormContext<PlaceMarketplaceOrderData>()

  const mode = watch((fieldNamePrefix + 'mode') as 'mode')

  return (
    <>
      <SegmentedControlsTitle
        className="mb-2"
        editable={isCreating}
        fieldName={(fieldNamePrefix + 'mode') as 'mode'}
        tabs={[
          { label: 'Purchase', value: 'purchase' },
          { label: 'Bid', value: 'bid' },
          { label: 'Buy now', value: 'buy_now' },
          { label: 'Settle auction', value: 'settle_auction' },
          { label: 'Settle fixed', value: 'settle_fixed' },
          { label: 'Cancel fixed', value: 'cancel_fixed' },
        ]}
      />

      <p className="secondary-text mb-2 text-xs">
        {t('info.placeMarketplaceOrderNip', {
          defaultValue:
            'Chain msgs only. NIP-15 kinds {{product}}/{{auction}}/{{bid}} are progressive discovery — never finality.',
          product: MARKETPLACE_NOSTR_KINDS.product,
          auction: MARKETPLACE_NOSTR_KINDS.auctionProduct,
          bid: MARKETPLACE_NOSTR_KINDS.bid,
        })}
      </p>

      <div className="flex flex-col gap-1">
        <InputLabel
          name={t('form.contract', {
            defaultValue: 'Marketplace / auction contract',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.contract}
          fieldName={(fieldNamePrefix + 'contract') as 'contract'}
          register={register}
          validation={[validateRequired, makeValidateAddress(bech32Prefix)]}
        />
        <InputErrorMessage error={errors?.contract} />
      </div>

      {(mode === 'purchase' || mode === 'bid' || mode === 'buy_now') && (
        <>
          {mode === 'purchase' ? (
            <>
              <div className="mt-2 flex flex-col gap-1">
                <InputLabel name="SKU" />
                <TextInput
                  disabled={!isCreating}
                  error={errors?.sku}
                  fieldName={(fieldNamePrefix + 'sku') as 'sku'}
                  register={register}
                  validation={[validateRequired]}
                />
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <InputLabel name="Qty" />
                <NumericInput
                  disabled={!isCreating}
                  error={errors?.qty}
                  fieldName={(fieldNamePrefix + 'qty') as 'qty'}
                  min={1}
                  numericValue
                  register={register}
                  setValue={setValue}
                  validation={[validatePositive]}
                  watch={watch}
                />
              </div>
            </>
          ) : (
            <div className="mt-2 flex flex-col gap-1">
              <InputLabel name="Auction ID" />
              <TextInput
                disabled={!isCreating}
                error={errors?.auctionId}
                fieldName={(fieldNamePrefix + 'auctionId') as 'auctionId'}
                register={register}
                validation={[validateRequired]}
              />
            </div>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <InputLabel name="Funds amount (micro)" />
            <TextInput
              disabled={!isCreating}
              error={errors?.fundsAmount}
              fieldName={(fieldNamePrefix + 'fundsAmount') as 'fundsAmount'}
              register={register}
              validation={[validateRequired]}
            />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <InputLabel name="Funds denom" />
            <TextInput
              disabled={!isCreating}
              error={errors?.fundsDenom}
              fieldName={(fieldNamePrefix + 'fundsDenom') as 'fundsDenom'}
              register={register}
              validation={[validateRequired]}
            />
          </div>
        </>
      )}

      {mode === 'settle_auction' && (
        <div className="mt-2 flex flex-col gap-1">
          <InputLabel name="Auction ID" />
          <TextInput
            disabled={!isCreating}
            error={errors?.auctionId}
            fieldName={(fieldNamePrefix + 'auctionId') as 'auctionId'}
            register={register}
            validation={[validateRequired]}
          />
        </div>
      )}

      {(mode === 'settle_fixed' || mode === 'cancel_fixed') && (
        <div className="mt-2 flex flex-col gap-1">
          <InputLabel name="Order ID" />
          <NumericInput
            disabled={!isCreating}
            error={errors?.orderId}
            fieldName={(fieldNamePrefix + 'orderId') as 'orderId'}
            min={1}
            numericValue
            register={register}
            setValue={setValue}
            validation={[validatePositive]}
            watch={watch}
          />
        </div>
      )}
    </>
  )
}
