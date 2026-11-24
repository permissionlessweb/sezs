import { toUtf8 } from '@cosmjs/encoding'
import { CancelOutlined, Key, Send } from '@mui/icons-material'
import clsx from 'clsx'
import { usePlausible } from 'next-plausible'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useRecoilValue } from 'recoil'

import { DaoProposalSingleCommonSelectors } from '@dao-dao/state'
import { chainQueries } from '@dao-dao/state/query'
import {
  ProposalStatusAndInfoProps,
  TextInput,
  TxCrossChainRelayStatus,
  useDao,
} from '@dao-dao/stateless'
import {
  ChainId,
  LoadingDataWithError,
  PlausibleEvents,
  PreProposeModuleType,
  ProposalStatusEnum,
  ProposalStatusKey,
} from '@dao-dao/types'
import { ExtensionData } from '@dao-dao/types/protobuf/codegen/gaia/metaprotocols/extensions'
import {
  DAO_CORE_ALLOW_MEMO_ON_EXECUTE_ITEM_KEY,
  NEUTRON_GOVERNANCE_DAO,
  extractProposalDescriptionAndMetadata,
  processError,
} from '@dao-dao/utils'

import { ProfileProposalCard } from '../components'
import { useProposalModuleAdapterContext } from '../proposal-module-adapter'
import { useQueryLoadingDataWithError } from './query'
import { useMembership } from './useMembership'
import { useSmartAccount } from './useSmartAccount'
import { UseTxRelayStateReturn } from './useTxRelayState'
import { useWallet } from './useWallet'

export type UseProposalActionStateOptions = {
  /**
   * Proposal description, for decoding additional execution metadata.
   */
  description: string
  /**
   * Proposal start height, for checking if the wallet can execute.
   */
  proposalStartHeight: number
  relayState: UseTxRelayStateReturn
  statusKey: ProposalStatusKey
  loadingExecutionTxHash: LoadingDataWithError<string | null>
  onExecuteSuccess: () => void | Promise<void>
  onCloseSuccess: () => void | Promise<void>
}

export type UseProposalActionStateReturn = Pick<
  ProposalStatusAndInfoProps,
  'action' | 'footer'
>

/**
 * This hook determines the action and footer to show on a proposal based on its
 * status. It is used in the proposal module adapters' ProposalStatusAndInfo
 * components.
 */
export const useProposalActionState = ({
  description,
  proposalStartHeight,
  relayState,
  statusKey,
  loadingExecutionTxHash,
  onExecuteSuccess,
  onCloseSuccess,
}: UseProposalActionStateOptions): UseProposalActionStateReturn => {
  const { t } = useTranslation()
  const dao = useDao()
  const {
    options: { proposalNumber },
    proposalModule,
  } = useProposalModuleAdapterContext()
  const {
    isWalletConnected,
    address: walletAddress = '',
    getSigningClient,
  } = useWallet()
  const { isMember = false } = useMembership({
    blockHeight: proposalStartHeight,
  })
  const plausible = usePlausible<PlausibleEvents>()

  const feeGrants = useQueryLoadingDataWithError(
    walletAddress
      ? chainQueries.feeGrantsByGrantee({
          chainId: proposalModule.chainId,
          address: walletAddress,
          basic: true,
        })
      : undefined
  )
  const feeGranter =
    !feeGrants.loading && !feeGrants.errored
      ? feeGrants.data[0]?.granter
      : undefined

  const config = useRecoilValue(
    DaoProposalSingleCommonSelectors.configSelector({
      chainId: proposalModule.chainId,
      contractAddress: proposalModule.address,
    })
  )

  const [actionLoading, setActionLoading] = useState(false)
  // On proposal status update, stop loading. This ensures the action button
  // doesn't stop loading too early, before the status has refreshed.
  useEffect(() => {
    setActionLoading(false)
  }, [statusKey])

  const { metadata } = extractProposalDescriptionAndMetadata(description)

  // Smartaccount TxExtension for Terp (and other smartaccount chains).
  const {
    resolveTxOptions,
    getSigningClientForTx,
    rememberSelected: rememberSmartAccountSelection,
  } = useSmartAccount({
    chainId: dao.chainId,
    address: walletAddress,
  })

  // If enabled, the user will be shown an input field to enter a memo for the
  // execution transaction, unless a memo is already set in the metadata.
  const allowMemoOnExecute = metadata?.memo
    ? false
    : !!dao.info.items[DAO_CORE_ALLOW_MEMO_ON_EXECUTE_ITEM_KEY]
  const [memo, setMemo] = useState('')

  const onExecute = useCallback(async () => {
    if (!isWalletConnected) {
      return
    }

    setActionLoading(true)
    try {
      const { metadata } = extractProposalDescriptionAndMetadata(description)

      const gaiaOptions = metadata?.gaiaMetaprotocolsExtensionData?.length
        ? {
            nonCriticalExtensionOptions:
              metadata.gaiaMetaprotocolsExtensionData.map(
                ({ protocolId, protocolVersion, data }) => ({
                  typeUrl: ExtensionData.typeUrl,
                  value: ExtensionData.fromPartial({
                    protocolId,
                    protocolVersion,
                    data: toUtf8(data),
                  }),
                })
              ),
          }
        : undefined

      // Live-resolve smartaccount options; merge Gaia + fee granter.
      const txOptions = {
        ...(await resolveTxOptions(1, gaiaOptions)),
        feeGranter,
      }

      // Extensions (Gaia or smartaccount) require direct signer — no amino.
      const needsDirectSigner =
        !!txOptions.nonCriticalExtensionOptions?.length ||
        !!metadata?.gaiaMetaprotocolsExtensionData?.length

      const signingClient = needsDirectSigner
        ? async () => {
            try {
              return await getSigningClientForTx(txOptions)
            } catch (err) {
              console.error(
                'Failed to retrieve direct signer for extension-option proposal execution.',
                err
              )

              throw new Error(
                t('error.browserExtensionWalletRequiredForProposalExecution')
              )
            }
          }
        : getSigningClient

      await proposalModule.execute({
        proposalId: proposalNumber,
        signingClient,
        sender: walletAddress,
        memo: metadata?.memo || (allowMemoOnExecute && memo ? memo : undefined),
        txOptions,
      })

      rememberSmartAccountSelection()

      plausible('daoProposalExecute', {
        props: {
          chainId: dao.chainId,
          dao: dao.coreAddress,
          walletAddress,
          proposalModule: proposalModule.address,
          proposalModuleType: proposalModule.contractName,
          proposalNumber: proposalNumber,
        },
      })

      await onExecuteSuccess()
    } catch (err) {
      console.error(err)
      toast.error(processError(err))

      // Stop loading if errored.
      setActionLoading(false)
    }

    // Loading will stop on success when status refreshes.
  }, [
    isWalletConnected,
    description,
    getSigningClient,
    getSigningClientForTx,
    resolveTxOptions,
    proposalModule,
    proposalNumber,
    walletAddress,
    allowMemoOnExecute,
    memo,
    onExecuteSuccess,
    t,
    plausible,
    dao,
    feeGranter,
    rememberSmartAccountSelection,
  ])

  const onClose = useCallback(async () => {
    if (!isWalletConnected) {
      return
    }

    setActionLoading(true)

    try {
      const txOptions = await resolveTxOptions(1, { feeGranter })
      await proposalModule.close({
        proposalId: proposalNumber,
        signingClient: () => getSigningClientForTx(txOptions),
        sender: walletAddress,
        txOptions,
      })

      rememberSmartAccountSelection()

      plausible('daoProposalClose', {
        props: {
          chainId: dao.chainId,
          dao: dao.coreAddress,
          walletAddress,
          proposalModule: proposalModule.address,
          proposalModuleType: proposalModule.contractName,
          proposalNumber: proposalNumber,
        },
      })

      await onCloseSuccess()
    } catch (err) {
      console.error(err)
      toast.error(processError(err))

      // Stop loading if errored.
      setActionLoading(false)
    }

    // Loading will stop on success when status refreshes.
  }, [
    isWalletConnected,
    proposalModule,
    proposalNumber,
    getSigningClientForTx,
    resolveTxOptions,
    rememberSmartAccountSelection,
    walletAddress,
    onCloseSuccess,
    plausible,
    dao,
    feeGranter,
  ])

  const showRelayStatus =
    !relayState.loading &&
    statusKey === ProposalStatusEnum.Executed &&
    relayState.data.hasCrossChainMessages

  // If executed and has polytone messages that need relaying...
  const showSelfRelay =
    statusKey === ProposalStatusEnum.Executed &&
    !relayState.loading &&
    relayState.data.needsSelfRelay &&
    !loadingExecutionTxHash.loading &&
    !loadingExecutionTxHash.errored &&
    !!loadingExecutionTxHash.data

  return {
    action:
      statusKey === ProposalStatusEnum.Passed &&
      // Show if anyone can execute OR if the wallet is a member, once
      // polytone messages that need relaying are done loading.
      (!config.only_members_execute || isMember) &&
      !relayState.loading
        ? {
            label: t('button.execute'),
            Icon: Key,
            loading: actionLoading,
            doAction: relayState.data.needsSelfRelay
              ? relayState.data.openSelfRelay
              : onExecute,
            header: allowMemoOnExecute ? (
              <TextInput
                onChange={(e) => setMemo(e.target.value)}
                placeholder={t('info.memoPlaceholder')}
                value={memo}
              />
            ) : undefined,
          }
        : statusKey === ProposalStatusEnum.Rejected &&
            // Don't show for Neutron overrule proposals.
            !(
              dao.chainId === ChainId.NeutronMainnet &&
              dao.coreAddress === NEUTRON_GOVERNANCE_DAO &&
              proposalModule.prePropose?.type ===
                PreProposeModuleType.NeutronOverruleSingle
            )
          ? {
              label: t('button.close'),
              Icon: CancelOutlined,
              loading: actionLoading,
              doAction: onClose,
            }
          : showSelfRelay
            ? {
                label: t('button.relay'),
                Icon: Send,
                loading: actionLoading,
                doAction: relayState.data.openSelfRelay,
                description: t('error.polytoneExecutedNoRelay'),
              }
            : undefined,
    footer: (showRelayStatus || isWalletConnected) && (
      <div
        className={clsx(
          'flex flex-col gap-6',
          showRelayStatus && showSelfRelay && '-mt-4'
        )}
      >
        {showRelayStatus && (
          <TxCrossChainRelayStatus
            canSelfRelay={
              !loadingExecutionTxHash.loading &&
              !loadingExecutionTxHash.errored &&
              !!loadingExecutionTxHash.data
            }
            selfRelayLoadError={
              loadingExecutionTxHash.errored
                ? loadingExecutionTxHash.error
                : undefined
            }
            state={relayState.data}
          />
        )}

        {isWalletConnected && <ProfileProposalCard />}
      </div>
    ),
  }
}
