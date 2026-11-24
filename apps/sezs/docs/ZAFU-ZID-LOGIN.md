# Zafu ZID login

Login uses the official `@zafu/zid` package (npm 0.3.0; API checked against upstream `packages/zid` on `main`). This is separate from the Cosmos provider on `window.zafu`, which is still used only for on-chain execute (usher consume, `signAmino` / `signDirect`).

## Official button

```ts
import { requireWallet, sign, detect, ZafuError } from '@zafu/zid'

const found = await detect()
const wallet = await requireWallet()
const { signature, publicKey } = await sign(wallet, challengeHex, `Sign in to ${origin}`)
```

`publicKey` is the **site-scoped** ed25519 ZID for this origin. Map it to registry kind `ed25519/zid` (`docs/specs/IDENTITY-AND-ROLES.md`). Do not use `connect()`’s session pubkey as the account id — that key is a delegated session key, not the stable site ZID.

`connect({ appName, requireWallet: true, onWaiting })` is fine for a live session after login. It is not the login proof.

## Server challenge

The wallet signs **only the challenge bytes**. It shows the origin but does not bind it into the signature. The splash backend must issue a fresh nonce that already commits to the origin and audience:

```
SEZS-LOGIN-ZID-V1
origin: http://localhost:3051
audience: sezs
nonce: …
ts: …
```

`challengeHex` is the UTF-8 message, hex-encoded. Verify with ed25519 over those bytes against `publicKey`. Challenges are one-time, two-minute TTL, and limited to `http://localhost:3051` and `http://127.0.0.1:3051`.

## Edge cases

- **Not installed / not injected.** `detect()` returns `{ installed: false }`. Zafu only injects on `https://`, `http://localhost`, `http://127.0.0.1`, and `http://[::1]`. A LAN hostname or SSH jump in the address bar means the extension is absent on that origin.
- **Incompatible protocol.** `compatible: false` — ask the person to update Zafu, not to “install” it again.
- **Denied / locked / rate limited / identity layer off.** Typed `ZafuError` codes from the SDK. Show those outcomes; do not remap them to “not in this browser.”
- **Double click.** `requireWallet` / `sign` should not be started twice from the same button. The adapter reducer ignores a second `start` while connecting. The SDK also coalesces in-flight `connect()` calls.
- **Orphaned bridge.** Reloading the extension in an open tab yields “wallet unavailable — reload the page.”
- **Passkeys.** WebAuthn still needs `http://localhost:3051`, not `http://127.0.0.1:3051` (invalid RP ID). That path is independent of ZID login.
- **Consume transactions.** Still `window.zafu.enable` / `signAmino` for `sezs-local-1`. The chain-prefix limitation (unknown ids derive `chainId.split('-')[0]`) is unchanged and is filed as [rotkonetworks/zafu#198](https://github.com/rotkonetworks/zafu/issues/198). Login no longer depends on that prefix.
- **No guest fallback.** Login passes `requireWallet` behavior: if Zafu is missing, it errors. It does not mint an ephemeral ZID and call that a sign-in.
