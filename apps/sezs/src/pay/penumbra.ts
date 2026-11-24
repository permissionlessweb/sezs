import { Instruct, PollResult, RailAdapter } from './types'
import { splashOn } from './invoice'

export const penumbra: RailAdapter = {
  id: 'penumbra',
  primary: splashOn() ? 'Make a Penumbra request' : '',
  quote: () =>
    splashOn()
      ? {
          label: 'Shielded Penumbra',
          price: '50% off',
          discount: '50%',
          live: true,
          note: 'Lab Penumbra destination and memo for Zafu. A destination on screen is not paid. Mainnet penumbra1 is refused. Do not send real funds.',
        }
      : {
          label: 'Shielded Penumbra',
          price: '50% off',
          discount: '50%',
          live: false,
          note: 'Coming, no SEZS watcher this round. Checkout opens soon.',
        },
  instruct: async (): Promise<Instruct> =>
    splashOn()
      ? { kind: 'not_live', text: 'Use the payment method panel. This adapter does not invent a destination.' }
      : { kind: 'not_live', text: 'Coming, no SEZS watcher this round. Not paid.' },
  poll: async (): Promise<PollResult> => ({
    status: splashOn() ? 'quoted' : 'not_live',
    message: splashOn()
      ? 'Check the payment panel. A destination on screen is not paid.'
      : 'Coming, no SEZS watcher this round. Not paid.',
  }),
}
