import { ComponentMeta, ComponentStory } from '@storybook/react'

import { SmartAccountAuthStage } from './SmartAccountAuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / SmartAccountAuthStage',
  component: SmartAccountAuthStage,
} as ComponentMeta<typeof SmartAccountAuthStage>

const Shell: ComponentStory<typeof SmartAccountAuthStage> = (args) => (
  <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
    <SmartAccountAuthStage {...args} />
  </div>
)

export const NeedWallet = Shell.bind({})
NeedWallet.args = {
  title: 'Smart account',
  state: 'need_wallet',
}

export const Unsupported = Shell.bind({})
Unsupported.args = {
  title: 'Smart account',
  state: 'unsupported',
}

export const Loading = Shell.bind({})
Loading.args = {
  title: 'Smart account',
  state: 'loading',
}

export const Ready = Shell.bind({})
Ready.args = {
  title: 'Smart account',
  state: 'ready',
  authenticatorCount: 2,
  selectedId: '0',
  highlighted: true,
}
