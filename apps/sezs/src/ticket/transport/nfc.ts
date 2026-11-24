/** NFC transport stub. Interface only — not employed until further support. */
import {
  ProofBundle,
  ProofTransport,
  PresentHandle,
  TransportFrame,
  TransportNotImplemented,
} from './types'

export const nfcTransport: ProofTransport = {
  id: 'nfc',
  label: 'NFC (not available yet)',
  implemented: false,
  async present(_bundle: ProofBundle): Promise<PresentHandle> {
    throw new TransportNotImplemented('nfc')
  },
  async collect(_frames: TransportFrame[]): Promise<ProofBundle> {
    throw new TransportNotImplemented('nfc')
  },
}
