import { ReactNode } from 'react'
import { RecoilRoot } from 'recoil'

import { AuthProvider } from './auth/AuthContext'
import { BleProvider } from './ble/BleContext'

/** Auth kernel only. Do not import @dao-dao/stateful here — it OOMs Next compile. */
const ClientProviders = ({ children }: { children: ReactNode }) => (
  <RecoilRoot>
    <AuthProvider>
      <BleProvider>{children}</BleProvider>
    </AuthProvider>
  </RecoilRoot>
)

export default ClientProviders
