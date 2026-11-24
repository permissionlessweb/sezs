# Valar shielded-vote SDK and Speakez tickets: assessment

Date: 14 November 2026 (Africa/Dakar, UTC+0).
Status: research and design only. No app code changed, nothing pushed or deployed.
Companion docs: `DOOR-PRIVACY-DECISION.md`, `TICKET-PROOF-DESIGN.md`, `BACKEND-ROLE.md`.

The question (user, t19u): would something like the Zcash voting SDK built by
**Valar Group** (the user wrote "Valor") let us
- use Zcash technology more directly,
- stop the operator from seeing which payment belongs to the person at the door,
- keep double-entry prevention,
- increase privacy, with dropping ETH as the only trade-off,
- limit consume submission to event ushers, and
- run on an "event chain" that later links to a larger L1 through "IVC clients" and bridges assets out?

Short answer: **the core idea is right, but the wording needs care.** What we
should borrow is the *spend pattern* Valar uses in its vote proof (ZKP 2), not
its chain or its snapshot proof. That pattern is a Halo2 membership proof over a
Poseidon tree, a published nullifier, and a re-randomised spend-authorisation
key that signs outside the circuit. It does give operator-unlinkable check-in
with double-entry prevention. It only does so if we also **remove the
correlators v1 registers next to `C`** (the ticket public key and `N` posted at
invoice time). We also have to fetch the Merkle path and sealed backup without
revealing `C`. A dedicated event chain isn't needed for the pilot, and "IVC
clients" is the wrong term.

---

## 1. What the Valar SDK actually is (sources)

Checked on 14 Nov 2026 by cloning the public repos. Commit times are converted to UTC+0.

| Repo | What it is | License | Head checked |
| --- | --- | --- | --- |
| https://github.com/valargroup/vote-sdk | "Shielded Vote Chain": a **Cosmos SDK v0.53 app-chain** (`svoted`) with an `x/vote` module, Go + Rust FFI for Halo2/RedPallas verification, a helper server for delayed share submission, and an admin UI | MIT | `29bc0ef`, 5 Nov 2026 18:27 |
| https://github.com/valargroup/zcash_voting | Client-side Rust library: delegation and vote proofs, ElGamal, PCZT construction, Merkle witnesses, SQLite round state, `vote-commitment-tree` (append-only Poseidon tree) | MIT / Apache-2.0 | `eecc618`, 13 Nov 2026 16:54 |
| https://github.com/valargroup/voting-circuits | Halo2 circuits: ZKP 1 delegation (K=12), ZKP 2 vote proof (K=11), ZKP 3 share reveal (K=10), built on Orchard gadgets | MIT / Apache-2.0 | `597b744`, 11 Nov 2026 17:37 |
| https://github.com/valargroup/vote-nullifier-pir | YPIR server/client so a wallet can get a nullifier **non-membership** proof without revealing which nullifier it asked about | MIT / Apache-2.0 | `7f79c20`, 11 Nov 2026 17:52 |
| https://github.com/valargroup/token-holder-voting-config | Per-round service discovery JSON | none stated | n/a |

Docs and specs:
- GitBook: https://valargroup.gitbook.io/shielded-vote-docs (intro) and https://valargroup.gitbook.io/shielded-vote-docs/wallet-integration/guide
- Draft ZIPs, all open PRs: Shielded Voting Protocol https://github.com/zcash/zips/pull/1200 ; Zcash Shielded Coinholder Voting https://github.com/zcash/zips/pull/1203 ; Submission Server https://github.com/zcash/zips/pull/1218 ; Wallet API https://github.com/zcash/zips/pull/1244 . The PIR nullifier-exclusion ZIP PR https://github.com/zcash/zips/pull/1198 is closed and not merged.
- Forum: "The Coinholder Voting Chain" https://forum.zcashcommunity.com/t/the-coinholder-voting-chain/56925 ; "NU7 Coinholder Vote" https://forum.zcashcommunity.com/t/nu7-coinholder-vote/56912 ; retroactive grant https://forum.zcashcommunity.com/t/retroactive-grant-application-shielded-voting/59292 (13 Nov 2026).
- Ironwood pool (what the SDK now snapshots): https://zcash.github.io/ironwood/concepts.html , ZIP 258 https://zips.z.cash/zip-0258

How the protocol works (from `voting-circuits` READMEs and `vote-sdk` README):
1. **Snapshot / delegation (ZKP 1).** A voter proves they own up to 5 **Ironwood** (V3, Orchard-protocol) notes at a coordinator-set snapshot height. The proof covers Sinsemilla Merkle paths to `nc_root`, plus nullifier non-membership against an Indexed Merkle Tree (`nf_imt_root`), with the IMT path fetched privately via PIR. It publishes per-note **alternate nullifiers** `Poseidon(nk, dom, real_nf)` instead of the real Zcash nullifiers, and mints a Vote Authority Note (VAN) commitment into a Poseidon tree on the vote chain. Weight is 1 ballot per 0.125 ZEC. Pre-NU6.3 Orchard voting is no longer supported (`zcash_voting` CHANGELOG). The GitBook pages still say "Orchard".
2. **Vote (ZKP 2).** Proves VAN membership in the vote-commitment tree (Poseidon, 24 levels), publishes a VAN nullifier `Poseidon(nk, "vote authority spend", round_id, VAN)`, and proves `r_vpk = ak + [alpha]·SpendAuthG` in-circuit. **The signature is verified outside the circuit under the re-randomised key `r_vpk`.** Amounts are ElGamal-encrypted to a threshold election key.
3. **Share reveal (ZKP 3)** and threshold decryption of the aggregate only. Helper servers delay and spread share submissions to blur timing.
4. **Chain.** `svoted` is a Cosmos SDK app-chain. Submissions are anonymous JSON posts handled by custom ante checks, with no Cosmos fee account. A 2-of-5 coordinator multisig opens rounds. Validators (≥10 planned) run a per-round DKG and hold decryption shares. Snapshot roots are **attested by coordinators**, who are asked to rebuild the nullifier tree themselves (`docs/imt-verification.md`). There is **no Zcash light client** on the vote chain.

Maturity:
- Audited by Fractal Development, 18–27 Mar 2026, report in `vote-sdk/audit/`: 1 critical, 4 high, 7 medium; 13 resolved and 2 accepted risk.
- The forum says YPIR has a Zellic audit. I haven't seen that report.
- Used for the Zcash NU7 coinholder vote, 25 Aug–14 Sep 2026 per the forum post, with Zodl and Vizor wallet support.
- The circuits had security updates in October 2026 (retro-grant post). The ZIPs are still drafts.
- Young but real and in production for governance.

Not verified: proving times on phones or in WASM (Valar quotes 1.1 s on an M4 Max for a merged ZKP 2 prototype and expects more than 2 s on mobile, from `voting-circuits/docs/design.md`); any browser/WASM build of `zcash_voting` (I found none); the Zellic report.

---

## 2. Mapping to tickets

| Vote SDK | Speakez ticket | Notes |
| --- | --- | --- |
| Ironwood note snapshot (ZKP 1) + PIR | **No equivalent needed.** The leaf `C` is inserted by the payment watcher from the shielded memo. | ZKP 1 proves a voter *still holds* funds. A ticket buyer has *spent* funds to the event, so the received note belongs to the operator. ZKP 1 doesn't fit ticket purchase and isn't needed. |
| VAN commitment in a Poseidon tree | `C = Poseidon(ticketSecret, sku, event_id)` in `guest_root` | Same role: an anonymous right that can be spent once. |
| `vote_comm_tree_root` at an authenticated anchor height | `guest_root` at an authenticated **doors-open epoch** | The verifier must take the root from the contract or published log, never from the prover or backend (Valar has the same "public input provenance" rule). |
| VAN nullifier `Poseidon(nk, tag, round, VAN)` | `N = Poseidon(ticketSecret, event_id)` | Already ours. Double-entry prevention is the same mechanism: a deterministic tag in a spent set. |
| `r_vpk = ak + [alpha]G`, RedPallas sig outside the circuit | **New: `rk = ak_t + [alpha]G`**, where `ak_t = [Poseidon("sezs-ticket-ak", ticketSecret)]·SpendAuthG` is derived *inside* the circuit | This is how consent survives without a correlator. See §4. The leaf format doesn't change. |
| ElGamal, threshold decryption, ZKP 3, DKG validators | Not needed | Tickets have no tally. The raffle uses the user's existing randomness contract. |
| Helper servers for timing spread | Not needed at the door | Arrival time is physical and visible anyway. |
| Anonymous submission by anyone | **Usher-only submission** (user's rule) | Fine. See §3.5. |

**Rails.** Our consume proof works over our own tree, not over chain state, so it doesn't care how `C` was paid for.
- **ZEC (Ironwood/Orchard shielded memo) and UM (Penumbra shielded memo) both fit.**
- Valar's ZKP 1 is Zcash-Ironwood-only, but we don't use ZKP 1.
- Penumbra's own proofs use a different curve stack (BLS12-377, decaf377). That doesn't matter because nothing here proves Penumbra state.

**Where the proof is built.** It has to be built on the **holder's device**, because the usher must never hold `ticketSecret`.
- Zafu's dapp API has no generic "prove this Halo2 circuit" method (`ZAFU-ZID-ZIRC-TICKETS.md`, `ZAFU_V1_METHODS`).
- So v1 would be a page-side WASM Halo2 prover. Our circuit is K=11 today (`terp/work/onboard-authz/src/sezs_consume.rs`) and would grow with ECC gadgets.
- Expect seconds, not milliseconds, on a phone. **This needs measuring.**
- A later Zafu method (for example `zafu_prove_ticket`) could keep the secret inside the wallet. That would extend the "derive" capability requested in the ZID doc.

**Proof cost on paper.**
- A Halo2 IPA proof for a circuit this size is probably a few KB. That may be over a QR code's ~2.9 KB binary limit, so it's **unverified and needs measuring**.
- If it doesn't fit, a printed ticket should carry a short random handle for a proof the holder already submitted (§4), not the proof itself.

---

## 3. Claim-by-claim verdict

### 3.1 "Akin to the Valar vote SDK"
**Mostly accurate, if we say which part.** We match Valar's **ZKP 2 spend pattern**: membership plus nullifier plus re-randomised key. We don't match its snapshot proof (ZKP 1), PIR, encrypted tally, or chain.

Code reuse is limited:
- Our Poseidon uses **custom round constants** (`SHA256("sezs-poseidon-pallas-t3-v1"||i)` in `onboard-authz/src/poseidon.rs`). Valar and Orchard use the standard `P128Pow5T3` constants.
- So Valar's `poseidon_merkle` gadget and `vote-commitment-tree` aren't hash-compatible with our leaves. To reuse them we'd have to switch constants, which changes every `C` value even though the leaf *shape* stays the same.
- What carries over cleanly is the **design and the Orchard/halo2_gadgets ECC pieces**: fixed-base `SpendAuthG` multiplication, the `rk` construction, and RedPallas verification. Licenses (MIT/Apache) allow reuse.

### 3.2 "Uses Zcash technology more directly"
**Partly.** We'd use the same cryptography as Zcash shielded spends: Halo2 on Pasta, Poseidon, nullifiers, and RedPallas re-randomised spend authorisation. We'd also follow a Zcash-community protocol design. Admission still **doesn't use Zcash notes or Zcash chain state**. A ticket is our own commitment, and Zcash (or Penumbra) is only the payment rail with `C` in the memo. Say "Zcash-style" or "built on Zcash's proving stack", not "on Zcash".

### 3.3 "Prevents the operator seeing which payment belongs to the person at the door"
**Accurate only after these conditions are met. As v1 is built today, it's false.**
1. **No correlators at purchase.** The invoice must not carry `N` or a ticket public key; v1 does both (`BACKEND-ROLE.md` step 1). The door must see only `(proof, N, rk, sig, root)` and never `C`.
2. **Consent redesigned** so the signing key is re-randomised per check-in and bound inside the proof (§4).
3. **Authenticated, shared root.** All holders must prove against the same published `guest_root` epoch. Otherwise the operator can give each buyer a slightly different tree and identify them by the root they use (a tagging attack). Wallets should read the root from the contract or a signed public log.
4. **Private witness fetch.** The holder must not ask the backend "give me the path for `C`" or "give me the envelope for `C`" near check-in time. With ≤ 256 leaves, **download the whole leaf list** (a few KB). That's the small-scale version of Valar's PIR. Fetch the sealed backup by invoice id well before the event, or fetch all envelopes. As specified today, check-in fetches the envelope by `C`, which is itself a correlator.
5. **Anonymity set.** The set is at most the paid tickets in that root epoch, so 150–300 for Speakez. A ticket bought at the door, or a root epoch with one new leaf, can shrink it to 1. Freeze the root at doors-open and batch late sales into fixed epochs.
6. **Proving `sku` would split the set by tier.** If `sku` becomes public, the set shrinks to that tier. Keep `sku` private in the proof; ushers can see the tier from the wristband or ticket colour.
7. **Physical and network metadata are untouched.** The operator still sees the face, the time, the door, the usher, and the device or IP if the holder's phone talks to the backend. The protocol hides **which invoice** (amount, rail, pay time, any purchase-time network metadata). It doesn't hide **who attended**.

### 3.4 "Keeps double-spend (double-entry) prevention"
**Accurate.** `N = Poseidon(secret, event_id)` is fixed by the secret, bound to a member leaf by the proof, and refused on reuse. That's the same as today and the same as Valar's VAN nullifier. Caveats that already exist today:
- The coordinator or watcher key can insert unpaid leaves (a payment-integrity issue, not a privacy one).
- Tickets are bearer: whoever presents first gets in.

### 3.5 "Only event admin ushers submit"
**Fine, and it helps.**
- The holder needs no chain account, gas, or network path to the chain, so the holder's IP never meets the consume transaction.
- The contract must still **verify the proof**. The usher gate is access control, not soundness.
- An usher can refuse or delay a submission (censorship). They can't forge an entry or learn `C`.
- The chain learns which usher or door and when, which is acceptable and already true.

### 3.6 "Increases privacy; only trade-off is no ETH"
**Privacy does increase, but ETH isn't the only trade-off, and dropping ETH isn't technically required.**
- The door proof would hide which payment arrived even for an ETH payer.
- ETH is dropped because the ETH payment itself publicly links an address to buying a Speakez ticket. That's the right call, but it's a payment-privacy choice, not something the proof forces.

Other real trade-offs:
- Proving on the holder's device takes seconds and needs a WASM prover; Zafu has no proving method yet.
- Live check-in needs a phone that works at the door.
- Printed tickets get more complex (§4).
- New circuit work with an ECC gadget needs an independent review.
- The verifier has to run somewhere (§3.7).
- Late buyers wait for a root epoch.
- It means more code, against the "less but better" brief.

### 3.7 "Event chain" with "IVC clients to an upper L1" and bridging assets out
**Not warranted for the pilot, and the terminology is off.**
- Valar runs its own chain because of things we don't need: anonymous fee-less submission through custom ante handlers, per-round DKG, and threshold decryption of tallies. Ticket consume is one proof check plus one set insert, submitted by an usher who has an account.
- Cheaper options, in order:
  - **(a) Off-chain Rust verifier** in the door backend, publishing `N`, the proof and the root to an append-only log for audit. The operator verifying doesn't hurt unlinkability, because the proof reveals only `N`.
  - **(b) CosmWasm `VerifyConsume` on Terp testnet** through zk-wasmvm `verify_halo2_proof`. This already exists in cw-ave and fails closed if the verifier is missing. Terp mainnet is halted.
  - **(c) A vote-sdk-style app-chain**: 4–8+ weeks plus validator operations for a 150–300 person event.
- **Terminology.** Cosmos chains connect through **IBC**, using **light clients** (ICS-02 client semantics, the 07-tendermint client). **IVC** (incrementally verifiable computation / proof-carrying data, as in Halo recursion, Nova or Mina) is a technique some teams use to build **zk light clients**: a succinct proof of a chain's header history that another chain verifies. So the accurate phrase is "IBC light clients (optionally zk light clients using recursive proofs)", not "IVC clients".
- **Bridging assets out.** Tickets here aren't transferable chain assets. ZEC and UM settle on Zcash and Penumbra and never enter Terp or an event chain. Zcash has no IBC, though Penumbra does. There's nothing to bridge out unless we later tokenise something (raffle prizes). Valar's own chain doesn't verify Zcash consensus either; its snapshot roots are attested by coordinators.

---

## 4. Main redesign: consent without a correlator

v1 registers `ticket_pk` and `N` next to `C` at invoice time, and the door checks a signature under `ticket_pk`. That registered key **is** the link from the body to the invoice. The Orchard/Valar pattern fixes it.

**Circuit `sezs_consume_v2`** (leaf format unchanged):
- Private inputs: `ticketSecret`, `sku`, Merkle path, `alpha`.
- Public inputs: `guest_root`, `N`, `event_id`, `rk_x`, `rk_y`, `domain_hash`.
- Constraints:
  1. `C = Poseidon(ticketSecret, sku, event_id)`, and `C` is on a path to `guest_root`. (Existing.)
  2. `N = Poseidon(ticketSecret, event_id)`. (Existing.)
  3. `ask = Poseidon(TAG_AK, ticketSecret, domain_hash)` converted to a scalar. `ak = [ask]·SpendAuthG` and `rk = ak + [alpha]·SpendAuthG`. This mirrors Valar ZKP 2 condition 4 and Orchard spend authority.
- Nothing about `ak` is ever registered with the backend.

**Live check-in:**
1. The door shows a challenge `(event_id, domain, session nonce, usher pubkey, timestamp)`.
2. The holder's device fetches the frozen root and all leaves, builds the proof with fresh `alpha`, and RedPallas-signs the challenge under `rsk = ask + alpha`.
3. The usher submits `(proof, N, rk, sig, challenge)`.
4. The verifier checks the proof, the signature under `rk`, that `N` is unused, and that the root is an authorised epoch. `rk` is fresh every time, so it can't be linked to anything.

**Printed ticket (paper is still bearer):**
1. At print time, the holder builds the proof with `rk` and signs `(event_id, domain, door_auth_pk, "printed")`.
2. If the bundle fits in a QR, print it.
3. If not, the holder uploads it under a random 128-bit handle `h`, and the paper carries `h`. Linking risk: upload time and IP. Upload through the same page well before the event, or with other traffic.
4. The door redeems once, because `N` is spent.
5. It must use the root epoch that is current at print time. That root has to stay accepted, so keep a short list of valid roots.

**Backend changes:**
- Remove `N` and `ticket_pk` from the invoice API.
- Publish root epochs (contract or signed log) and serve the full leaf list.
- Fetch envelopes by invoice id ahead of time, or fetch all envelopes.
- Update `BACKEND-ROLE.md`. The "accepted v1 trade" line goes away for v2.

A cheaper alternative with the same operator-unlinkability: **blind-signed admission tokens** (RFC 9474 RSA blind signatures, Privacy Pass style).
- At purchase, the watcher blind-signs a token for each paid `C`. At the door, the holder shows the unblinded token, and its serial is the spent tag.
- Much less code, with no prover on the phone.
- It isn't "Zcash tech". Consent would need a key inside the token, and redemption-time signing is still simple.
- It's worth keeping as a fallback if WASM proving is too slow.

---

## 5. Wording you can safely use (for example in grant docs)

> Speakez Sessions tickets use the same privacy pattern as Zcash shielded spends and the Zcash community's shielded coinholder voting (Valar Group): a ticket is a commitment in a Merkle tree. At the door, the holder's own device produces a Halo2 zero-knowledge proof that they hold *some* paid ticket. It reveals only a one-time nullifier and a fresh, re-randomised signing key that approves this check-in. Ushers submit the proof, the nullifier blocks reuse, and the event operator learns that a valid ticket was used, but not which shielded ZEC or UM payment it came from. Tickets are paid only over shielded rails (ZEC, Penumbra UM), so no payer address is ever linked to a ticket.

Add these qualifiers if space allows: "among the tickets sold before doors open"; "the operator still sees who physically attends"; "design adapted from, not a deployment of, Valar's vote SDK".

Avoid these phrasings:
- "uses Zcash notes for tickets" or "runs on Zcash"
- "fully anonymous attendance"
- "IVC clients"
- "bridges assets from the event chain"
- "the same audited circuits as Zcash voting". Our circuit would be new and unaudited.

---

## 6. Proposed architecture sketch

```
Buyer browser                     Watcher (backend)           Terp testnet / log          Door
-------------                     -----------------           ------------------          ----
seed -> ticketSecret
C = P(secret, sku, ev)  --memo sezs1:C via shielded ZEC/UM-->  sees C, amount
(no N, no pk sent)                 append C ------------------> guest_root epoch r_k (public)
seal secret -> ZID envelope (fetched by invoice id, early)
                                                               leaves list (public, <=256)
at door: fetch all leaves + r_k  <-----------------------------
prove sezs_consume_v2 (WASM) -> (pi, N, rk), sign challenge ------------------------------>  usher submits
                                                               verify pi, sig@rk,
                                                               N unused, r_k allowed  <-- VerifyConsume
                                                               record N
```

---

## 7. Effort estimate (rough, one engineer, not including external review)

| Item | Estimate |
| --- | --- |
| `sezs_consume_v2` circuit: ECC chips, in-circuit `ak` and `rk`, scalar-from-base, tests (custom Poseidon kept) | 1.5–3 weeks |
| WASM prover and witness builder in the app; phone timing measurement | 1–2 weeks |
| RedPallas signing in the browser, challenge flow, printed handle path | 3–5 days |
| Backend: drop `N`/`pk` at invoice, root epochs, leaf-list endpoint, envelope-by-invoice | 2–4 days |
| Verifier: (a) off-chain Rust | 2–4 days |
| Verifier: (b) CosmWasm through zk-wasmvm on Terp testnet | Unknown; depends on zk-wasmvm availability |
| Independent review of the new circuit | External, recommended before any real event |
| Dedicated event app-chain (vote-sdk fork) | 4–8+ weeks plus operations. **Not recommended for the pilot.** |

Recommended path: about **5–8 weeks** to a reviewed v2 door, or about 1–2 weeks for the blind-token fallback.

---

## 8. Open questions

1. Do we keep the custom SEZS Poseidon constants, or switch to the standard `P128Pow5T3` constants? Switching would let us reuse Orchard and Valar gadgets, but it changes every `C` value before launch.
2. Is unlinkability against the operator worth the phone-side proving cost for the pilot, or should the pilot use blind tokens and leave Halo2 v2 for later?
3. Where does the verifier run for the pilot: the off-chain log, or Terp testnet `VerifyConsume`, if zk-wasmvm is actually live there?
4. Root epoch policy: freeze at doors-open? How are tickets sold at the door handled? (Those have an anonymity set of 1, or are treated as cash-style entries.)
5. Should Zafu add a `prove/sign ticket` capability so the secret never sits in page JS? This extends the derive request in `ZAFU-ZID-ZIRC-TICKETS.md`.
6. Should we ask Valar Group to review the ticket circuit, since it mirrors their ZKP 2 condition 4/5 structure?
