# TrustlessPledge

DAO module for the **Trustlessness / integrity pledge** NFT flow.

**Spec:** [docs/superpowers/specs/2026-07-22-trustless-pledge-nft-module.md](../../../../../../docs/superpowers/specs/2026-07-22-trustless-pledge-nft-module.md)

## Behavior

1. **hasPledged** — when a wallet is connected, queries the configured `cw721_svg` collection (`mint_count` extension, then flat `mint_count`, then `tokens { owner, limit: 1 }`). Chain is source of truth (not localStorage).
2. **Digest** — ADR-032-style preimage (null-byte field separators):

   ```
   domain || 0x00 || chain_id || 0x00 || account || 0x00
     || authenticator_id || 0x00 || manifesto_cid || 0x00
     || project_id || 0x00 || commitments_canonical
   ```

   - `project_id` scopes the pledge (grant / product / DAO); empty = unscoped.
   - `commitments_canonical` is sorted lines `kind|ref|digest_hex` for multi-destination
     data commitments (boards, proposals, IPFS payloads, milestones, …).
   - Digest: blake2b256 (default) / blake3 / sha256.

3. **Authenticate (required)** — wallet `signArbitrary` over mint auth message:
   - **v2 content-bound:** `{CW721SVG_DST}{nonce}|{adr032_digest_hex}`
   - Contract verifies ADR-36 (`ext: CosmosArbitrary`), consumes one-time nonce,
     requires recovered pubkey address == tx sender. Unauthenticated mint is rejected.

4. **Mint** — `{ mint: { amnt, alloc, proof_hashes, ext } }` matching `cw_svg::MintMsg`.
   Deploy pledge collections with `require_auth: true` on `SvgCollectionMetadata` so
   unauthenticated mints are rejected at the contract.

## Honesty

| Layer | What is verified |
|-------|------------------|
| **On-chain (`require_auth`)** | ADR-36 secp256k1 over auth message; DST prefix; one-time nonce; sender == recovered |
| **Bound in auth msg** | ADR-032 digest (manifesto + project_id + commitments) via `\|digest` suffix |
| **Not re-parsed on-chain** | Individual commitment fields / manifesto CID (cryptographically bound via digest) |
| **Open-mint SVG drops** | `require_auth: false` (default) still allows mint without `ext`; pledge UI always sends auth |

## Defaults

| Field | Mainnet (`morocco-1`) | Testnet (`120u-1`) |
|-------|----------------------|--------------------|
| collection | SvgNfts cw721_svg `terp1vp7…pr5zt` | empty slot (configure when deployed) |
| minter | SvgNfts minter `terp188j…` | empty slot |
| pledgeSiteUrl | `permissionless.money/pledge` | same |
| pledgeDocUrl | Fileverse trustlessness pledge | same |
| manifestoCid / teamCid | empty until curator pins content | same |
| signDomain | `terp-adr032/v1` | same |
| digestAlg | `blake2b256` | same |
| projectId | empty (optional) | same |
| commitments | `[]` | same |

## Static document body (ETH URI / IPFS)

- Pure helpers: `@dao-dao/utils` → `pledgeDocument.ts` (`resolvePledgeDocUrl`, `detectPledgeDocKind`, `fetchPledgeDocument`)
- ETH inventory SSOT: [docs/superpowers/specs/2026-08-07-trustless-pledge-eth-uri-ssot.md](../../../../../../docs/superpowers/specs/2026-08-07-trustless-pledge-eth-uri-ssot.md) — **do not invent** contract addresses
- Renderer: `PledgeDocumentBody` fetches manifesto (and optional team) text via gateway and renders with `MarkdownRenderer` (rehype-sanitize)
- Until ETH `tokenURI` is verified, product path is **CID + gateway**
- Fixture MD: [fixtures/pledge-fixture.md](./fixtures/pledge-fixture.md)
- Soft Playwright: `packages/tests/tests/playwright/sda-trustless-pledge-soft.spec.ts`

## DAO discovery — `trustless_pledge.v1` (TP-BOOT-3)

Write via core `set_item` (or billboard text-record) using the same pattern as `mesh.v1`.

**Key:** `trustless_pledge.v1`

**Example JSON** (empty strings = leave unset; do not invent ETH addresses):

```json
{
  "collection": "terp1…",
  "minter": "terp1…",
  "ethContract": "",
  "documentTokenId": "",
  "teamTokenId": "",
  "manifestoCid": "bafy…",
  "teamCid": "",
  "ipfsGateway": "https://ipfs.terp.network/ipfs/"
}
```

Canonical template: [fixtures/trustless_pledge.v1.example.json](./fixtures/trustless_pledge.v1.example.json)

### Bootstrap recipe (cw-orch / community-core-local)

1. Deploy or reuse pledge `cw721_svg` collection with `require_auth: true` when minting digests.
2. Optionally instantiate2 minter bound to the DAO.
3. `set_item` on DAO core:

   | key | value |
   |-----|--------|
   | `trustless_pledge.v1` | JSON above (CID + collection first; eth fields only when verified) |

4. Enable module on Home / widgets; FE prefers module editor fields, then this item for discovery (CID path works without it).
5. Lab banana default DAO may pin manifesto CID without waiting for ETH SSOT.

**Stack wiring (done):** `artifacts/community-core-local/bootstrap-open-dao.sh` and `setup-fe-complete.sh` write `trustless_pledge.v1` (empty collection until testnet deploy; no invented ETH). FE `resolveTrustlessPledgeDiscovery` prefers module fields, then this item — collection need not be only mainnet SvgNfts defaults.

## Layout

| File | Summary |
|------|---------|
| [index.ts](./index.ts) | Module definition + chain support |
| [types.ts](./types.ts) | `TrustlessPledgeModuleData` |
| [constants.ts](./constants.ts) | Addresses / Fileverse / gateway |
| [hasPledged.ts](./hasPledged.ts) | Chain query helpers |
| [TrustlessPledgeEditor.tsx](./TrustlessPledgeEditor.tsx) | Module editor |
| [TrustlessPledgeRenderer.tsx](./TrustlessPledgeRenderer.tsx) | hasPledged + sign + mint UI + ModuleInfo |
| [PledgeDocumentBody.tsx](./PledgeDocumentBody.tsx) | Fetch/render static HTML/MD from CID/URI |
| [stateless/](./stateless/) | Presentational card + story |

## Utils

Digest helpers live in `@dao-dao/utils` → `trustlessPledge.ts` (`signPledgeDigest`, `buildPledgeTokenMetadata`, …) with unit tests in `trustlessPledge.test.ts`.

## Open in UI

1. On a **Terp** DAO (`morocco-1`), open **Manage modules** / proposal action and enable **Trustlessness Pledge** (or it appears on Home when the DAO already has `trustless_pledge` in its module list).
2. Set **Manifesto IPFS CID** and confirm collection address.
3. Connect wallet → see pledged / not pledged → **Sign & mint pledge**.
