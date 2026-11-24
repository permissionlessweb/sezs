import { HowToVoteOutlined, HowToVoteRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { DEFAULT_SHIELDED_VOTE_VALUES } from './constants'
import { ShieldedVoteEditor as Editor } from './ShieldedVoteEditor'
import { ShieldedVoteRenderer as Renderer } from './ShieldedVoteRenderer'
import { ShieldedVoteModuleData } from './types'

/**
 * ShieldedVote — vote-sdk privacy-preserving cast UX.
 *
 * Client-side ElGamal under ea_pk (V-UI-1 wasm). Fail-closed without encrypt.
 * Distinct from VoteDelegation (standard DAO delegation) and PrivateCorridor.
 *
 * Handoff: docs/research/HANDOFF-DAO-DAO-UI-VOTE-SDK-PRIVACY-CAST.md
 */
export const ShieldedVoteModule: Module<ShieldedVoteModuleData> = {
  id: ModuleId.ShieldedVote,
  title: 'Shielded Vote',
  description:
    'Privacy-preserving ballot cast: encrypt under election authority key in-browser (vote-sdk ElGamal). Plaintext never sent for encrypt.',
  Icon: HowToVoteOutlined,
  IconFilled: HowToVoteRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet ||
    chainId === ChainId.TerpTestnet ||
    chainId === '120u-1',
  defaultValues: { ...DEFAULT_SHIELDED_VOTE_VALUES },
  Renderer,
  Editor,
}

export type {
  ShieldedVoteModuleData,
  ShieldedCastUiStatus,
  ShieldedCastUiState,
} from './types'
export {
  DEFAULT_SHIELDED_VOTE_VALUES,
  DEFAULT_SHIELDED_CHOICES,
  parseShieldedChoices,
} from './constants'
export {
  encryptAndBuildCastBody,
  submitCastStub,
  submitShieldedCast,
} from './castBody'
export {
  DEFAULT_DEV_LIFECYCLE_PHASE,
  LOCAL_CAST_PIPELINE_STEPS,
  ROUND_LIFECYCLE_STEPS,
  mapUiStatusToLocalCastStep,
  railStepVisual,
} from './roundLifecycle'
export type {
  LocalCastPipelineStep,
  RoundLifecyclePhase,
  RoundLifecycleStep,
} from './roundLifecycle'
export { RoundStatusVisualizer } from './RoundStatusVisualizer'
