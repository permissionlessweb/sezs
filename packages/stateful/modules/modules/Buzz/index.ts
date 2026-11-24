import { ForumOutlined, ForumRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { BuzzEditor as Editor } from './BuzzEditor'
import { BuzzRenderer as Renderer } from './BuzzRenderer'
import { BuzzModuleData } from './types'

/**
 * DAO Buzz — community coordination iframe (terp-buzz/v1).
 * Primary identity: Nostr in child. Optional parent ADR-36 daoAttest for room gates.
 * EN-F2: prefer **Collab & Ops** (`collab_ops`) for visitors; keep this shell for embeds / Event Hub.
 */
export const BuzzModule: Module<BuzzModuleData> = {
  id: ModuleId.Buzz,
  title: 'Buzz',
  description:
    'Public Buzz embed shell (prefer Collab & Ops tab for visitors). Nostr session stays in the embed; optional DAO membership attest for gated rooms.',
  Icon: ForumOutlined,
  IconFilled: ForumRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    description: '',
    embedBaseUrl: '',
    defaultView: 'public',
    enableDaoAttest: true,
  },
  Renderer,
  Editor,
}

export type { BuzzModuleData } from './types'
export {
  DEFAULT_BUZZ_EMBED,
  BUZZ_PROTOCOL_VERSION,
  buildBuzzDaoAttestMessage,
} from './constants'
export { buildBuzzEmbedUrl } from './embedUrl'
