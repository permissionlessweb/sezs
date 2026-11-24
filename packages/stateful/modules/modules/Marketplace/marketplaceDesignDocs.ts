/**
 * In-app design docs for Marketplace “?” help modal (P1 UX).
 * Keep operator-facing and product-honest: chain settles, Nostr progressive.
 */
export const MARKETPLACE_DESIGN_DOCS_MD = `
# DAO Marketplace — design overview

A Terp DAO marketplace curates **fixed-price inventory** (\`marketplace-mirror\`) and **NFT auctions** (\`revenue/auction\`). Discovery uses **\`mesh.v1\`**. Catalog is **HTTP / chain first**; **Nostr is progressive** and never finalizes purchases.

## Three planes

| Plane | Authority | Role |
|-------|-----------|------|
| **Chain** | Money + stock | Purchase, settle, bid, buffer escrow |
| **mesh.v1** | Discovery | Contracts, content base, relays, denom, buffer |
| **Content plane** | Media / body | \`content_cid\` → bud sha256 or IPFS dual-index |
| **Nostr** | Live signals only | NIP-15-ish notes; never settles funds |

## Fixed-price lifecycle

1. Curator lists product (\`sku\`, stock, unit price, optional \`content_cid\`).
2. Buyer **Purchase** → order **Reserved**; available = stock − reserved.
3. **Settle** only after \`min_buffer_blocks\` (default **7**, range 5–10).
4. Early settle surfaces buffer error; cancel is buyer/admin only.

## Content & images

- Prefer bare **64-hex sha256** \`content_cid\` → \`GET {contentBase}/content/{sha}\`.
- Optional prefixes: \`bud:\`, \`sha256:\`, \`budsha256:\`.
- Secondary: \`ipfs:\` / \`ipfs://\` → \`/content/by-ipfs/{cid}\` (optional gateway fallback).
- Listing JSON may carry \`image\` / \`image_url\` / \`images[]\` — HTTP URLs or cids (resolved the same way).

## Product UX rules

- Catalog renders **immediately** from chain/demo; media enrich is progressive.
- Demo seeds are labeled **demo** when contracts exist but SKUs are not on-chain yet.
- Developer mesh/discovery details stay behind a **dev-only** menu — members see catalog, not internals.
- Grid density and filters are client-side only; they do not change chain state.

## Operators

**Manage Modules → Marketplace** writes \`mesh.v1\` with fixedPrice, auction, contentBase, acceptedDenom, minBufferBlocks. Members use the Marketplace tab to filter, purchase, and bid.

See also: \`docs/superpowers/user-guides/2026-07-20-dao-marketplace-module-setup.md\`.
`.trim()
