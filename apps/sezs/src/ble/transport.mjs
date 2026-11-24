/**
 * Transport interface for usher-device radios.
 *
 * A Transport is a byte/session factory. BLE is the first radio. The
 * local demo uses a loopback helper (LoopbackHelperTransport) talking to
 * a process on 127.0.0.1; tests and the modal preview use
 * SimulatedTransport. Web Bluetooth is a third implementation so both
 * radios fit, but it is not the demo default (see web-bluetooth.mjs).
 *
 * A Session is already past pairing: it exposes the device sign pubkey
 * and (optional) Noise static that the admin grant binds.
 *
 *   scan() -> FoundDevice[]
 *   connect(hint) -> Session
 *   Session.nextFrame() / onFrame
 *   Session.close()
 */
export const TRANSPORTS = Object.freeze({
  simulated: 'simulated',
  loopbackHelper: 'loopback-helper',
  webBluetooth: 'web-bluetooth',
})

export const SERVICE_UUID = 'e7c8a1b0-4f3e-4c2a-9b6d-6b6d73000001'
export const TICKET_UUID = 'e7c8a1b0-4f3e-4c2a-9b6d-6b6d73000008'

/** Default helper bind. Loopback only. */
export const DEFAULT_HELPER = 'http://127.0.0.1:3061'

export const describeTransport = (id) => {
  if (id === TRANSPORTS.simulated) {
    return 'Simulated loopback transport for tests and for previewing the modal without a radio.'
  }
  if (id === TRANSPORTS.loopbackHelper) {
    return 'Native helper on loopback (recommended demo path). The helper holds the GATT central and Noise XX session; the page reads signed frames from 127.0.0.1.'
  }
  if (id === TRANSPORTS.webBluetooth) {
    return 'Optional Web Bluetooth central in Chrome. Not the local demo default: macOS support is uneven, there is no background reconnect, and the Noise client would live in the tab.'
  }
  return id
}
