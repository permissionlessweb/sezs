# CosmWasm schema IDL → cwgen (Marketplace M2)

Vendored **cosmwasm-schema** IDL (`idl_version: 1.0.0`) for Terp marketplace contracts.
These feed `@dao-dao/utils` `pnpm cwgen` / `@cosmwasm/ts-codegen` the same way as DaoCalendar (C2).

| Package | Schema path | cwgen name | Generated artifacts |
|---------|-------------|------------|---------------------|
| marketplace-mirror | `marketplace-mirror/schema/` | `MarketplaceMirror` | `types/contracts`, `state/contracts`, `state/query/...` |
| revenue/auction | `terp-auction/schema/` | `TerpAuction` | same |

## Regenerate TypeScript (dao-dao-ui)

From `websites/dao-dao-ui/packages/utils`:

```bash
pnpm cwgen -n MarketplaceMirror \
  -p ../types/schemas/marketplace-mirror \
  --no-indexer

pnpm cwgen -n TerpAuction \
  -p ../types/schemas/terp-auction \
  --no-indexer
```

`--no-indexer` is required until indexer formulas exist for these contracts.

## Regenerate Rust → JSON schema

### marketplace-mirror (self-contained workspace)

```bash
cd crates/terp-rs/contracts/hash-merchant/marketplace-mirror
cargo run --example schema
# writes schema/marketplace-mirror.json + schema/raw/*
cp -R schema/* \
  websites/dao-dao-ui/packages/types/schemas/marketplace-mirror/schema/
```

`examples/schema.rs` uses `cosmwasm_schema::write_api!` over `msg::{InstantiateMsg, ExecuteMsg, QueryMsg, SudoMsg}`.

### terp-auction (msg source of truth)

Msgs live in `crates/terp-rs/crates/marketplace/src/auction.rs`
(`terp_marketplace_utils::auction`). That crate is not always a workspace member;
regenerate via standalone schema crate (same shapes as `write_api!`):

```bash
# One-shot: copy auction.rs into a temp package with cosmwasm-schema 2.3.x,
# run write_api, copy schema/ → packages/types/schemas/terp-auction/schema/
# and crates/terp-rs/contracts/revenue/auction/schema/
```

Or, when `terp-marketplace-utils` is buildable in-workspace:

```bash
cargo run -p terp-marketplace-utils --example schema
```

Contract directory also keeps a copy at
`crates/terp-rs/contracts/revenue/auction/schema/terp-auction.json`.

## Import surface (FE)

```ts
import type {
  ExecuteMsg,
  QueryMsg,
  ProductResponse,
  PurchaseOrder,
  OrderStatus,
} from '@dao-dao/types/contracts/MarketplaceMirror'
import type {
  ExecuteMsg as AuctionExecuteMsg,
  QueryMsg as AuctionQueryMsg,
  AuctionResponse,
  AuctionType,
} from '@dao-dao/types/contracts/TerpAuction'

import {
  MarketplaceMirrorClient,
  MarketplaceMirrorQueryClient,
  TerpAuctionClient,
  TerpAuctionQueryClient,
} from '@dao-dao/state/contracts'

import {
  marketplaceMirrorQueries,
  terpAuctionQueries,
} from '@dao-dao/state/query'
```

## Known contract gaps (catalog)

- **marketplace-mirror** has `product { sku }` but **no `list_products`**. Catalog UI (M3) must discover SKUs via query plane / Nostr / curator-known list until a list query lands on-chain.
- **auction** has rich list queries (`auction_by_*`, `not_started_auction`, etc.).
