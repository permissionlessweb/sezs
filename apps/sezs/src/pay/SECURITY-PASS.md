# Payments security pass (overnight R3)

Scope: `/tickets` checkout, `src/pay/*`, `src/dregg/zec.ts`, hash-market `sezs_ingress` / `sezs_pay`. Not FROST, not gallery, not sign-in keys.

## Threats checked

| Threat | Result |
| --- | --- |
| Guest browser hits `127.0.0.1:8421` / `:19091` | Adapters `live: false`. No `fetch` to those ports in the tickets graph. `readServerPaid` is a no-op unpaid. |
| Pay click writes `AuthSession.paid` | `commitPaid` removed. `refreshPaid` still reads; guest read returns unpaid |
| Forged `localStorage.paid` | `dropBrowserPaid` on load and save. Ticket stays unpaid until a server fact |
| POST `{paid:true}` | BE `400 browser_paid`. GET ticket unpaid (rust e2e) |
| Invented ZEC UA | Guest instruct does not invent. Lab `zecPayUri` still requires DREGG `zcash:` + lab network |
| `terp1` in ZIP-321 / memo / EVM dest | Lab helper still aborts; guest never quotes |
| Mainnet ETH / Base | chain id 1 and 8453 refused; anvil 31337 refused |
| ETH / Base lab | Sepolia 11155111 and Base-Sepolia 84532 only |
| Mainnet ZEC UA | `u1` (not `utest1`/`uregtest1`) refused |
| Mainnet Penumbra | `penumbra1` refused; rail not selectable |
| Public DREGG origin | lab helper stays loopback-only; guest does not call it |
| Cash App on `/tickets` | not in `ADAPTERS`; instruct/poll refuse |
| MockBech32 as paid | ingress `mock_bech32` |
| Invented RPC ids | ingress `invented_rpc` |
| Second chain stack | `is_second_stack_spawn` |
| ICT_MOCK=1 as live | `ict_mock_refused` |
| Keys / .env printed | adapters never log env; this pane does not source `dregg-svg.env` |
| 0-conf mempool as paid | server ingest only on DreggWatch / Deposited·Entitled·Settled |
| Penumbra dest as paid | rail is coming; poll never paid |
| Client DREGG phase as paid | guest poll is `not_live`, not a DREGG status |

## Labeled, not hidden

- Cash App receipt JSON under `public/cashapp/receipts` is a **lab door** path. Tickets adapters do not call it.
- Shielded Penumbra is **coming**. narsil is not an SEZS Penumbra watcher.
- Unwired rails → honest **Checkout opens soon.** No fake dest.

## Residual

- A live ZEC testnet/regtest send into DREGG still needs a funded minter (see ARCHITECTURE.md) plus a funded spend capability on the box (never a mnemonic) and checkout_ready.
- Next `output: 'export'` has no same-origin pay proxy. Until one exists, guest checkout stays not live. Do not tunnel loopback into the browser.
- In-memory `session.paid` after `refreshPaid` is a UI cache of the last read. Guest read is unpaid.
