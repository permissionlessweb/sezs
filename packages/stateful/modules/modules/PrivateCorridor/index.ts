import { ShieldOutlined, ShieldRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { PrivateCorridorEditor as Editor } from './PrivateCorridorEditor'
import { PrivateCorridorRenderer as Renderer } from './PrivateCorridorRenderer'
import { PrivateCorridorModuleData } from './types'

/**
 * PrivateCorridor — production Private Bridge surface for DAO deployments.
 *
 * Exercises real environment functions: browser HD deposit wallet (SelfRelay
 * generate pattern), P2WPKH BTC QR, client proof + auth link, mint-router /
 * notes / oracle bases. Not a mock film — lab_simulated is explicit CI-only.
 *
 * SPEC: docs/plans/spectrum/DEMO-CASHAPP-ZEC-CORRIDOR.md
 * Operator: ./OPERATOR.md (hash-market + optional Zakura D6)
 */
export const PrivateCorridorModule: Module<PrivateCorridorModuleData> = {
  id: ModuleId.PrivateCorridor,
  title: 'Private Bridge',
  description:
    'Production corridor: preauth ZEC dest, browser-generated BTC deposit wallet + QR, auth link after client proof, private bridge → ZEC under oracle bounds.',
  Icon: ShieldOutlined,
  IconFilled: ShieldRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) => chainId === ChainId.TerpMainnet,
  defaultValues: {
    headstashContract: '',
    notesBase: '',
    oracleBase: '',
    corridorId: 'cashapp-btc-zec-v0',
    assetBackend: 'production',
    btcNetwork: 'mainnet',
    esploraBase: '',
    notesHsId: '',
    preferPirRecover: true,
    description: '',
  },
  Renderer,
  Editor,
}

export type {
  BtcNetwork,
  CorridorAssetBackend,
  CorridorReceipt,
  CorridorWizardDraft,
  CorridorWizardStep,
  DepositIntentV0,
  OracleBoundPolicy,
  PrivateCorridorModuleData,
} from './types'
