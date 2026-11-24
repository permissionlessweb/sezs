import { PaidOutlined, PaidRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { BountiesEditor as Editor } from './BountiesEditor'
import { BountiesRenderer as Renderer } from './BountiesRenderer'
import { BountiesModuleData } from './types'

/**
 * DAO Bounties — Terp fork of zec-bounties as an iframe embed.
 * Auth: ADR-36 membership + Mode A HKDF bounty identity (pubkey only to child).
 */
export const BountiesModule: Module<BountiesModuleData> = {
  id: ModuleId.Bounties,
  title: 'Bounties',
  description:
    'DAO-scoped ZEC bounties board. Members sign in with ADR-36; applications use HKDF-derived public identity keys.',
  Icon: PaidOutlined,
  IconFilled: PaidRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    description: '',
    embedBaseUrl: '',
    defaultView: 'members',
  },
  Renderer,
  Editor,
}

export type { BountiesModuleData } from './types'
export {
  DEFAULT_BOUNTIES_API,
  DEFAULT_BOUNTIES_EMBED,
  BOUNTIES_PROTOCOL_VERSION,
} from './constants'
export { buildBountiesEmbedUrl } from './BountiesRenderer'
