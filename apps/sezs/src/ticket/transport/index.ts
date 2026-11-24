export * from './types'
export { animatedUrTransport } from './animated-ur'
export { printedRaptorqTransport, GRID as PRINTED_GRID } from './printed-raptorq'
export { nfcTransport } from './nfc'
import { animatedUrTransport } from './animated-ur'
import { printedRaptorqTransport } from './printed-raptorq'
import { nfcTransport } from './nfc'
import type { ProofTransport } from './types'

export const checkInTransports: ProofTransport[] = [
  animatedUrTransport,
  printedRaptorqTransport,
  nfcTransport,
]

export const defaultLiveTransport = animatedUrTransport
export const defaultPrintTransport = printedRaptorqTransport
