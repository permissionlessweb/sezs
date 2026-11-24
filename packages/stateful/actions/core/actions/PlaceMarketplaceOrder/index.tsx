import { ActionBase, MoneyEmoji } from '@dao-dao/stateless'
import { ModuleId, UnifiedCosmosMsg } from '@dao-dao/types'
import {
  ActionContextType,
  ActionKey,
  ActionMatch,
  ActionOptions,
  ProcessedMessage,
} from '@dao-dao/types/actions'
import {
  buildCancelFixedMsg,
  buildPlaceBidMsg,
  buildPurchaseMsg,
  buildSettleAuctionMsg,
  buildSettleFixedMsg,
  getChainAddressForActionOptions,
  makeExecuteSmartContractMessage,
  objectMatchesStructure,
  placeBidMsgStructure,
} from '@dao-dao/utils'

import {
  PlaceMarketplaceOrderComponent,
  PlaceMarketplaceOrderData,
} from './Component'

/**
 * Proposal-safe marketplace orders: fixed purchase/settle/cancel + auction bid/settle.
 * NIP-15 bid kinds are not encoded here — chain only (wallet/proposal).
 */
export class PlaceMarketplaceOrderAction extends ActionBase<PlaceMarketplaceOrderData> {
  public readonly key = ActionKey.PlaceMarketplaceOrder
  public readonly Component = PlaceMarketplaceOrderComponent

  constructor(options: ActionOptions) {
    super(options, {
      Icon: MoneyEmoji,
      label: options.t('title.placeMarketplaceOrder', {
        defaultValue: 'Marketplace order',
      }),
      description: options.t('info.placeMarketplaceOrderDescription', {
        defaultValue:
          'Purchase fixed inventory, place auction bids / buy-now, or settle. Chain is final; Nostr NIP-15 is progressive only.',
      }),
      keywords: [
        'marketplace',
        'auction',
        'bid',
        'buy_now',
        'purchase',
        'nip-15',
        'place_bid',
      ],
    })

    let contract = ''
    if (options.context.type === ActionContextType.Dao) {
      try {
        const mod = options.context.dao.getModule<{
          fixedPriceContract?: string
          auctionContract?: string
        }>(ModuleId.Marketplace)
        contract =
          mod?.values?.fixedPriceContract ||
          mod?.values?.auctionContract ||
          ''
      } catch {
        /* not enabled */
      }
    }

    this.defaults = {
      mode: 'purchase',
      contract,
      sku: '',
      qty: 1,
      orderId: 1,
      auctionId: '1',
      fundsAmount: '0',
      fundsDenom: 'uterp',
    }
  }

  encode(data: PlaceMarketplaceOrderData): UnifiedCosmosMsg[] {
    const chainId = this.options.chain.chainId
    const sender =
      getChainAddressForActionOptions(this.options, chainId) ||
      this.options.address
    if (!data.contract) {
      throw new Error('Contract address is required')
    }

    let msg: Record<string, unknown>
    let funds:
      | {
          denom: string
          amount: string
        }[]
      | undefined

    switch (data.mode) {
      case 'purchase':
        msg = buildPurchaseMsg(data.sku, Number(data.qty))
        funds = [{ denom: data.fundsDenom, amount: data.fundsAmount }]
        break
      case 'bid':
      case 'buy_now':
        msg = buildPlaceBidMsg(data.auctionId)
        funds = [{ denom: data.fundsDenom, amount: data.fundsAmount }]
        break
      case 'settle_auction':
        msg = buildSettleAuctionMsg(data.auctionId)
        break
      case 'settle_fixed':
        msg = buildSettleFixedMsg(Number(data.orderId))
        break
      case 'cancel_fixed':
        msg = buildCancelFixedMsg(Number(data.orderId))
        break
      default:
        throw new Error(`Unknown mode ${data.mode}`)
    }

    return [
      makeExecuteSmartContractMessage({
        chainId,
        sender,
        contractAddress: data.contract,
        msg,
        funds,
      }),
    ]
  }

  match([{ decodedMessage }]: ProcessedMessage[]): ActionMatch {
    return (
      objectMatchesStructure(decodedMessage, {
        wasm: {
          execute: {
            contract_addr: {},
            msg: {
              purchase: {},
            },
          },
        },
      }) ||
      objectMatchesStructure(decodedMessage, {
        wasm: {
          execute: {
            contract_addr: {},
            msg: placeBidMsgStructure,
          },
        },
      }) ||
      objectMatchesStructure(decodedMessage, {
        wasm: {
          execute: {
            contract_addr: {},
            msg: {
              settle: {},
            },
          },
        },
      }) ||
      objectMatchesStructure(decodedMessage, {
        wasm: {
          execute: {
            contract_addr: {},
            msg: {
              cancel: {},
            },
          },
        },
      })
    )
  }

  decode([{ decodedMessage }]: ProcessedMessage[]): PlaceMarketplaceOrderData {
    const contract = decodedMessage.wasm.execute.contract_addr as string
    const msg = decodedMessage.wasm.execute.msg as Record<string, any>
    const funds = (decodedMessage.wasm.execute.funds || []) as {
      denom: string
      amount: string
    }[]

    if (msg.purchase) {
      return {
        ...this.defaults,
        mode: 'purchase',
        contract,
        sku: msg.purchase.sku || '',
        qty: msg.purchase.qty || 1,
        fundsAmount: funds[0]?.amount || '0',
        fundsDenom: funds[0]?.denom || 'uterp',
      }
    }
    if (msg.place_bid) {
      return {
        ...this.defaults,
        mode: 'bid',
        contract,
        auctionId: String(msg.place_bid.auction_id ?? ''),
        fundsAmount: funds[0]?.amount || '0',
        fundsDenom: funds[0]?.denom || 'uterp',
      }
    }
    if (msg.settle?.auction_id != null) {
      return {
        ...this.defaults,
        mode: 'settle_auction',
        contract,
        auctionId: String(msg.settle.auction_id),
      }
    }
    if (msg.settle?.order_id != null) {
      return {
        ...this.defaults,
        mode: 'settle_fixed',
        contract,
        orderId: Number(msg.settle.order_id),
      }
    }
    if (msg.cancel) {
      return {
        ...this.defaults,
        mode: 'cancel_fixed',
        contract,
        orderId: Number(msg.cancel.order_id),
      }
    }
    return { ...this.defaults, contract }
  }
}
