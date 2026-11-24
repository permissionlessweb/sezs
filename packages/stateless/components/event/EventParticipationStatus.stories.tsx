import { ComponentMeta, ComponentStory } from '@storybook/react'

import {
  EventParticipationStatus,
  ParticipationChip,
} from './EventParticipationStatus'

export default {
  title:
    'DAO DAO / packages / stateless / components / event / EventParticipationStatus',
  component: EventParticipationStatus,
} as ComponentMeta<typeof EventParticipationStatus>

const notRegistered: ParticipationChip[] = [
  {
    id: 'connected',
    label: 'Connected',
    state: 'ok',
    detail: 'Wallet connected',
  },
  { id: 'member', label: 'Member', state: 'ok', detail: 'DAO member' },
  {
    id: 'registered',
    label: 'Registered',
    state: 'muted',
    detail: 'Not registered',
  },
  {
    id: 'can_vote',
    label: 'Can vote',
    state: 'unknown',
    detail: 'Vote eligibility unknown',
  },
  { id: 'bounty', label: 'Bounty ID', state: 'muted' },
  { id: 'buzz', label: 'Buzz access', state: 'muted' },
  { id: 'hermes_path', label: 'Hermes path', state: 'unknown' },
  { id: 'router', label: 'Router circuit', state: 'unknown' },
]

const registered: ParticipationChip[] = notRegistered.map((c) =>
  c.id === 'registered' ||
  c.id === 'can_vote' ||
  c.id === 'bounty' ||
  c.id === 'buzz' ||
  c.id === 'hermes_path' ||
  c.id === 'router'
    ? { ...c, state: 'ok' as const }
    : c
)

const disconnected: ParticipationChip[] = [
  {
    id: 'connected',
    label: 'Connected',
    state: 'muted',
    detail: 'Connect a wallet',
  },
  { id: 'member', label: 'Member', state: 'unknown' },
  {
    id: 'registered',
    label: 'Registered',
    state: 'unknown',
    detail: 'Registration status unknown',
  },
  { id: 'can_vote', label: 'Can vote', state: 'unknown' },
  { id: 'bounty', label: 'Bounty ID', state: 'muted' },
  { id: 'buzz', label: 'Buzz access', state: 'muted' },
]

const warnBounty: ParticipationChip[] = [
  ...notRegistered.slice(0, 4),
  {
    id: 'bounty',
    label: 'Bounty ID',
    state: 'warn',
    detail: 'Bounty surface degraded',
  },
  { id: 'buzz', label: 'Buzz access', state: 'muted' },
]

const Template: ComponentStory<typeof EventParticipationStatus> = (args) => (
  <div className="max-w-lg rounded-md border border-border-primary bg-background-tertiary p-4">
    <EventParticipationStatus {...args} />
  </div>
)

export const NotRegisteredWithCta = Template.bind({})
NotRegisteredWithCta.args = {
  chips: notRegistered,
  onRegisterClick: () => undefined,
  registerLabel: 'Register',
}

export const RegisteredNoCta = Template.bind({})
RegisteredNoCta.args = {
  chips: registered,
  onRegisterClick: () => undefined,
}

export const WalletDisconnected = Template.bind({})
WalletDisconnected.args = {
  chips: disconnected,
  onRegisterClick: () => undefined,
}

export const WarnChip = Template.bind({})
WarnChip.args = {
  chips: warnBounty,
  onRegisterClick: () => undefined,
}

export const AllStatesSideBySide: ComponentStory<
  typeof EventParticipationStatus
> = () => (
  <div className="flex flex-col gap-6 bg-background-base p-4">
    <div>
      <p className="secondary-text mb-2 text-xs">Not registered + Register CTA</p>
      <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
        <EventParticipationStatus
          chips={notRegistered}
          onRegisterClick={() => undefined}
        />
      </div>
    </div>
    <div>
      <p className="secondary-text mb-2 text-xs">Registered (CTA hidden)</p>
      <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
        <EventParticipationStatus
          chips={registered}
          onRegisterClick={() => undefined}
        />
      </div>
    </div>
    <div>
      <p className="secondary-text mb-2 text-xs">Fail-closed disconnected</p>
      <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
        <EventParticipationStatus
          chips={disconnected}
          onRegisterClick={() => undefined}
        />
      </div>
    </div>
    <div>
      <p className="secondary-text mb-2 text-xs">Warn state</p>
      <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
        <EventParticipationStatus
          chips={warnBounty}
          onRegisterClick={() => undefined}
        />
      </div>
    </div>
  </div>
)
