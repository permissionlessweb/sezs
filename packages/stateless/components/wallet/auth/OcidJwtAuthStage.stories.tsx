import { ComponentMeta, ComponentStory } from '@storybook/react'

import { OcidJwtAuthStage } from './OcidJwtAuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / OcidJwtAuthStage',
  component: OcidJwtAuthStage,
} as ComponentMeta<typeof OcidJwtAuthStage>

const Shell: ComponentStory<typeof OcidJwtAuthStage> = (args) => (
  <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
    <OcidJwtAuthStage {...args} />
  </div>
)

const base = {
  title: 'OCID / JWT session',
  openOnboardingLabel: 'Onboarding invite (optional)',
  onOpenOnboarding: () => alert('onboarding'),
  connectHint:
    'Optional: open an onboarding invite — wallet connect does not require it.',
}

export const ConnectNone = Shell.bind({})
ConnectNone.args = {
  ...base,
  status: 'none',
  showSessionDetail: false,
}

export const SessionReady = Shell.bind({})
SessionReady.args = {
  ...base,
  status: 'session',
  showSessionDetail: true,
  detail: '2 PFPK / JWT token(s) on this profile',
  highlighted: true,
}

export const SessionUnknown = Shell.bind({})
SessionUnknown.args = {
  ...base,
  status: 'unknown',
  showSessionDetail: true,
}

export const SessionError = Shell.bind({})
SessionError.args = {
  ...base,
  status: 'error',
  showSessionDetail: true,
  detail: 'Could not refresh session tokens.',
}
