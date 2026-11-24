import { VerifiedOutlined, VerifiedRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import {
  DEFAULT_IPFS_GATEWAY,
  DEFAULT_PLEDGE_DOC_URL,
  DEFAULT_PLEDGE_SITE_URL,
  DEFAULT_SIGN_DOMAIN,
  TERP_MAINNET_CW721_SVG,
  TERP_MAINNET_SVG_MINTER,
  TERP_TESTNET_CW721_SVG,
  TERP_TESTNET_SVG_MINTER,
} from './constants'
import { TrustlessPledgeEditor as Editor } from './TrustlessPledgeEditor'
import { TrustlessPledgeRenderer as Renderer } from './TrustlessPledgeRenderer'
import { TrustlessPledgeModuleData } from './types'

const mainnetDefaults: TrustlessPledgeModuleData = {
  collection: TERP_MAINNET_CW721_SVG,
  minter: TERP_MAINNET_SVG_MINTER,
  manifestoCid: '',
  ipfsGateway: DEFAULT_IPFS_GATEWAY,
  pledgeDocUrl: DEFAULT_PLEDGE_DOC_URL,
  pledgeSiteUrl: DEFAULT_PLEDGE_SITE_URL,
  signDomain: DEFAULT_SIGN_DOMAIN,
  digestAlg: 'blake2b256',
  projectId: '',
  // JSON string so the module editor TextArea shows editable text.
  commitments: '[]',
  authHrp: 'terp',
  onePerWallet: true,
  buttonLabel: 'Sign & mint pledge',
  teamNote:
    'Team first—then open mint so anyone can try the flow with real wallet auth.',
  description:
    'A public commitment to build without hidden backdoors. Read the pledge on permissionless.money, then sign with your wallet and mint an on-chain NFT anyone can verify.',
}

/** Testnet `120u-1` config slots (empty until collection is deployed). */
export const testnetDefaults: TrustlessPledgeModuleData = {
  ...mainnetDefaults,
  collection: TERP_TESTNET_CW721_SVG,
  minter: TERP_TESTNET_SVG_MINTER || undefined,
}

export const TrustlessPledgeModule: Module<TrustlessPledgeModuleData> = {
  id: ModuleId.TrustlessPledge,
  title: 'Trustlessness Pledge',
  description:
    'Team-first integrity pledge NFT: ADR-032 over manifesto/project/commitments, authenticated mint, hasPledged from chain.',
  Icon: VerifiedOutlined,
  IconFilled: VerifiedRounded,
  location: ModuleDisplayLocation.Home,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: mainnetDefaults,
  Renderer,
  Editor,
}

export type { TrustlessPledgeModuleData, HasPledgedResult } from './types'
export {
  TERP_MAINNET_CW721_SVG,
  TERP_MAINNET_SVG_MINTER,
  TERP_TESTNET_CW721_SVG,
  TERP_TESTNET_SVG_MINTER,
  DEFAULT_PLEDGE_DOC_URL,
  DEFAULT_PLEDGE_SITE_URL,
} from './constants'
export { hasPledgedQueries, fetchHasPledged } from './hasPledged'
