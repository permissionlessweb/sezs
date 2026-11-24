import { Key } from '@mui/icons-material'
import { ComponentMeta, ComponentStory } from '@storybook/react'

import { Button } from '../../buttons'
import { AuthMethodPanel } from './AuthMethodPanel'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / AuthMethodPanel',
  component: AuthMethodPanel,
} as ComponentMeta<typeof AuthMethodPanel>

const Shell: ComponentStory<typeof AuthMethodPanel> = (args) => (
  <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
    <AuthMethodPanel {...args} />
  </div>
)

export const Default = Shell.bind({})
Default.args = {
  Icon: Key,
  title: 'Example stage',
  description: 'Secondary description using Clear secondary-text tokens.',
  footer: 'Tertiary footer caption.',
  children: (
    <div className="flex flex-row gap-2">
      <Button size="sm" variant="secondary">
        Secondary
      </Button>
      <Button size="sm" variant="primary">
        Primary
      </Button>
    </div>
  ),
}

export const Highlighted = Shell.bind({})
Highlighted.args = {
  ...Default.args,
  highlighted: true,
  title: 'Focused stage',
  description: 'Chooser selection applies ring-border-interactive-focus.',
}
