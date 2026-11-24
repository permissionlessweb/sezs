import { AuthSession } from '../auth/types'
import { LIST_CENTS } from './price'
import { Instruct, RailAdapter } from './types'

/**
 * Cash App is door-only (tickets pivot).
 * Kept as an adapter so paid evidence / rail id stay typed, but quote().live
 * is false and instruct/poll refuse — /tickets must not present this rail.
 *
 * MOCK / LAB: receipt JSON under public/cashapp/receipts is a labeled lab
 * path for door tooling. It is not a tickets settlement writer. Do not call
 * this adapter from CheckoutPanel.
 */
export const cashapp: RailAdapter = {
  id: 'cashapp',
  primary: '',
  quote: () => ({
    label: 'Cash App',
    price: `$${(LIST_CENTS / 100).toFixed(2)} door`,
    discount: 'none',
    live: false,
    note: 'Door only. QR lives on Admin (and crew pages), not pre-arrival checkout.',
  }),
  instruct: async (_session: AuthSession): Promise<Instruct> => ({
    kind: 'not_live',
    text: 'Door only. No pre-arrival Cash App checkout. See Admin QR.',
  }),
  poll: async () => ({
    status: 'not_live',
    message:
      'Cash App is door-only. Receipt poll is not a tickets paid writer. Not paid.',
  }),
}
