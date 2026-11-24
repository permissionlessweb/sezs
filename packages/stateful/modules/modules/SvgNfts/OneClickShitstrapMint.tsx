import { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { Button, SegmentedControls } from '@dao-dao/stateless'
import { cwMsgToEncodeObject } from '@dao-dao/types'
import { SvgMintPaymentPath, processError } from '@dao-dao/utils'

import { encodeMintSvgWithShitstrap } from '../../../actions/core/actions/MintSvgWithShitstrap/encode'
import { useSmartAccount } from '../../../hooks/useSmartAccount'
import { useWallet } from '../../../hooks/useWallet'

/**
 * Module-surface 1-click mint: wallet THIOL or atomic/legacy shitstrap.
 * Encodes the same messages as MintSvgWithShitstrapAction for proposal reuse.
 */
export const OneClickShitstrapMint = ({
  chainId,
  collectionAddress,
  mintContract,
  pricePerToken = '0',
  mintDenom = 'uthiol',
  quantity = 1,
  shitstrapAddress,
  slopDenom,
  slopAmount,
}: {
  chainId: string
  collectionAddress: string
  mintContract?: string
  pricePerToken?: string
  mintDenom?: string
  quantity?: number
  shitstrapAddress?: string
  slopDenom?: string
  slopAmount?: string
}) => {
  const { t } = useTranslation()
  const { address = '', isWalletConnected } = useWallet({ chainId })
  const { resolveTxOptions, getSigningClientForTx, rememberSelected } =
    useSmartAccount({ chainId, address })
  const [path, setPath] = useState<SvgMintPaymentPath>(
    shitstrapAddress && slopDenom && slopAmount ? 'atomic' : 'wallet'
  )
  const [loading, setLoading] = useState(false)

  const onMint = async () => {
    if (!isWalletConnected || !address) {
      toast.error(t('error.logInToContinue'))
      return
    }
    setLoading(true)
    try {
      const cosmosMsgs = encodeMintSvgWithShitstrap(
        { sender: address, srcChainId: chainId },
        {
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
          proofHashes: [],
        }
      )

      const encodeObjects = cosmosMsgs.map((m) =>
        cwMsgToEncodeObject(chainId, m, address)
      )

      const txOptions = await resolveTxOptions(encodeObjects.length)
      const client = await getSigningClientForTx(txOptions)

      await client.signAndBroadcast(
        address,
        encodeObjects,
        'auto',
        undefined,
        undefined,
        txOptions
      )

      rememberSelected()
      toast.success(
        t('success.mintSubmitted', {
          defaultValue: 'Mint transaction submitted',
        })
      )
    } catch (err) {
      console.error(err)
      toast.error(processError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-primary p-3">
      <p className="primary-text text-sm">
        {t('title.oneClickMint', {
          defaultValue: '1-click mint (wallet / shitstrap)',
        })}
      </p>
      <SegmentedControls
        onSelect={setPath}
        selected={path}
        tabs={[
          { label: 'Wallet', value: 'wallet' as const },
          { label: 'Atomic', value: 'atomic' as const },
          { label: 'Strap+mint', value: 'legacy' as const },
        ]}
      />
      {(path === 'atomic' || path === 'legacy') && !shitstrapAddress && (
        <p className="text-xs text-text-interactive-warning-body">
          {t('info.configureShitstrapForAtomic', {
            defaultValue:
              'For atomic / strap+mint, provide shitstrap + slop (use the action builder for full plan UI).',
          })}
        </p>
      )}
      <Button
        disabled={
          !isWalletConnected ||
          ((path === 'atomic' || path === 'legacy') &&
            (!shitstrapAddress || !slopDenom || !slopAmount))
        }
        loading={loading}
        onClick={onMint}
        variant="primary"
      >
        {path === 'atomic'
          ? t('button.atomicMint', { defaultValue: '1-click atomic mint' })
          : path === 'legacy'
            ? t('button.shitstrapThenMint', {
                defaultValue: 'Shitstrap then mint',
              })
            : t('button.mintWithWallet', { defaultValue: 'Mint with wallet' })}
      </Button>
      <p className="secondary-text text-xs">
        {t('info.sameAsAction', {
          defaultValue:
            'Same encode path as Permissionless → Mint SVG (wallet / shitstrap) for proposals.',
        })}
      </p>
    </div>
  )
}
