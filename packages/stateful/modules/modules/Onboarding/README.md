# Gift accounts (Onboarding module)

DAO tab for **one-time shared links** that bootstrap a fresh wallet (PFPK / OIDC → ephemeral key → passkey bind → optional auto-migrate).

## What ships

| Capability | Honest claim |
|------------|--------------|
| Shared gift / invite links | One-time PFPK (or OIDC) tokens; claim URL embeds invite payload |
| Fresh wallet path | Claim UI scaffolds ephemeral wallet + WebAuthn passkey bind |
| **Feegrant preauth action selector** | At **generation**, sponsor selects catalog actions; `buildGiftFeegrantMsgs` emits `MsgGrantAllowance` with **`AllowedMsgAllowance` limited to those message type URLs only** |
| Feegrant draft UI | Builds/copyable stargate msgs when granter wallet + grantee address known; **does not auto-broadcast** |

## What this is **not**

- **Not** airdrop / treasury funding of the fresh wallet (bank `MsgSend` of assets is separate; feegrant only pays **gas** for allowed msgs).
- **Not** an unlimited BasicAllowance — empty selection → **no** feegrant msg.
- **Not** marketplace, bounties, or pro-rata event distribution (see event-distributions runbook).
- **Not** a claim of production PFPK/WebAuthn mainnet hardness — passkey has a dev fallback when WebAuthn is unavailable.

## Feegrant wiring

```ts
import {
  buildGiftFeegrantMsgs,
  resolvePreauthMsgTypeUrls,
  GIFT_PREAUTH_ACTIONS,
} from '@dao-dao/utils'

// Selected actions only → type URLs
const urls = resolvePreauthMsgTypeUrls(['bank_send', 'wasm_execute'])

// Granter pays gas for grantee txs whose type URL is in the allow list
const msgs = buildGiftFeegrantMsgs({
  granter: 'terp1…',
  grantee: 'terp1…', // fresh wallet
  actionIds: ['bank_send', 'wasm_execute'],
  spendLimit: [{ denom: 'uterp', amount: '1000000' }], // optional gas cap
})
```

Catalog: `packages/utils/giftFeegrant.ts` (`GIFT_PREAUTH_ACTIONS`).

## Residual note

Residual **t_9706f189** (community-dashboard): feegrant preauth selector + selected-only msgs. Core shared-link gift path: residual parent **t_79a4a4b6** (default board).
