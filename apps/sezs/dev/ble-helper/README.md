# SEZS usher BLE helper

Loopback-only desktop helper for the usher-device transport.

- Bind: `127.0.0.1:3061` (`SEZS_BLE_HELPER_PORT` to change).
- The SEZS page uses `LoopbackHelperTransport` against this process.
- A native GATT central (the existing KMS `ble-scan.swift` + `noise.go` pattern) should decrypt Noise XX and `POST /v1/ingest` the signed `SEZS-TICKET-FRAME-V1` text plus the ed25519 signature. This process does not speak Bluetooth itself.

```
node apps/sezs/dev/ble-helper/server.mjs
```
