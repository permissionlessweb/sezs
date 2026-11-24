import { Endpoints } from '@cosmos-kit/core'
import { wallets as cosmosExtensionMetamaskWallets } from '@cosmos-kit/cosmos-extension-metamask'
import { wallets as exodusWallets } from '@cosmos-kit/exodus'
// Full @cosmos-kit/keplr includes keplr-mobile (WalletConnect). Only load that
// bundle when NEXT_PUBLIC_ENABLE_WALLETCONNECT=true — otherwise cosmos-kit still
// mounts WC clients and spam-logs initClientError without walletConnectOptions.
import { wallets as keplrAllWallets } from '@cosmos-kit/keplr'
import { wallets as keplrExtensionWallets } from '@cosmos-kit/keplr-extension'
import { wallets as leapMetamaskWallets } from '@cosmos-kit/leap-metamask-cosmos-snap'

import { ChainProvider } from '@cosmos-kit/react-lite'
import { wallets as vultisigWallets } from '@cosmos-kit/vultisig'
import { PromptSign, makeWeb3AuthWallets } from '@cosmos-kit/web3auth'
import { useQueryClient } from '@tanstack/react-query'
import { PropsWithChildren, ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrevious } from 'react-use'
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil'

import { isInIframe } from '@dao-dao/cosmiframe'
import { makeGetSignerOptions } from '@dao-dao/state'
import {
  isKeplrMobileWebAtom,
  mountedInBrowserAtom,
  web3AuthPromptAtom,
} from '@dao-dao/state/recoil'
import { useUpdatingRef } from '@dao-dao/stateless'
import {
  CHAIN_ENDPOINTS,
  MAINNET,
  SITE_TITLE,
  SITE_URL,
  WEB3AUTH_CLIENT_ID,
  assets,
  chains,
  getKeplrFromWindow,
  isLabAllowlistedChain,
  isLabShellMode,
  maybeGetChainForChainId,
} from '@dao-dao/utils'

import { useSyncWalletSigner, useWallet } from '../../hooks'
import {
  ENABLE_WALLETCONNECT,
  getLabWalletAllowlist,
  isWalletNameAllowlisted,
} from './stableAuthFlags'
import { WalletUi } from './WalletUi'

/** Extension-only Keplr (no WalletConnect mobile client). */
const keplrExtensionOnly = keplrExtensionWallets

/** Full Keplr set when WC is explicitly enabled (extension + mobile). */
const keplrWalletsForProvider = ENABLE_WALLETCONNECT
  ? keplrAllWallets
  : keplrExtensionOnly

// Set better name for MetaMask wallets.
leapMetamaskWallets[0].walletInfo.prettyName = 'MetaMask (Leap Snap)'
cosmosExtensionMetamaskWallets[0].walletInfo.prettyName =
  'MetaMask (Cosmos Extension)'

const ALLOWED_IFRAME_PARENT_ORIGINS = [
  'https://daodao.zone',
  'https://dao.daodao.zone',
  'https://app.osmosis.zone',
  'http://localhost:3000',
]
// Support localhost dev env and vercel preview links.
if (!ALLOWED_IFRAME_PARENT_ORIGINS.includes(SITE_URL)) {
  ALLOWED_IFRAME_PARENT_ORIGINS.push(SITE_URL)
}

export type WalletProviderProps = {
  children: ReactNode
}

export const WalletProvider = ({ children }: WalletProviderProps) => {
  const { t } = useTranslation()

  const setWeb3AuthPrompt = useSetRecoilState(web3AuthPromptAtom)

  // // Google, Apple, Discord, Twitter
  // const web3AuthWallets = useMemo(
  //   () =>
  //     makeWeb3AuthWallets({
  //       loginMethods: [
  //         {
  //           provider: 'google',
  //           name: 'Google',
  //           logo: 'https://bafkreihcbb7vqxb3ee52kn5fnsf4rzqtjru5n6q2k4ungbw7k3ljpnhhvm.ipfs.nftstorage.link/',
  //         },
  //         {
  //           provider: 'apple',
  //           name: 'Apple',
  //           logo: 'https://bafkreih5fbwcnzq4xmarrgcf5wkr5mpx5gfia2loj5fruaa542v7kwv5iq.ipfs.nftstorage.link/',
  //         },
  //         {
  //           provider: 'discord',
  //           name: 'Discord',
  //           logo: 'https://bafkreifssoo7ljepiix4tvrpe4gbqlyhwx6vu6rtir4ou45pj7nv5mjnhm.ipfs.nftstorage.link/',
  //         },
  //         {
  //           provider: 'twitter',
  //           name: 'Twitter',
  //           logo: 'https://bafkreibfs3mpmwmaxqakpkpss7pjoe4tl2td3ghxt2mi75pyvrm47qn4jy.ipfs.nftstorage.link/',
  //         },
  //       ],
  //       client: {
  //         clientId: WEB3AUTH_CLIENT_ID,
  //         web3AuthNetwork: MAINNET ? 'cyan' : 'testnet',
  //       },
  //       promptSign: (...params: Parameters<PromptSign>): Promise<boolean> =>
  //         new Promise((resolve) =>
  //           setWeb3AuthPrompt({
  //             signData: params[1],
  //             resolve: (approved) => {
  //               setWeb3AuthPrompt(undefined)
  //               resolve(approved)
  //             },
  //           })
  //         ),
  //     }),
  //   [setWeb3AuthPrompt]
  // )

  const queryClient = useQueryClient()
  const getSigningOptions = makeGetSignerOptions(queryClient)

  // Auto-connect to Keplr mobile web if in that context.
  const mountedInBrowser = useRecoilValue(mountedInBrowserAtom)
  const [isKeplrMobileWeb, setIsKeplrMobileWeb] =
    useRecoilState(isKeplrMobileWebAtom)
  useEffect(() => {
    if (!mountedInBrowser) {
      return
    }

    ; (async () => {
      setIsKeplrMobileWeb((await getKeplrFromWindow())?.mode === 'mobile-web')
    })()
  }, [mountedInBrowser, setIsKeplrMobileWeb])

  // If in iframe, show no wallets, which will make it only show the iframe
  // wallet since that's installed by default.
  // Default: extension wallets only (no WalletConnect mobile clients).
  // WC mobile needs ENABLE_WALLETCONNECT + walletConnectOptions projectId.
  // Lab (!MAINNET or NEXT_PUBLIC_LAB_WALLET_ALLOWLIST): only register allowlisted
  // names so MetaMask/Exodus/Vultisig do not spam connect errors on 120u-1.
  const labWalletAllowlist = getLabWalletAllowlist()
  const allWallets = isInIframe()
    ? []
    : [
        // ...leapMetamaskWallets,
        // Alphabetize.
        ...[
          ...keplrWalletsForProvider,
          // Only pull optional extensions when allowlist is open or names match.
          ...(labWalletAllowlist === null ||
          labWalletAllowlist.includes('cosmos-extension-metamask')
            ? cosmosExtensionMetamaskWallets
            : []),
          ...(labWalletAllowlist === null ||
          labWalletAllowlist.includes('exodus-extension')
            ? exodusWallets
            : []),
          ...(labWalletAllowlist === null ||
          labWalletAllowlist.includes('vultisig-extension')
            ? vultisigWallets
            : []),
        ]
          // Defense in depth: never register WC-mode wallets unless opted in.
          .filter(
            (w) =>
              ENABLE_WALLETCONNECT || w.walletInfo?.mode !== 'wallet-connect'
          )
          .filter((w) =>
            isWalletNameAllowlisted(w.walletInfo?.name, labWalletAllowlist)
          )
          .sort((a, b) =>
            a.walletInfo.prettyName.localeCompare(b.walletInfo.prettyName)
          ),
        // Google, Apple, Discord, Twitter (centralized) — removed from fork.
        // ...web3AuthWallets,
      ]

  // Only pass WC options when mobile path is enabled — avoids cosmos-kit
  // mounting empty WC clients and logging initClientError every page load.
  const walletConnectOptions = ENABLE_WALLETCONNECT
    ? {
        signClient: {
          // https://cloud.walletconnect.com — set via env when re-enabling WC
          projectId:
            process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
            '2021db728d55be8401efaf25f4e534cd',
          relayUrl: 'wss://relay.walletconnect.org',
          metadata: {
            name: SITE_TITLE,
            description: t('meta.description'),
            url: SITE_URL,
            icons: ['https://daodao.zone/daodao.png'],
          },
        },
      }
    : undefined

  // Lab shell: only register allowlisted chains (default 120u-1) so cosmos-kit
  // does not probe stargaze/juno cosmos.directory RPCs during open-lab walks.
  const providerChains = (
    isLabShellMode()
      ? chains.filter((c) => isLabAllowlistedChain(c.chainId))
      : chains
  ).flatMap((c) => c.chainRegistry || [])

  const providerEndpoints = Object.entries(CHAIN_ENDPOINTS).reduce(
    (acc, [chainId, { rpc, rest }]) => {
      if (isLabShellMode() && !isLabAllowlistedChain(chainId)) {
        return acc
      }
      const chainName = maybeGetChainForChainId(chainId)?.chainName
      if (!chainName) {
        return acc
      }

      return {
        ...acc,
        [chainName]: {
          rpc: [rpc],
          rest: [rest],
          isLazy: true,
        },
      }
    },
    {} as Record<string, Endpoints>
  )

  return (
    <ChainProvider
      allowedIframeParentOrigins={ALLOWED_IFRAME_PARENT_ORIGINS}
      assetLists={assets}
      chains={providerChains}
      endpointOptions={{
        // Load all custom chain endpoints into wallet provider.
        endpoints: providerEndpoints,
      }}
      signerOptions={{
        // @ts-ignore
        signingStargate: getSigningOptions,
        // @ts-ignore
        signingCosmwasm: getSigningOptions,
      }}
      {...(walletConnectOptions
        ? { walletConnectOptions }
        : {})}
      walletModal={WalletUi}
      wallets={
        // If Keplr Mobile in-app browser, only allow Keplr Extension. Keplr
        // Mobile wallet works via WalletConnect from a desktop, but not in-app.
        isKeplrMobileWeb ? keplrExtensionWallets : allWallets
      }
    >
      <InnerWalletProvider>{children}</InnerWalletProvider>
    </ChainProvider>
  )
}

const InnerWalletProvider = ({ children }: PropsWithChildren<{}>) => {
  useSyncWalletSigner()

  const { isWalletConnected, isWalletDisconnected, walletRepo, wallet, chain } =
    useWallet()

  // Auto-connect to current chain if switched chains and no longer connected.
  const previousChain = usePrevious(chain.chainName)
  const previousConnected = usePrevious(isWalletConnected)
  const previousWalletName = usePrevious(wallet?.name)
  const walletRepoRef = useUpdatingRef(walletRepo)
  const reconnectingRef = useRef(false)
  useEffect(() => {
    if (
      previousConnected &&
      previousWalletName &&
      !isWalletConnected &&
      previousChain !== chain.chainName &&
      !reconnectingRef.current
    ) {
      reconnectingRef.current = true
      walletRepoRef.current
        .connect(previousWalletName, false)
        .catch(console.error)
        .finally(() => {
          reconnectingRef.current = false
        })
    }
  }, [
    previousConnected,
    isWalletConnected,
    previousChain,
    chain.chainName,
    previousWalletName,
    walletRepoRef,
  ])

  // Refresh connection on wallet change.
  useEffect(() => {
    if (typeof window === 'undefined' || !isWalletConnected || !wallet) {
      return
    }

    const refresh = async () => {
      // Ensure connection still alive, and disconnect on failure.
      try {
        await walletRepo.connect(wallet.name, false)
      } catch {
        await walletRepo.disconnect(wallet.name, true).catch(console.error)
      }
    }

    wallet.connectEventNamesOnWindow?.forEach((eventName) => {
      window.addEventListener(eventName, refresh)
    })

    // Clean up on unmount.
    return () => {
      wallet.connectEventNamesOnWindow?.forEach((eventName) => {
        window.removeEventListener(eventName, refresh)
      })
    }
  }, [isWalletConnected, wallet, walletRepo])

  // Auto-connect to Keplr mobile web if in that context.
  const isKeplrMobileWeb = useRecoilValue(isKeplrMobileWebAtom)
  useEffect(() => {
    if (!isKeplrMobileWeb || !isWalletDisconnected) {
      return
    }

    walletRepo.connect(keplrExtensionWallets[0].walletName, false)
  }, [isKeplrMobileWeb, isWalletDisconnected, walletRepo])

  return <>{children}</>
}
