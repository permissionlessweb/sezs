/**
 * Gift-account feegrant preauth helpers.
 *
 * Shared-link gift accounts bootstrap fresh wallets. Sponsors may preauthorize
 * gas for a limited set of message types via x/feegrant AllowedMsgAllowance.
 * Only selected actions are included — never a blanket BasicAllowance unless
 * the catalog action explicitly requests it (we do not expose unlimited basic).
 */

import { makeStargateMessage, UnifiedCosmosMsg } from '@dao-dao/types'
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from '@dao-dao/types/protobuf/codegen/cosmos/feegrant/v1beta1/feegrant'
import { MsgGrantAllowance } from '@dao-dao/types/protobuf/codegen/cosmos/feegrant/v1beta1/tx'

/** Stable ids for template actions selectable at gift generation. */
export type GiftPreauthActionId =
  | 'bank_send'
  | 'wasm_execute'
  | 'staking_delegate'
  | 'gov_vote'
  | 'ibc_transfer'
  | 'authz_exec'

export type GiftPreauthAction = {
  id: GiftPreauthActionId
  /** Short UI label */
  label: string
  /** One-line honest description of what feegrant covers */
  description: string
  /** Cosmos SDK type URL(s) included when this action is selected */
  msgTypeUrls: string[]
}

/**
 * Catalog of bootstrap template actions. Feegrant allowance is restricted to
 * these type URLs when selected — no other msgs are paid by the granter.
 */
export const GIFT_PREAUTH_ACTIONS: readonly GiftPreauthAction[] = [
  {
    id: 'bank_send',
    label: 'Bank send',
    description: 'Pay gas for MsgSend only (not the send amount).',
    msgTypeUrls: ['/cosmos.bank.v1beta1.MsgSend'],
  },
  {
    id: 'wasm_execute',
    label: 'Wasm execute',
    description: 'Pay gas for contract execute (CwExecute).',
    msgTypeUrls: ['/cosmwasm.wasm.v1.MsgExecuteContract'],
  },
  {
    id: 'staking_delegate',
    label: 'Stake / delegate',
    description: 'Pay gas for MsgDelegate.',
    msgTypeUrls: ['/cosmos.staking.v1beta1.MsgDelegate'],
  },
  {
    id: 'gov_vote',
    label: 'Governance vote',
    description: 'Pay gas for gov votes (v1 + v1beta1).',
    msgTypeUrls: [
      '/cosmos.gov.v1.MsgVote',
      '/cosmos.gov.v1beta1.MsgVote',
    ],
  },
  {
    id: 'ibc_transfer',
    label: 'IBC transfer',
    description: 'Pay gas for ICS-20 MsgTransfer.',
    msgTypeUrls: ['/ibc.applications.transfer.v1.MsgTransfer'],
  },
  {
    id: 'authz_exec',
    label: 'Authz exec',
    description: 'Pay gas for MsgExec (nested authz).',
    msgTypeUrls: ['/cosmos.authz.v1beta1.MsgExec'],
  },
] as const

export const DEFAULT_GIFT_PREAUTH_ACTIONS: GiftPreauthActionId[] = [
  'bank_send',
  'wasm_execute',
]

const ACTION_BY_ID = new Map(
  GIFT_PREAUTH_ACTIONS.map((a) => [a.id, a] as const)
)

export const isGiftPreauthActionId = (
  value: string
): value is GiftPreauthActionId => ACTION_BY_ID.has(value as GiftPreauthActionId)

/**
 * Resolve selected action ids → unique msg type URLs (selected actions only).
 * Unknown ids are ignored. Order follows catalog order.
 */
export const resolvePreauthMsgTypeUrls = (
  actionIds: readonly string[] | undefined | null
): string[] => {
  if (!actionIds?.length) {
    return []
  }
  const selected = new Set(
    actionIds.filter(isGiftPreauthActionId) as GiftPreauthActionId[]
  )
  const urls: string[] = []
  const seen = new Set<string>()
  for (const action of GIFT_PREAUTH_ACTIONS) {
    if (!selected.has(action.id)) {
      continue
    }
    for (const url of action.msgTypeUrls) {
      if (!seen.has(url)) {
        seen.add(url)
        urls.push(url)
      }
    }
  }
  return urls
}

export type BuildGiftFeegrantParams = {
  granter: string
  grantee: string
  /** Selected catalog action ids — only these msgs are allowed. */
  actionIds: readonly string[]
  /**
   * Optional spend limit for gas fees (BasicAllowance inside AllowedMsg).
   * Empty / omitted → no spend_limit (still restricted by allowed_messages).
   */
  spendLimit?: { denom: string; amount: string }[]
  /** Optional allowance expiration. */
  expiration?: Date
}

/**
 * Build MsgGrantAllowance stargate messages for the gift grantee.
 * Returns [] when no actions selected or addresses missing — never invents
 * a blanket unlimited grant.
 */
export const buildGiftFeegrantMsgs = ({
  granter,
  grantee,
  actionIds,
  spendLimit,
  expiration,
}: BuildGiftFeegrantParams): UnifiedCosmosMsg[] => {
  const granterTrim = granter?.trim()
  const granteeTrim = grantee?.trim()
  if (!granterTrim || !granteeTrim) {
    return []
  }

  const allowedMessages = resolvePreauthMsgTypeUrls(actionIds)
  if (allowedMessages.length === 0) {
    return []
  }

  const basic = BasicAllowance.fromPartial({
    spendLimit: (spendLimit || []).map((c) => ({
      denom: c.denom,
      amount: c.amount,
    })),
    expiration: expiration
      ? (() => {
          const d = new Date(expiration)
          d.setMilliseconds(0)
          return d
        })()
      : undefined,
  })

  const allowed = AllowedMsgAllowance.fromPartial({
    // Nested as Any-shaped ProtoMsg (same pattern as authz grants).
    allowance: BasicAllowance.toProtoMsg(basic) as any,
    allowedMessages,
  })

  return [
    makeStargateMessage({
      stargate: {
        typeUrl: MsgGrantAllowance.typeUrl,
        value: {
          granter: granterTrim,
          grantee: granteeTrim,
          allowance: AllowedMsgAllowance.toProtoMsg(allowed),
        },
      },
    }),
  ]
}

/**
 * Human-readable summary for UI / docs (selected actions only).
 */
export const summarizePreauthSelection = (
  actionIds: readonly string[] | undefined | null
): { actionIds: GiftPreauthActionId[]; msgTypeUrls: string[] } => {
  const ids = (actionIds || []).filter(isGiftPreauthActionId)
  return {
    actionIds: ids,
    msgTypeUrls: resolvePreauthMsgTypeUrls(ids),
  }
}

/**
 * Toggle helper for multi-select UI.
 */
export const togglePreauthAction = (
  current: readonly GiftPreauthActionId[],
  id: GiftPreauthActionId
): GiftPreauthActionId[] => {
  if (current.includes(id)) {
    return current.filter((x) => x !== id)
  }
  return [...current, id]
}
