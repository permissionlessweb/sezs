import { ComponentMeta, ComponentStory } from '@storybook/react'

import { Adr36AuthStage } from './Adr36AuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / Adr36AuthStage',
  component: Adr36AuthStage,
} as ComponentMeta<typeof Adr36AuthStage>

const Shell: ComponentStory<typeof Adr36AuthStage> = (args) => (
  <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
    <Adr36AuthStage {...args} />
  </div>
)

export const NeedWallet = Shell.bind({})
NeedWallet.args = {
  title: 'ADR-36 bounties session',
  description:
    'Membership uses wallet signArbitrary (ADR-36). Fund/claim is a separate step.',
  statusLine: 'Connect an extension wallet first.',
}

export const WalletConnected = Shell.bind({})
WalletConnected.args = {
  title: 'ADR-36 bounties session',
  description:
    'Membership uses wallet signArbitrary (ADR-36). Fund/claim is a separate step.',
  statusLine:
    'Wallet connected — open Bounties module to complete membership proof.',
  highlighted: true,
}
