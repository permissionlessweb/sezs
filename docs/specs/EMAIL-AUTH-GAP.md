# Email auth gap

Status: front-end provider shape is in the SEZS app (`apps/sezs/src/auth/emailAuth.ts`, `EmailSignIn.tsx`). The splash backend does not issue, deliver, or verify email credentials yet. This note is the handoff for implementing that runtime.

Do not send email from a workstation, and do not sign up for a delivery provider, while reading or implementing this document. Delivery stays behind a provider abstraction with a loopback/dev sink first.

## Current state

Sign-in options today:

- **Zafu ZID** (`ed25519/zid`): `@zafu/zid` `requireWallet` + `sign` over a server-issued, origin-bound challenge. Splash verifies the ed25519 signature in `dev/splash/session-login.mjs` and sets the HttpOnly `sezs_splash` cookie.
- **Passkey + browser key** (`p256/passkey`): WebAuthn with `userVerification: 'required'` and the PRF extension. The browser secp256k1 key is sealed with AES-GCM under the 32-byte PRF output. There is no plaintext fallback.
- **Email**: the modal can collect an address and a one-time code. The client calls `/sezs/auth/email/request`, `/verify`, `/session`, `/bind`, and `/logout` with `credentials: 'include'` and an `x-sezs-csrf` header. Those routes are not implemented. A 404 or 501 is shown as “Email sign-in isn’t available yet.” Nothing is delivered.

The front-end client follows the Ficus `AuthProvider` shape where it matters for mobile: `sessionVersion` bumps on login and logout, `refreshSession` does not sign the person out when a request fails, the client fails closed when the status is unknown, and a later passkey or ZID can be bound to the same email session.

## What the backend needs

Base path: `/sezs/session` already lives on the splash process (`127.0.0.1:3052`, rewritten from the app on `127.0.0.1:3051`). Add `/sezs/auth/email/*` on that same process so the cookie domain, CSRF rule, and loopback bind stay consistent. Allowed origins: `http://127.0.0.1:3051` and `http://localhost:3051` only.

### 1. Issuance

`POST /sezs/auth/email/request` `{ email }`

- Normalize the address (trim, lowercase). Reject a malformed address with 400.
- Issue either a **magic-link token** or a **short numeric OTP** (prefer OTP for mobile web, and accept a link that lands on `/` with `?email_code=` for the same verifier).
- Store only a hash of the secret, plus email, origin, expiry, and attempt count. Never log the raw token, the address in full if a log is needed (hash or truncate), or any session secret.
- The challenge must commit to the origin and audience, the same way ZID login does (`SEZS-LOGIN-EMAIL-V1` + origin + nonce + ts).
- Idempotent for a short window: a second request from the same address on the same origin replaces or rate-limits, and does not leak whether the address is new.

`POST /sezs/auth/email/verify` `{ email, code }`

- Compare the code (or one-time link token) in constant time against the hash.
- On success, mint the same HttpOnly `SameSite=Strict` session cookie family as ZID login (`sezs_splash`). `login_id` is a stable, server-chosen identifier for that mailbox (a random id, not the raw email, is preferable in cookies and logs). Record `kind: email` on the session.
- One-time use. Reuse returns 400 `unknown_challenge` or `expired`.

`GET /sezs/auth/email/session` returns the current cookie’s email login, or 401.

`POST /sezs/auth/email/logout` clears the cookie.

### 2. Rate limits

- Per address and per origin: tight cap on request (for example 3 / 15 min) and on verify (for example 5 / 15 min).
- Per source IP on the loopback-facing process as a second cap, so a scripted client cannot spray mailboxes.
- On limit, return 429 with a generic body. Do not confirm that the address exists.

### 3. Delivery provider abstraction

```
sendEmail({ to, subject, text, tokenRef }) → Promise<void>
```

- Dev / lab: a loopback sink that writes the message to a 0600 file or an in-memory inbox on `127.0.0.1`, never to a public SMTP host.
- Production: a single adapter (the implementer chooses later). The route layer must not import a vendor SDK directly.
- Failure to enqueue is a 503 to the client. It is not a 200 “sent.”
- Do not implement a real provider in the first patch. The loopback sink is enough to complete the protocol and the tests.

### 4. Session binding to passkey / ZID

`POST /sezs/auth/email/bind` `{ kind: 'p256/passkey' | 'ed25519/zid', credId? | zidPubkey? }`

- Requires a valid email session cookie.
- Binding proves control of the second factor in the same request (WebAuthn assertion, or a fresh ZID signature over a new origin-bound nonce). A raw identifier is not enough.
- After bind, `/sezs/session/me` and the role lookup may treat the bound ZID or passkey as the same person as the email login.
- Unbind and rotation belong in a later change; record the need, do not invent a UI for it here.

Role entries stay in the companion registry described in `IDENTITY-AND-ROLES.md`. Email itself is not an on-chain identity kind. Staff rights still come from a bound `ed25519/zid` or `p256/passkey` or `terp-bech32` entry.

### 5. Threat model

| Risk | Mitigation |
| --- | --- |
| Token replay, or a stolen inbox | Short TTL, one-time secrets, origin/audience bound into the issued challenge |
| Cross-origin reuse of a code | Allowed-origin check on request and verify; challenge bytes include the origin |
| CSRF on cookie-setting POST | Require `x-sezs-csrf` (or the same CSRF rule the frost inbox already uses) on all mutations |
| Account enumeration | Same response timing and body for known and unknown addresses |
| Session fixation | New session id after verify; prior email challenge is deleted |
| Binding a victim’s email to an attacker’s passkey / ZID | Bind requires an already-authenticated email session *and* a fresh proof from the second factor |
| Delivery provider compromise | Server stores hashes only; tokens expire quickly; no long-lived magic links |
| XSS reading mail | The session cookie is HttpOnly; the front end never sees the raw token after verify |
| Log leakage | Never log tokens, PRF material, ZID secret keys, or full session ids |

Fail closed: if the delivery sink or the session store is down, do not set a cookie.

## Tests the runtime should land with

- Request + verify on loopback issues the cookie and `/sezs/auth/email/session` returns the login.
- Reuse of a code fails.
- A foreign origin is refused.
- Rate limit returns 429.
- Bind of a ZID or passkey without a proof is refused; with a proof, `session/me` shows the bind.
- No test sends a network email.

## Production sending identity (decided)

The From address is `sezs@permissionless.money` (env name `SEZS_EMAIL_FROM` when the runtime lands). The user will set up mail ingestion and sending on that domain. SPF, DKIM, DMARC, and the delivery provider are still open. Do not sign up for a provider or change DNS from this repository.

The self-hosted runtime that sends this mail is implemented on `sezs/email-auth-runtime` and is not in this branch.

## Out of scope

- Provider sign-up, DNS, or production SMTP/API keys
- Push, SMS, or social login
- Changing ZID or passkey login, which already work without email
