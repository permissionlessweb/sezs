import { UnifiedCosmosMsg } from '@dao-dao/types'
import { ActionOptions } from '@dao-dao/types/actions'
import {
  getChainAddressForActionOptions,
  makeExecuteSmartContractMessage,
  maybeMakePolytoneExecuteMessages,
} from '@dao-dao/utils'

import { MintSvgWithShitstrapData } from './types'

/**
 * Encode 1-click SVG mint messages:
 * - whitelist / wallet: mint on collection (optional funds)
 * - atomic: shit_strap_and_mint on strap contract
 * - legacy: shit_strap on strap(s) then mint with mint-denom funds
 *
 * Pass either ActionOptions (proposal/action builder) or explicit sender.
 */
export const encodeMintSvgWithShitstrap = (
  optionsOrSender: ActionOptions | { sender: string; srcChainId?: string },
  data: MintSvgWithShitstrapData
): UnifiedCosmosMsg[] => {
  const {
    chainId,
    collectionAddress,
    mintContract,
    quantity,
    pricePerToken,
    mintDenom,
    path,
    shitstrapAddress,
    slopDenom,
    slopAmount,
    proofHashes,
    allocation,
  } = data

  if (!collectionAddress && path !== 'atomic') {
    throw new Error('Missing collection address.')
  }

  const sender =
    'sender' in optionsOrSender
      ? optionsOrSender.sender
      : getChainAddressForActionOptions(optionsOrSender, chainId)
  if (!sender) {
    throw new Error('No sender found for chain.')
  }

  const srcChainId =
    'sender' in optionsOrSender
      ? optionsOrSender.srcChainId || chainId
      : optionsOrSender.chain.chainId

  const mintTarget = mintContract || collectionAddress
  const totalMint = (BigInt(pricePerToken || '0') * BigInt(quantity)).toString()

  const mintMsg = {
    mint: {
      amount: quantity,
      allocation: allocation ?? null,
      proof_hashes: proofHashes || [],
    },
  }

  if (path === 'atomic') {
    if (!shitstrapAddress || !slopDenom || !slopAmount) {
      throw new Error(
        'Atomic mint requires shitstrap address, slop denom, and amount.'
      )
    }
    return maybeMakePolytoneExecuteMessages(
      srcChainId,
      chainId,
      makeExecuteSmartContractMessage({
        chainId,
        sender,
        contractAddress: shitstrapAddress,
        msg: {
          shit_strap_and_mint: {
            shit: {
              denom: { native: slopDenom },
              amount: slopAmount,
            },
            dao: null,
            proof_hashes: proofHashes || [],
          },
        },
        funds: [{ denom: slopDenom, amount: slopAmount }],
      })
    )
  }

  if (path === 'legacy') {
    if (!shitstrapAddress || !slopDenom || !slopAmount) {
      throw new Error('Legacy path requires shitstrap payment step.')
    }
    return maybeMakePolytoneExecuteMessages(srcChainId, chainId, [
      makeExecuteSmartContractMessage({
        chainId,
        sender,
        contractAddress: shitstrapAddress,
        msg: {
          shit_strap: {
            shit: {
              denom: { native: slopDenom },
              amount: slopAmount,
            },
            dao: null,
          },
        },
        funds: [{ denom: slopDenom, amount: slopAmount }],
      }),
      makeExecuteSmartContractMessage({
        chainId,
        sender,
        contractAddress: mintTarget,
        msg: mintMsg,
        funds:
          BigInt(totalMint) > 0n
            ? [{ denom: mintDenom, amount: totalMint }]
            : [],
      }),
    ])
  }

  // wallet | whitelist — direct mint
  return maybeMakePolytoneExecuteMessages(
    srcChainId,
    chainId,
    makeExecuteSmartContractMessage({
      chainId,
      sender,
      contractAddress: mintTarget,
      msg: mintMsg,
      funds:
        path === 'whitelist' || BigInt(totalMint) === 0n
          ? []
          : [{ denom: mintDenom, amount: totalMint }],
    })
  )
}
