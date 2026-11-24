import { Rail } from '../auth/types'
import { PollResult, Quote, RailAdapter } from './types'

const dead = (id: Rail, quote: Quote, text: string): RailAdapter => ({
  id,
  quote: () => quote,
  primary: '',
  instruct: async () => ({ kind: 'not_live', text }),
  poll: async (): Promise<PollResult> => ({
    status: 'not_live',
    message: text,
  }),
})

/** BTC stays named, not on the tickets catalog this round. */
export const btc = dead(
  'btc',
  {
    label: 'Bitcoin (obfuscated)',
    price: '20% off deposit',
    discount: '20%',
    live: false,
    note: 'DREGG HD dest (svg-mint). Not on /tickets this round. Not live.',
  },
  'Not on pre-arrival checkout this round. No transfer from this page.'
)
