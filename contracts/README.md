# SEZS contracts

In-repo CosmWasm contracts, built with terp-optimizer (`just optimize`).

- `cw-event-manifold` — event coordinator (Apache-2.0)
- `packages/sezs-ticket-v2-verify` — ConsumeTicket v2 door verification library

Optimized wasm and `checksums.txt` land in `artifacts/`.

External contracts used by the deploy suite are **not** vendored here.
See `docs/BUILD.md` for pins and environment variables:

- [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave) (`cw-ave`, `cw-ave-factory`, `cw420`)
- [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts) (DAO DAO core modules and `dao-calendar`)
- [permissionlessweb/terp-rs](https://github.com/permissionlessweb/terp-rs) (`terp-beacon`, `nftfi-raffle`)
