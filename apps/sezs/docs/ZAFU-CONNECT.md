# Zafu connect — limitations and edge cases

**Login is documented in [ZAFU-ZID-LOGIN.md](./ZAFU-ZID-LOGIN.md).** This note covers the Cosmos provider (`window.zafu`) still used for on-chain consume, not for sign-in.

Keplr is not a sign-in option. Enabling `terp-1` (or another chain id) here is only so a consume signature derives a `terp1` / `sezs1` address. It is not a login method.

Source: Zafu worktree `~/src/_worktrees/zafu` (head studied for this note), plus `docs/src/architecture/extension.md` and `docs/adrs/cosmos-as-penumbra-subwallets.md`. Official site: [zafu.pro](https://zafu.pro).

## What the page actually sees

`injected-keplr.ts` installs a Keplr-compatible provider on **`window.zafu`** immediately at `document_start` in the MAIN world and dispatches `zafu_keystorechange` (`installZafu`, injected-keplr.ts:286–299). Methods: `enable`, `getKey`, `experimentalSuggestChain`, `signAmino`, `signDirect`, `getOfflineSigner*`. There is no `window.zafu.cosmos` nest in the current inject (the ADR mentioned that shape; the shipping provider *is* `window.zafu`).

`window.keplr` is **opt-in**. The ISOLATED `keplr-bridge.ts` only installs it when `keplrCompat === true` (keplr-bridge.ts:79–99). Calls through `window.keplr` with `native` unset are rejected with `keplr compatibility is disabled in zafu settings` (keplr-bridge.ts:51–56). Calls through `window.zafu` set `native: true` and are **not** gated by that setting (keplr-bridge.ts:51–54). This site must use `window.zafu`, not `window.keplr`.

There is no EIP-6963 announce and no Prax-style `window[Symbol.for('penumbra')]` path for Cosmos. Penumbra uses that symbol separately (`injected-penumbra-global.ts`); it is not how we sign in a Terp account.

`window.zafu` is present before origin approval. `enable` / `getKey` open an in-extension approval popup the first time this origin+chain is requested (listen/keplr.ts:73–114). Rejection is `connection rejected` or `rejected`, not “not installed”.

## Where the content script injects

`apps/extension/public/manifest.json` content_scripts matches (same on the beta manifest):

- `https://*/*`
- `http://localhost/*`
- `http://127.0.0.1/*`
- `http://[::1]/*`

`externally_connectable` uses the same set (manifest.json:89). Chrome match patterns with no port match **any port**, so `http://127.0.0.1:3051` and `http://localhost:3051` are in scope.

**Not injected** on HTTP except those loopback hosts: e.g. `http://192.168.x.x:3051`, a Tailscale name, `http://build-host:3051`, or any other hostname. An SSH tunnel only works if the browser’s address bar is `127.0.0.1` or `localhost` (or HTTPS). If the user opens a remote HTTP origin, `window.zafu` will be missing and we must say the extension isn’t on this origin — not a generic “not supported” after a successful inject.

Chrome “site access” set to “On click” can also block inject until the user grants the origin.

Reloading the extension in an already-open tab leaves an orphaned bridge: `wallet unavailable - reload the page` (keplr-bridge.ts:59–62).

## Chain ids and the terp1 address

Zafu’s `COSMOS_CHAINS` (packages/wallet/src/networks/cosmos/chains.ts:231) is the Penumbra counterparty list plus presets (Noble, Cosmos Hub, Injective, Osmosis). **Terp, `morocco-1`, and `sezs-local-1` are not in that list.**

`cosmosChainIdFromKeplr` (message/keplr.ts:70–86) matches an exact `config.chainId`, then `bech32Prefix === chainId.split('-')[0]`. Neither `sezs-local-1` nor `morocco-1` hits `terp`.

On enable, the approval popup derives the bech32 prefix with `prefixFor` (routes/popup/approval/keplr.tsx:64–79). If the chain is unknown and no signer address is supplied, it returns **`chainId.split('-')[0]`**. So:

- `enable('sezs-local-1')` → prefix `sezs` → a **`sezs1…` address**
- `enable('morocco-1')` → prefix `morocco` → a **`morocco1…` address**
- `enable('terp-1')` → prefix `terp` → a **`terp1…` address**

This app’s local chain id is `sezs-local-1`. Passing that id to Zafu is why a connected wallet would fail our `isTerp1` check. The integration therefore **suggests** the real chain (RPC, terp prefix) and **enables `terp-1`** so derivation uses the terp prefix. The spend key is the usual coin-type 118 secp256k1 key; only the bech32 prefix changes.

`experimentalSuggestChain` (listen/keplr.ts:192–198) only stores the payload in session storage. It does **not** add the chain to `COSMOS_CHAINS` and does **not** change `prefixFor`. Suggesting `sezs-local-1` is honest for Keplr and for a future Zafu, but it cannot fix Zafu’s prefix today.

`sendTx` throws `unsupported chain ${chainId}` if `cosmosChainIdFromKeplr` fails (listen/keplr.ts:222). Ethermint/Injective is also refused on the Keplr provider (listen/keplr.ts:156). Enable of an unknown cosmos chain still opens the approval popup; it does not by itself mean the extension is missing.

## Passkey

Zafu passkey is **not** a method on `window.zafu`. `passkey-intercept.ts` wraps `navigator.credentials` (create/get) at `document_start` and talks to `passkey-bridge.ts` over `postMessage`. The dapp invokes WebAuthn itself; do not call a `window.zafu` passkey API. Zafu may offer itself as authenticator after an origin consent screen. If the wallet does not answer, the intercept falls back to the platform authenticator (passkey-intercept.ts:26–27, 64–67).

WebAuthn needs a secure context: `https:` or loopback HTTP (`http://localhost` or `http://127.0.0.1`). A non-loopback HTTP origin will not get a passkey ceremony.

**RP ID / invalid domain:** a secure context is not enough. The relying-party ID must be a valid domain. `localhost` is allowed; **IP addresses are not**. Opening the app at `http://127.0.0.1:3051` and calling `navigator.credentials` with `rp.id` / `rpId` set to `location.hostname` (`127.0.0.1`) makes Chrome throw `SecurityError: This is an invalid domain.` Omitting `rp.id` does not fix it — the default is still the effective domain, which is the IP. Use `http://localhost:3051` for passkey sign-in (same app). SEZS omits or sets `rp.id` only when `location.hostname` is a valid RP ID (`src/auth/rpId.ts`); on `127.0.0.1` the ceremony redirects to `localhost` on the same port. Passkeys created under RP ID `127.0.0.1` will not work on `localhost`.

If `localhost` resolves only to `::1` and the dev server is bound to IPv4 `127.0.0.1`, bind loopback IPv6 as well, or confirm the browser falls through to `127.0.0.1`.

## Error mapping (this app)

Only a failed presence wait may be shown as “isn’t in this browser”. `enable` / `getKey` / suggest failures (rejected, unsupported chain, no key, reload the page, wrong prefix) must surface as themselves.

## Checklist for a live connect

1. Address bar is `http://localhost:3051` (or HTTPS). `http://127.0.0.1:3051` is a valid secure context and Zafu injects there, but it is **not** a valid WebAuthn RP ID — use localhost for passkey.
2. Zafu is allowed to run on that origin (site access).
3. Reload the tab after installing or reloading the extension.
4. Use **Zafu**, not Keplr-compat, unless the user turned compatibility on.
5. Approve the Zafu popup; the address must be `terp1…`.
