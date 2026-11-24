import { ComponentMeta, ComponentStory } from '@storybook/react'

import type { AuthMethodAvailability } from '@dao-dao/utils'

import { AuthAvailabilityBadge } from './AuthAvailabilityBadge'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / AuthAvailabilityBadge',
  component: AuthAvailabilityBadge,
} as ComponentMeta<typeof AuthAvailabilityBadge>

const all: AuthMethodAvailability[] = [
  'ready',
  'partial',
  'flagged',
  'disabled',
  'stub',
]

export const AllVariants: ComponentStory<typeof AuthAvailabilityBadge> = () => (
  <div className="flex flex-row flex-wrap gap-2 bg-background-base p-4">
    {all.map((a) => (
      <AuthAvailabilityBadge key={a} availability={a} />
    ))}
  </div>
)
