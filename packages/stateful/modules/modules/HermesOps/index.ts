import { DnsOutlined, DnsRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { HermesOpsEditor as Editor } from './HermesOpsEditor'
import { HermesOpsRenderer as Renderer } from './HermesOpsRenderer'
import { HermesOpsModuleData } from './types'

/**
 * DAO Hermes Ops — internal operator surface (terp-hermes/v1 or deep-link).
 * Tab visibility: OnlyMembers. Secrets stay Hermes-native.
 * EN-F2: prefer **Collab & Ops** (`collab_ops`) private plane for visitors; keep this shell for embeds / Event Hub.
 */
export const HermesOpsModule: Module<HermesOpsModuleData> = {
  id: ModuleId.HermesOps,
  title: 'Hermes Ops',
  description:
    'Hermes ops embed/deep-link shell (prefer Collab & Ops private plane for visitors). Hidden from non-members; deep-link fallback when no embed UI exists.',
  Icon: DnsOutlined,
  IconFilled: DnsRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    description: '',
    embedBaseUrl: '',
    defaultView: 'kanban',
    requireAdmin: true,
    // Honest phase-0 fallback until Hermes ships embeddable HTTP UI.
    deepLinkOnly: true,
    deepLinkUrl: '',
  },
  Renderer,
  Editor,
}

export type { HermesOpsModuleData } from './types'
export {
  DEFAULT_HERMES_EMBED,
  DEFAULT_HERMES_DEEP_LINK,
  HERMES_PROTOCOL_VERSION,
} from './constants'
export {
  buildHermesOpsEmbedUrl,
  resolveHermesShellMode,
  shouldUseDeepLinkOnly,
} from './embedUrl'
