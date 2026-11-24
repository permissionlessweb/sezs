import { Instruct, PollResult, RailAdapter } from './types'

/** Guest browsers cannot reach loopback DREGG. No dest invented. */
export const base: RailAdapter = {
  id: 'base',
  primary: '',
  quote: () => ({
    label: 'Base (obfuscated)',
    price: 'list',
    discount: 'none',
    live: false,
    note: 'Checkout opens soon. Base-Sepolia (84532) only when wired — 8453 is refused. No transfer from this page.',
  }),
  instruct: async (): Promise<Instruct> => ({
    kind: 'not_live',
    text: 'Checkout opens soon. No Base dest from this page. Not paid.',
  }),
  poll: async (): Promise<PollResult> => ({
    status: 'not_live',
    message: 'Checkout opens soon. Not paid.',
  }),
}
