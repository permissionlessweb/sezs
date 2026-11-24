import { Instruct, PollResult, RailAdapter } from './types'
import { splashOn } from './invoice'

/** Guest browsers cannot invent a dest. Lab invoices come from the splash watcher. */
export const zec: RailAdapter = {
  id: 'zec',
  primary: splashOn() ? 'Make a ZEC request for Zafu' : '',
  quote: () =>
    splashOn()
      ? {
          label: 'Shielded ZEC',
          price: '50% off',
          discount: '50%',
          live: true,
          note: 'Lab / testnet ZIP-321 only. The memo carries the ticket commitment. A URI on screen is not paid. Mainnet UAs are refused. Do not send real funds.',
        }
      : {
          label: 'Shielded ZEC',
          price: '50% off',
          discount: '50%',
          live: false,
          note: 'Checkout opens soon. Testnet and regtest only when wired. Mainnet UAs are refused. No transfer from this page.',
        },
  instruct: async (): Promise<Instruct> =>
    splashOn()
      ? {
          kind: 'not_live',
          text: 'Use the payment method panel. This adapter does not invent a zcash: URI.',
        }
      : {
          kind: 'not_live',
          text: 'Checkout opens soon. No zcash: URI from this page. Not paid.',
        },
  poll: async (): Promise<PollResult> => ({
    status: splashOn() ? 'quoted' : 'not_live',
    message: splashOn()
      ? 'Check the payment panel. A URI on screen is not paid.'
      : 'Checkout opens soon. Not paid.',
  }),
}
