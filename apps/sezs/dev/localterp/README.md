# Local terpd for SEZS (loopback only)

Starts the latest `terpd` from `~/src/terp-core/build/terpd` with wasmvm, bound to `127.0.0.1`. This is a **local** network, not a public testnet.

```bash
# from build-host
apps/sezs/dev/localterp/start.sh
# after wasm artifacts exist
apps/sezs/dev/localterp/seed.sh
```

- Lab home: `<repo>/.localterp` (0700). Key-add output is 0600 and is never printed.
- LCD `http://127.0.0.1:1317`, RPC `http://127.0.0.1:26657`, chain id `sezs-local-1`.
- Front end: `http://127.0.0.1:3051/?contract=<addr>&lcd=http://127.0.0.1:1317&chainId=sezs-local-1`
- Boot file: `apps/sezs/dev/localterp/boot.json` (contract, lcd, chainId only).
- Does not upload the static front-end bundle.
