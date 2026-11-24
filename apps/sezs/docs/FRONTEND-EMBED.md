# Statically embedding the SEZS event front end

The front end is a reusable static app: it takes a contract address and
chain config (`lcd`, `chainId`) and renders the `EventView` (`sezs-event-v2`)
from that contract, or an optional off-chain `metadata_uri` whose SHA-256
is `metadata_hash`. There is no hardcoded night, bill, or price in the UI
path.

`just build` (or `pnpm --filter @sezs/app build`) writes `apps/sezs/out/`
with `output: 'export'`. The bundle has no server runtime. Boot parameters
are query-string values: `?contract=&lcd=&chainId=`.

A later CosmWasm object-store for the HTML/JS bundle is optional and not
part of the default build.
