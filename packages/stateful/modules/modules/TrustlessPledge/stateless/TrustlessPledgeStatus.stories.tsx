import { ComponentMeta, ComponentStory } from '@storybook/react'

import { TrustlessPledgeStatus } from './TrustlessPledgeStatus'

export default {
  title:
    'DAO DAO / packages / stateful / modules / modules / TrustlessPledge / TrustlessPledgeStatus',
  component: TrustlessPledgeStatus,
} as ComponentMeta<typeof TrustlessPledgeStatus>

const Template: ComponentStory<typeof TrustlessPledgeStatus> = (args) => (
  <div className="max-w-xl p-4">
    <TrustlessPledgeStatus {...args} />
  </div>
)

export const Disconnected = Template.bind({})
Disconnected.args = {
  connected: false,
  collectionConfigured: true,
  manifestoCid: 'bafyexample',
  pledgeDocUrl: 'https://docs.fileverse.io/example',
  teamNote: 'Team commitment first; open mint for demos.',
}

export const NotPledged = Template.bind({})
NotPledged.args = {
  connected: true,
  collectionConfigured: true,
  hasPledged: false,
  manifestoCid: 'bafyexample',
  pledgeDocUrl: 'https://docs.fileverse.io/example',
}

export const Pledged = Template.bind({})
Pledged.args = {
  connected: true,
  collectionConfigured: true,
  hasPledged: true,
  tokenId: '42',
  mintCount: 1,
  manifestoCid: 'bafyexample',
  pledgeDocUrl: 'https://docs.fileverse.io/example',
}

export const Loading = Template.bind({})
Loading.args = {
  connected: true,
  collectionConfigured: true,
  loading: true,
}

export const Unconfigured = Template.bind({})
Unconfigured.args = {
  connected: true,
  collectionConfigured: false,
}
