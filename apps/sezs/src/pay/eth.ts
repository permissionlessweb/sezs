import { Instruct, PollResult, RailAdapter } from './types'

/** Guest browsers cannot reach loopback DREGG. No dest invented. */
export const eth: RailAdapter = {
  id: 'eth',
  primary: '',
  quote: () => ({
    label: 'Ether (obfuscated)',
    price: '20% off deposit',
    discount: '20%',
    live: false,
    note: 'Checkout opens soon. Sepolia (11155111) only when wired — chain id 1 is refused. No transfer from this page.',
  }),
  instruct: async (): Promise<Instruct> => ({
    kind: 'not_live',
    text: 'Checkout opens soon. No ETH dest from this page. Not paid.',
  }),
  poll: async (): Promise<PollResult> => ({
    status: 'not_live',
    message: 'Checkout opens soon. Not paid.',
  }),
}
