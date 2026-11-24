import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { Collapsible, useChain, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import type { PledgeDataCommitment } from '@dao-dao/utils'
import {
  PLEDGE_STORAGE_KEY,
  buildCosmosArbitraryExt,
  buildPledgeAuthMessage,
  buildPledgeMintExecuteMsg,
  buildPledgeTokenMetadata,
  executeSmartContract,
  generatePledgeAuthNonce,
  parseModuleCommitments,
  processError,
  resolvePledgeDocUrl,
  resolveTrustlessPledgeDiscovery,
  signPledgeDigest,
} from '@dao-dao/utils'

import { useSmartAccount } from '../../../hooks/useSmartAccount'
import { useWallet } from '../../../hooks/useWallet'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { DEFAULT_PLEDGE_SITE_URL } from './constants'
import { hasPledgedQueries } from './hasPledged'
import { PledgeDocumentBody } from './PledgeDocumentBody'
import { TrustlessPledgeStatus } from './stateless/TrustlessPledgeStatus'
import { TrustlessPledgeModuleData } from './types'

const PLEDGE_MODULE_INFO_MD = `### What is this?

A **public integrity pledge** you can read in-app, then sign with your wallet and mint as an NFT on Terp.

### How it works

1. Read the pledge text below (loaded from IPFS when a manifesto CID is set).
2. Connect your wallet — chain ownership is the only “has pledged” source of truth.
3. Sign & mint — ADR-36 wallet auth + ADR-032 digest over the manifesto.

### Tips

- Primary site: [permissionless.money/pledge](https://permissionless.money/pledge)
- Fileverse is an optional long-form link, not required to pledge
- If the in-app text fails to load, use **Visit site** — your wallet is fine
`

type Attestation = {
  digestHex: string
  digestAlg: string
  signature: string
  pubkey: string
  manifestoCid: string
  projectId?: string
  authMessage: string
  authNonce: string
  metadataJson: string
}

/**
 * Trustlessness Pledge renderer — elegant home-card + real site URL.
 * Mint path: ADR-032 digest → ADR-36 auth → cw721_svg mint with ext.
 */
export const TrustlessPledgeRenderer = ({
  variables: {
    collection: collectionVar,
    minter: minterVar,
    manifestoCid: manifestoCidVar,
    teamCid: teamCidVar,
    ethContract: ethContractVar,
    ethDocumentTokenId: ethDocumentTokenIdVar,
    ethTeamTokenId: ethTeamTokenIdVar,
    ipfsGateway: ipfsGatewayVar,
    pledgeDocUrl,
    pledgeSiteUrl,
    signDomain,
    digestAlg,
    projectId,
    commitments,
    authHrp,
    authDst,
    onePerWallet,
    buttonLabel,
    teamNote,
    description,
  },
}: ModuleRendererProps<TrustlessPledgeModuleData>) => {
  const { t } = useTranslation()
  const { chainId } = useChain()
  const dao = useDao()
  const queryClient = useQueryClient()

  // TP-BOOT-3: module editor wins, then DAO storage trustless_pledge.v1.
  const discovery = useMemo(
    () =>
      resolveTrustlessPledgeDiscovery({
        module: {
          collection: collectionVar,
          minter: minterVar,
          manifestoCid: manifestoCidVar,
          teamCid: teamCidVar,
          ethContract: ethContractVar,
          ethDocumentTokenId: ethDocumentTokenIdVar,
          ethTeamTokenId: ethTeamTokenIdVar,
          ipfsGateway: ipfsGatewayVar,
        },
        storageRaw: dao.info.items[PLEDGE_STORAGE_KEY] ?? null,
      }),
    [
      collectionVar,
      minterVar,
      manifestoCidVar,
      teamCidVar,
      ethContractVar,
      ethDocumentTokenIdVar,
      ethTeamTokenIdVar,
      ipfsGatewayVar,
      dao.info.items[PLEDGE_STORAGE_KEY],
    ]
  )
  const collection = discovery.collection
  const minter = discovery.minter || undefined
  const manifestoCid = discovery.manifestoCid
  const teamCid = discovery.teamCid || undefined
  const ipfsGateway = discovery.ipfsGateway
  const {
    address: walletAddress = '',
    isWalletConnected,
    chainWallet,
    refreshBalances,
  } = useWallet()
  const { resolveTxOptions, getSigningClientForTx, rememberSelected } =
    useSmartAccount({
      chainId,
      address: walletAddress,
    })

  const [busy, setBusy] = useState(false)
  const [attestation, setAttestation] = useState<Attestation | null>(null)

  const mintContract = minter || collection
  const siteUrl = (pledgeSiteUrl || DEFAULT_PLEDGE_SITE_URL).trim()

  const resolvedCommitments: PledgeDataCommitment[] = useMemo(() => {
    try {
      return parseModuleCommitments(commitments)
    } catch {
      return []
    }
  }, [commitments])

  const manifestoIpfsUrl = useMemo(() => {
    return resolvePledgeDocUrl(manifestoCid, ipfsGateway)?.url || ''
  }, [ipfsGateway, manifestoCid])

  const hasPledgedQuery = useQuery({
    ...hasPledgedQueries.hasPledged({
      chainId,
      collection: collection || '',
      walletAddress,
    }),
    enabled: !!isWalletConnected && !!collection && !!walletAddress,
  })

  const hasPledged = !!hasPledgedQuery.data?.hasPledged
  const tokenId = hasPledgedQuery.data?.tokenId

  const signArbitrary = useCallback(
    async (message: string) => {
      if (!isWalletConnected || !walletAddress) {
        throw new Error(
          t('error.logInToContinue', {
            defaultValue: 'Connect a wallet to continue.',
          })
        )
      }

      const client = chainWallet?.client as
        | {
            signArbitrary?: (
              chainId: string,
              signer: string,
              data: string | Uint8Array
            ) => Promise<{
              signature: string
              pub_key: { type: string; value: string }
            }>
          }
        | undefined

      if (!client?.signArbitrary) {
        const keplr = (
          window as unknown as {
            keplr?: {
              signArbitrary: (
                chainId: string,
                signer: string,
                data: string | Uint8Array
              ) => Promise<{
                signature: string
                pub_key: { type: string; value: string }
              }>
            }
          }
        ).keplr
        if (!keplr?.signArbitrary) {
          throw new Error(
            t('error.unsupportedAminoWallet', {
              name: chainWallet?.walletPrettyName || 'wallet',
              defaultValue:
                'This wallet does not support signArbitrary (ADR-36).',
            })
          )
        }
        return keplr.signArbitrary(chainId, walletAddress, message)
      }

      return client.signArbitrary(chainId, walletAddress, message)
    },
    [chainId, chainWallet, isWalletConnected, t, walletAddress]
  )

  const onSignAndMint = async () => {
    if (!walletAddress) {
      toast.error(t('error.logInToContinue'))
      return
    }
    if (!collection || !mintContract) {
      toast.error(
        t('error.noContract', {
          defaultValue:
            'No pledge collection configured. Set it in the module editor.',
        })
      )
      return
    }
    if (!manifestoCid?.trim()) {
      toast.error(
        t('error.manifestoCidRequired', {
          defaultValue: 'Manifesto CID is required before signing.',
        })
      )
      return
    }
    if (onePerWallet && hasPledged) {
      toast.error(
        t('error.alreadyPledged', {
          defaultValue: 'This wallet already pledged (one per wallet).',
        })
      )
      return
    }

    setBusy(true)
    try {
      const digestResult = signPledgeDigest({
        domain: signDomain || 'terp-adr032/v1',
        chainId,
        account: walletAddress,
        manifestoCid: manifestoCid.trim(),
        projectId: (projectId || '').trim(),
        commitments: parseModuleCommitments(commitments),
        digestAlg: digestAlg || 'blake2b256',
      })

      const authNonce = generatePledgeAuthNonce()
      const authMessage = buildPledgeAuthMessage({
        nonce: authNonce,
        digestHexBare: digestResult.digestHexBare,
        dst: authDst || undefined,
      })

      const signed = await signArbitrary(authMessage)
      const signature = signed.signature
      const pubkey = signed.pub_key?.value || ''
      if (!signature || !pubkey) {
        throw new Error(
          t('error.missingWalletSignature', {
            defaultValue:
              'Wallet did not return signature/pubkey for mint auth.',
          })
        )
      }

      const ext = buildCosmosArbitraryExt({
        authMessage,
        signatureBase64: signature,
        pubkeyBase64: pubkey,
        hrp: authHrp || 'terp',
      })

      const metadata = buildPledgeTokenMetadata({
        manifestoCid: manifestoCid.trim(),
        digestAlg: digestResult.digestAlg,
        digestHex: digestResult.digestHex,
        signature,
        pubkey,
        pledgeDocUrl: pledgeDocUrl || siteUrl,
        projectId: digestResult.projectId || undefined,
        commitments: digestResult.commitments,
        authMessage,
        authNonce,
        image: manifestoIpfsUrl || undefined,
      })

      setAttestation({
        digestHex: digestResult.digestHex,
        digestAlg: digestResult.digestAlg,
        signature,
        pubkey,
        manifestoCid: manifestoCid.trim(),
        projectId: digestResult.projectId || undefined,
        authMessage,
        authNonce,
        metadataJson: JSON.stringify(metadata, null, 2),
      })

      const mintMsg = buildPledgeMintExecuteMsg({ amount: 1, ext })

      const txOptions = await resolveTxOptions(1)
      const client = await getSigningClientForTx(txOptions)

      await executeSmartContract(
        client,
        walletAddress,
        mintContract,
        mintMsg,
        undefined,
        undefined,
        undefined,
        txOptions
      )

      rememberSelected()
      refreshBalances()

      await queryClient.invalidateQueries({
        queryKey: hasPledgedQueries.hasPledged({
          chainId,
          collection,
          walletAddress,
        }).queryKey,
      })

      toast.success(
        t('success.pledgeMinted', {
          defaultValue: 'Pledge signed and mint submitted. Thank you.',
        })
      )
    } catch (err) {
      console.error(err)
      toast.error(
        processError(err, {
          forceCapture: false,
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const ctaLabel =
    buttonLabel ||
    t('button.signAndMintPledge', { defaultValue: 'Sign & mint pledge' })

  const statusError = hasPledgedQuery.isError
    ? t('error.failedHasPledged', {
        defaultValue:
          'Could not query pledge status on-chain. Check collection address.',
      })
    : null

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={PLEDGE_MODULE_INFO_MD}
        infoTitle="Trustlessness Pledge"
        lede="Read the pledge, sign with your wallet, mint an NFT anyone can verify."
        title="Trustlessness Pledge"
      />
    <TrustlessPledgeStatus
      buttonLabel={busy ? t('info.loading', { defaultValue: 'Working…' }) : ctaLabel}
      collectionConfigured={!!collection}
      connected={!!isWalletConnected}
      description={description}
      documentBody={
        <PledgeDocumentBody
          ipfsGateway={ipfsGateway}
          title="Trustlessness Pledge"
          uriOrCid={manifestoCid}
        />
      }
      error={statusError}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            {t('info.pledgeHonestyNote', {
              defaultValue:
                'Mint requires on-chain ADR-36 auth (DST+nonce|digest). The digest is the ADR-032 hash of manifesto CID, optional project_id, and multi-destination commitments. The contract verifies the wallet signature and one-time nonce.',
            })}
          </p>
          {collection && (
            <p className="font-mono break-all opacity-70">
              collection · {collection}
            </p>
          )}
        </div>
      }
      hasPledged={hasPledged}
      loading={hasPledgedQuery.isLoading || busy}
      manifestoCid={manifestoCid}
      manifestoIpfsUrl={manifestoIpfsUrl || undefined}
      mintCount={hasPledgedQuery.data?.mintCount}
      onSignAndMint={onSignAndMint}
      pledgeDocUrl={pledgeDocUrl}
      pledgeSiteUrl={siteUrl}
      signDisabled={
        busy ||
        !mintContract ||
        !manifestoCid ||
        (onePerWallet && hasPledged)
      }
      teamDocumentBody={
        teamCid?.trim() ? (
          <PledgeDocumentBody
            ipfsGateway={ipfsGateway}
            title="Team variant"
            uriOrCid={teamCid}
          />
        ) : undefined
      }
      teamNote={teamNote}
      tokenId={tokenId}
    >
      {(projectId || resolvedCommitments.length > 0) && (
        <div className="flex flex-col gap-1 rounded-lg border border-border-secondary bg-background-primary/50 p-3">
          {projectId && (
            <p className="secondary-text font-mono text-xs break-all">
              project_id · {projectId}
            </p>
          )}
          {resolvedCommitments.length > 0 && (
            <p className="secondary-text text-xs">
              {resolvedCommitments.length} data commitment
              {resolvedCommitments.length === 1 ? '' : 's'} bound into the
              digest
            </p>
          )}
        </div>
      )}

      {attestation && (
        <Collapsible
          containerClassName="rounded-lg border border-border-primary bg-background-primary/50 p-3"
          defaultCollapsed
          label={t('title.signatureMetadata', {
            defaultValue: 'Signature metadata (advanced)',
          })}
        >
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="secondary-text font-mono text-xs break-all">
              digest ({attestation.digestAlg}): {attestation.digestHex}
            </p>
            {attestation.projectId && (
              <p className="secondary-text font-mono text-xs break-all">
                project_id: {attestation.projectId}
              </p>
            )}
            <p className="secondary-text font-mono text-xs break-all">
              auth_message: {attestation.authMessage}
            </p>
            <details>
              <summary className="link-text cursor-pointer text-xs">
                {t('button.viewMetadataJson', {
                  defaultValue: 'View metadata JSON',
                })}
              </summary>
              <pre className="secondary-text mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                {attestation.metadataJson}
              </pre>
            </details>
          </div>
        </Collapsible>
      )}
    </TrustlessPledgeStatus>
    </div>
  )
}
