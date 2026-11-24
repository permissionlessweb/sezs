import { ReactNode } from 'react'
import { RecoilRoot } from 'recoil'

import { AuthProvider } from './auth/AuthContext'
import { BleProvider } from './ble/BleContext'

/** Auth kernel only. Keep this module free of heavy UI-state graphs. */
const ClientProviders = ({ children }: { children: ReactNode }) => (
  <RecoilRoot>
    <AuthProvider>
      <BleProvider>{children}</BleProvider>
    </AuthProvider>
  </RecoilRoot>
)

export default ClientProviders
