import { ComponentMeta, ComponentStory } from '@storybook/react'

import { AuthMethodChooser } from './AuthMethodChooser'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / AuthMethodChooser',
  component: AuthMethodChooser,
} as ComponentMeta<typeof AuthMethodChooser>

const Template: ComponentStory<typeof AuthMethodChooser> = (args) => (
  <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
    <AuthMethodChooser {...args} />
  </div>
)

const sampleMethods = [
  {
    id: 'passkey',
    label: 'Passkey / WebAuthn',
    description:
      'Local device credential for continuity; pair to a cosmos address.',
    availability: 'ready' as const,
    selectable: true,
  },
  {
    id: 'ocid_jwt',
    label: 'OCID / JWT bridge',
    description: 'Optional PFPK / OIDC invite deep-link.',
    availability: 'partial' as const,
    selectable: true,
  },
  {
    id: 'adr36_bounties',
    label: 'ADR-36 bounties session',
    description: 'signArbitrary membership proof for bounties embed.',
    availability: 'ready' as const,
    selectable: true,
  },
  {
    id: 'zcash_zecauth',
    label: 'Zcash Login — ZecAuth',
    description: 'Hackathon adapter spike. Flag-gated.',
    availability: 'disabled' as const,
    selectable: false,
    disabledReason: 'Set NEXT_PUBLIC_ENABLE_ZCASH_ZECAUTH=true',
  },
  {
    id: 'zcash_zecpass',
    label: 'Zcash Login — ZecPass',
    description: 'Stub until lab mode on.',
    availability: 'stub' as const,
    selectable: false,
    disabledReason: 'Lab mode off',
  },
]

export const Default = Template.bind({})
Default.args = {
  title: 'Auth methods',
  hint: 'Pick a method. Fund movement always needs an explicit second step.',
  methods: sampleMethods,
  focusedMethodId: 'passkey',
  onSelect: (id) => alert(`select ${id}`),
}

export const AllDisabled = Template.bind({})
AllDisabled.args = {
  title: 'Auth methods',
  hint: 'Connect a wallet for selectable paths.',
  methods: sampleMethods.map((m) => ({
    ...m,
    selectable: false,
    availability: 'disabled' as const,
  })),
  onSelect: () => undefined,
}

export const WithFlaggedAndPartial = Template.bind({})
WithFlaggedAndPartial.args = {
  title: 'Auth methods',
  hint: 'All availability chips visible.',
  methods: [
    {
      id: 'passkey',
      label: 'Passkey / WebAuthn',
      description: 'Ready path.',
      availability: 'ready' as const,
      selectable: true,
    },
    {
      id: 'ocid_jwt',
      label: 'OCID / JWT bridge',
      description: 'Partial path.',
      availability: 'partial' as const,
      selectable: true,
    },
    {
      id: 'smart_account',
      label: 'Smart account',
      description: 'Flagged experimental surface.',
      availability: 'flagged' as const,
      selectable: true,
    },
    {
      id: 'zcash_zecpass',
      label: 'ZecPass',
      description: 'Stub.',
      availability: 'stub' as const,
      selectable: false,
      disabledReason: 'Lab mode off',
    },
  ],
  focusedMethodId: 'smart_account',
  hideReadyBadge: false,
  onSelect: (id) => alert(`select ${id}`),
}
