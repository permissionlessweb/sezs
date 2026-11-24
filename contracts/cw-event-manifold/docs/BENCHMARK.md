# Proof verification benchmarks

Figures below were measured on a private development chain (not a public network). Do not treat them as mainnet gas. Dates are Africa/Dakar (UTC+0). Chain identifiers and how the measurements were taken are kept in the crate's internal development notes, not on this page.

Circuit: `sezs_consume_v2`, Halo2 IPA on Pasta, `K = 11`, standard Poseidon P128Pow5T3, Merkle depth 10. Proof bundle v2 is 4,321 bytes (`0x02` prefix, then root, `N`, `rk_x`, `rk_y`, and a 4,192-byte proof). Public inputs are `root`, `N`, `event_id_fp`, `domain_fp`, `rk_x`, and `rk_y`. Verifying key hash (`sha256` of `cs` then `vk`) is `0b34842f8dabd9a347c7998cbf6e7f87a52bc98b8acd4bb449e629f1740eeff6`.

## On-chain gas

Measured with `terpd` using `--gas auto`.

| Action | Gas used | When | Source |
| --- | --- | --- | --- |
| Store `cw_event_manifold` wasm | 3,142,227 | 15 Nov 2026 | Store of the verifier-wired contract (code id 3) |
| Instantiate the event contract | 205,864 | 15 Nov 2026 | Same deploy |
| `store-full-circuit` (zkid 1) | 11,086,600 | 15 Nov 2026 | Circuit registration on this chain |
| `UpdateGuestRoot` (epoch 5, 2 leaves) | 162,832 | 15 Nov 2026 | `e2e/ticket-v2-flow.e2e.mjs` |
| `UpdateGuestRoot` (epoch 8, 6 leaves) | 162,833 | 16 Nov 2026 | Same e2e, after hydrating existing leaves |
| `UpdateGuestRoot` (epoch 7, 4 leaves) | 162,832 | 15 Nov 2026 | Browser walkthrough publish |
| `SetDomain` (ASCII door-auth key) | 148,882 | 15 Nov 2026 | Domain and door-auth setup |
| `SetDomain` as coordinator (same-value write) | 215,309 | 16 Nov 2026 | Confirmed the coordinator can write; height 31030, code 0 |
| `ConsumeTicket` live consent | 288,353 | 15 Nov 2026 | Node chain e2e, first green run |
| `ConsumeTicket` live consent | 288,414 | 16 Nov 2026 | Node chain e2e re-run |
| `ConsumeTicket` printed consent | 286,227 | 15 Nov 2026 | Node chain e2e, first green run |
| `ConsumeTicket` printed consent | 286,288 | 16 Nov 2026 | Node chain e2e re-run |
| Replay of a spent nullifier | 240,154 | 15 Nov 2026 | Browser door replay (check-in page). The tx is refused: `nullifier already spent` |

The 16 Nov 2026 browser walkthrough published epoch 9, 6 leaves (tx starting `35457589` and ending `34865A6F9`). That run's admit used the printed consent path; the UI reported on-chain admission and then the friendly replay refusal. Exact admit gas for that browser tx was not printed in the UI.

## Prove times

| Environment | Time | When | Source |
| --- | --- | --- | --- |
| Node wasm prover | 6,959 ms | 15 Nov 2026 | `e2e/ticket-v2-flow.e2e.mjs` |
| Node wasm prover | 6,910 ms | 16 Nov 2026 | Same e2e re-run |
| Browser worker | 2,580 ms | 15 Nov 2026 | shots-v9 (`Proof ready in 2580 ms`) |
| Browser worker | 2,574 ms | 15 Nov 2026 | later shots-v9 recapture |
| Browser worker | 2,588 ms | 16 Nov 2026 | shots-v10 (`Proof ready in 2588 ms`) |

The secret never leaves the device during these proves.

## What this does not measure

These numbers are from a quiet private chain. They do not include a public fee market, congestion, or a different `min-gas-prices`. Usher UX on a public chain still needs a measurement on that chain before a real-money event.
