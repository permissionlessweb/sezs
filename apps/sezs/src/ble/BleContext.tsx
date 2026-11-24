import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { listDevices, type DeviceRecord } from './api'
import { describeTransport, TRANSPORTS } from './transport.mjs'
import { startVisibleInterval } from '../query/visibility'

type BleContextValue = {
  open: boolean
  openBle: () => void
  closeBle: () => void
  devices: DeviceRecord[]
  refresh: () => Promise<void>
  transportId: string
  transportNote: string
  setTransportId: (id: string) => void
}

const Ctx = createContext<BleContextValue | null>(null)

export const BleProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [transportId, setTransportId] = useState<string>(TRANSPORTS.loopbackHelper)

  const refresh = useCallback(async () => {
    try {
      setDevices(await listDevices())
    } catch {
      /* splash may be down during static render */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    return startVisibleInterval(() => void refresh(), 4000)
  }, [open, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('bleOpen') === '1' || params.get('bleShot') === '1') setOpen(true)
  }, [])

  const value = useMemo(
    () => ({
      open,
      openBle: () => setOpen(true),
      closeBle: () => setOpen(false),
      devices,
      refresh,
      transportId,
      transportNote: describeTransport(transportId),
      setTransportId,
    }),
    [open, devices, refresh, transportId],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useBle = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBle must be used in BleProvider')
  return ctx
}
