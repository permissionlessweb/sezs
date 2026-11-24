import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'

import '../src/ui/ui.css'

/**
 * Standalone SEZS app: no SdaLayout, no getServerSideProps.
 * Wallet/state packages load client-only so `next export` stays static.
 */
const ClientProviders = dynamic(() => import('../src/ClientProviders'), {
  ssr: false,
})

const App = ({ Component, pageProps }: AppProps) => (
  <ClientProviders>
    <Component {...pageProps} />
  </ClientProviders>
)

export default App
