import { ActionBase, MoneyWingsEmoji } from '@dao-dao/stateless'
import { UnifiedCosmosMsg } from '@dao-dao/types'
import {
  ActionKey,
  ActionMatch,
  ActionOptions,
  ProcessedMessage,
} from '@dao-dao/types/actions'
import {
  getNativeTokenForChainId,
  objectMatchesStructure,
} from '@dao-dao/utils'

import { MintSvgWithShitstrapComponent } from './Component'
import { encodeMintSvgWithShitstrap } from './encode'
import { MintSvgWithShitstrapData } from './types'

export class MintSvgWithShitstrapAction extends ActionBase<MintSvgWithShitstrapData> {
  public readonly key = ActionKey.MintSvgWithShitstrap
  public readonly Component = MintSvgWithShitstrapComponent

  constructor(options: ActionOptions) {
    super(options, {
      Icon: MoneyWingsEmoji,
      label: options.t('title.mintSvgWithShitstrap', {
        defaultValue: 'Mint SVG (wallet / shitstrap)',
      }),
      description: options.t('info.mintSvgWithShitstrapDescription', {
        defaultValue:
          '1-click SVG mint with wallet funds or shitstrap deposit+swap (atomic or multi-msg).',
      }),
    })

    const mintDenom = getNativeTokenForChainId(
      options.chain.chainId
    ).denomOrAddress

    this.defaults = {
      chainId: options.chain.chainId,
      collectionAddress: '',
      mintContract: '',
      quantity: 1,
      pricePerToken: '0',
      mintDenom,
      path: 'wallet',
      shitstrapAddress: '',
      slopDenom: '',
      slopAmount: '',
      proofHashes: [],
      allocation: null,
    }
  }

  encode(data: MintSvgWithShitstrapData): UnifiedCosmosMsg | UnifiedCosmosMsg[] {
    return encodeMintSvgWithShitstrap(this.options, data)
  }

  match(messages: ProcessedMessage[]): ActionMatch {
    if (!messages.length) {
      return false
    }

    const first = messages[0].decodedMessage

    // Atomic
    if (
      objectMatchesStructure(first, {
        wasm: {
          execute: {
            contract_addr: {},
            funds: {},
            msg: {
              shit_strap_and_mint: {
                shit: {},
              },
            },
          },
        },
      })
    ) {
      return 1
    }

    // Legacy: shit_strap then mint
    if (
      messages.length >= 2 &&
      objectMatchesStructure(first, {
        wasm: {
          execute: {
            msg: {
              shit_strap: {
                shit: {},
              },
            },
          },
        },
      }) &&
      objectMatchesStructure(messages[1].decodedMessage, {
        wasm: {
          execute: {
            msg: {
              mint: {},
            },
          },
        },
      })
    ) {
      return 2
    }

    // Wallet / whitelist mint with amount field (SVG shape)
    if (
      objectMatchesStructure(first, {
        wasm: {
          execute: {
            msg: {
              mint: {
                amount: {},
              },
            },
          },
        },
      })
    ) {
      return 1
    }

    return false
  }

  decode(messages: ProcessedMessage[]): MintSvgWithShitstrapData {
    const { chainId } = messages[0].account
    const first = messages[0].decodedMessage
    const mintDenom = getNativeTokenForChainId(chainId).denomOrAddress

    // Atomic
    if (first.wasm?.execute?.msg?.shit_strap_and_mint) {
      const m = first.wasm.execute.msg.shit_strap_and_mint
      const shit = m.shit
      const slopDenom =
        shit?.denom?.native ||
        (typeof shit?.denom === 'string' ? shit.denom : '')
      return {
        chainId,
        collectionAddress: '',
        quantity: 1,
        pricePerToken: '0',
        mintDenom,
        path: 'atomic',
        shitstrapAddress: first.wasm.execute.contract_addr,
        slopDenom,
        slopAmount: shit?.amount || '0',
        proofHashes: m.proof_hashes || [],
      }
    }

    // Legacy multi
    if (
      messages.length >= 2 &&
      first.wasm?.execute?.msg?.shit_strap &&
      messages[1].decodedMessage.wasm?.execute?.msg?.mint
    ) {
      const shit = first.wasm.execute.msg.shit_strap.shit
      const mint = messages[1].decodedMessage.wasm.execute.msg.mint
      const funds = messages[1].decodedMessage.wasm.execute.funds || []
      return {
        chainId,
        collectionAddress:
          messages[1].decodedMessage.wasm.execute.contract_addr,
        quantity: Number(mint.amount || 1),
        pricePerToken: funds[0]
          ? (
              BigInt(funds[0].amount) / BigInt(Math.max(1, Number(mint.amount || 1)))
            ).toString()
          : '0',
        mintDenom: funds[0]?.denom || mintDenom,
        path: 'legacy',
        shitstrapAddress: first.wasm.execute.contract_addr,
        slopDenom: shit?.denom?.native || '',
        slopAmount: shit?.amount || '0',
        proofHashes: mint.proof_hashes || [],
        allocation: mint.allocation ?? null,
      }
    }

    // Direct mint
    const mint = first.wasm.execute.msg.mint
    const funds = first.wasm.execute.funds || []
    const qty = Number(mint.amount || 1)
    return {
      chainId,
      collectionAddress: first.wasm.execute.contract_addr,
      quantity: qty,
      pricePerToken: funds[0]
        ? (BigInt(funds[0].amount) / BigInt(Math.max(1, qty))).toString()
        : '0',
      mintDenom: funds[0]?.denom || mintDenom,
      path: funds.length === 0 ? 'whitelist' : 'wallet',
      proofHashes: mint.proof_hashes || [],
      allocation: mint.allocation ?? null,
    }
  }
}
