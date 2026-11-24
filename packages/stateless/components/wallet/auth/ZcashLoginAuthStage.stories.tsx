import { ComponentMeta, ComponentStory } from '@storybook/react'

import { ZcashLoginAuthStage } from './ZcashLoginAuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / ZcashLoginAuthStage',
  component: ZcashLoginAuthStage,
} as ComponentMeta<typeof ZcashLoginAuthStage>

const Shell: ComponentStory<typeof ZcashLoginAuthStage> = (args) => (
  <div className="max-w-md space-y-3 rounded-lg border border-border-base bg-background-base p-4">
    <ZcashLoginAuthStage {...args} />
  </div>
)

const adapters = [
  {
    id: 'zcash_zecauth',
    label: 'ZecAuth',
    summary: 'Auth-isolated cosmos signArbitrary stand-in.',
  },
  {
    id: 'zcash_zns_login',
    label: 'zns-login',
    summary: 'Name-service shaped lab adapter.',
  },
  {
    id: 'zcash_zecpass',
    label: 'ZecPass',
    summary: 'Passkey-adjacent lab stub.',
  },
]

export const WalletDisconnected = Shell.bind({})
WalletDisconnected.args = {
  title: 'Zcash Login lab adapters',
  description:
    'Flag-gated. Uses cosmos signArbitrary as auth-isolated stand-in — never seeds or UFVKs.',
  experimentalNote:
    'ZecAuth / zns-login / ZecPass stay behind NEXT_PUBLIC_ENABLE_ZCASH_* flags.',
  adapters,
  walletConnected: false,
  onRunAdapter: (id) => alert(id),
}

export const WalletConnectedBusy = Shell.bind({})
WalletConnectedBusy.args = {
  ...WalletDisconnected.args,
  walletConnected: true,
  busy: true,
  focusedAdapterId: 'zcash_zecauth',
  highlighted: true,
}

export const WithCapabilityJson = Shell.bind({})
WithCapabilityJson.args = {
  ...WalletDisconnected.args,
  walletConnected: true,
  highlighted: true,
  capabilityJson: JSON.stringify(
    {
      adapter: 'zcash_zecauth',
      scopes: ['identify', 'bounties_view'],
      note: 'lab grant only',
    },
    null,
    2
  ),
}
