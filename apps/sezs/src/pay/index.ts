import { Rail } from '../auth/types'
import { base } from './base'
import { eth } from './eth'
import { penumbra } from './penumbra'
import { RailAdapter } from './types'
import { zec } from './zec'

/**
 * Pre-arrival catalog. Order: shielded ZEC, ETH, Base, shielded Penumbra.
 * Door pay is a separate Admin module — not imported here.
 */
export const ADAPTERS: RailAdapter[] = [zec, eth, base, penumbra]

export const adapterFor = (id: Rail) => ADAPTERS.find((a) => a.id === id)

export const rails = () => ADAPTERS.map((a) => ({ id: a.id, ...a.quote() }))

export type { Instruct, PollResult, Quote, RailAdapter } from './types'
export { instructIsWaiting } from './types'
