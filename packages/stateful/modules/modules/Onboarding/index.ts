import { PersonAddAlt1Outlined, PersonAddAlt1Rounded } from '@mui/icons-material'

import {
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'
import { DEFAULT_GIFT_PREAUTH_ACTIONS } from '@dao-dao/utils'

import { OnboardingEditor as Editor } from './OnboardingEditor'
import { OnboardingRenderer as Renderer } from './OnboardingRenderer'
import { OnboardingModuleData } from './types'

export const OnboardingModule: Module<OnboardingModuleData> = {
  id: ModuleId.Onboarding,
  title: 'Gift accounts',
  description:
    'Share one-time gift / onboarding links for fresh wallets (PFPK / OIDC, passkey bind). Optional feegrant preauth pays gas only for actions you select — not airdrop funding or unlimited grants.',
  Icon: PersonAddAlt1Outlined,
  IconFilled: PersonAddAlt1Rounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  defaultValues: {
    description:
      'Invite people with a one-time gift link. They generate a fresh wallet, bind a passkey, and migrate to a durable account. Sponsors can preauthorize gas (feegrant) for selected actions only.',
    defaultAuthPlane: 'pfpk',
    autoMigrate: true,
    inviteTtlDays: 7,
    defaultPreauthActions: [...DEFAULT_GIFT_PREAUTH_ACTIONS],
    defaultFeegrantSpendDenom: 'uterp',
    feegrantTtlDays: 30,
  },
  Renderer,
  Editor,
}
