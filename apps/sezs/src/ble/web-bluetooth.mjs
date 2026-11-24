/**
 * Optional Web Bluetooth transport (Chrome desktop, in the SEZS page,
 * not inside the Zafu extension).
 *
 * Honest status for v1: this is not the local demo default. Chrome on
 * macOS can act as a GATT central, but background reconnect and a
 * multi-usher mesh are what the native helper already does, and a
 * production path still needs Noise XX under the characteristic. This
 * module feature-detects `navigator.bluetooth` and exposes the same
 * Transport shape so it can be filled in later without touching the
 * modal or the consume chain.
 */
import { SERVICE_UUID, TICKET_UUID, TRANSPORTS } from './transport.mjs'

export const webBluetoothAvailable = () =>
  typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function'

export const createWebBluetoothTransport = () => ({
  id: TRANSPORTS.webBluetooth,
  available: webBluetoothAvailable(),
  scan: async () => {
    if (!webBluetoothAvailable()) {
      throw new Error('web_bluetooth_unavailable')
    }
    // Intentionally not the demo path. A later change can request the
    // SEZS service UUID here, open a Noise XX session, and emit frames.
    throw new Error('web_bluetooth_not_demo_path')
  },
  connect: async () => {
    throw new Error('web_bluetooth_not_demo_path')
  },
  stop: async () => {},
  serviceUuid: SERVICE_UUID,
  ticketUuid: TICKET_UUID,
})
