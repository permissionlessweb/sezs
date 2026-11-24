# Speak-Ez Sessions v0 iterations

16 November 2026 (Africa/Dakar, UTC+0).

Ranked work that makes a real event seamless, and where outside support
or grant funding (PEPL: Privacy Event PiLot) helps. Each item is one
reason, and whether it blocks the first real-money event.

## Blocks the first real-money event

1. **Independent circuit review of `sezs_consume_v2` and the on-chain
   verifier.** A missed soundness bug would admit a forged ticket or
   stall a real door. This should be done before any real funds or a
   public guest list. Grant-shaped: a named reviewer, a written report,
   and time to fix findings.

2. **Real Shielded ZEC and Penumbra (UM) payment watchers.** The v0
   watcher records a test payment against a memo `C`. A first event that
   takes real money has to confirm amount, memo, and destination on the
   real rails, fail closed on mismatch, and never see the ticket secret.
   Grant-shaped: watcher operations, testnet then limited mainnet, and
   on-call coverage through the sale window.

3. **A canonical, durable guest-list publication, not only a root.**
   Holders prove against the public leaf list. Today that list is served
   by the splash backend (`GET /sezs/v2/leaves`). The contract stores the
   root, epoch, and leaf count; `paid_leaves` on this deploy is empty.
   If the backend is lost, holders cannot rebuild a proof from the chain
   alone. Either store leaves on chain, or publish them with the same
   FROST signature as the root, in a place that outlives one server.
   This blocks a first event that must survive a backend outage.

## Should be in place for a seamless first door; not a soundness block

4. **Real FROST signing for `UpdateGuestRoot`.** The lab `service` key
   stands in for the principal admin FROST set. The stated threat model
   is that no single operator can publish a guest list. A small first
   event *could* run with a tightly held service key, but that is not
   the design we asked the community to trust. Grant-shaped: ceremony
   tooling, a coordinator set, and a rehearsal before doors open.

5. **Production BC-UR and RaptorQ encoders, shared with Zafu / Zigner.**
   The moving QR and the 5–9 print grid already carry the 4,321-byte
   bundle in this lab. Production encoders decide whether phones and
   printers at a real door are reliable, especially in bad light. The
   printed path can cover a first event if the lab framing is not
   trusted yet. Grant-shaped: a shared library, field testing, and
   fewer one-off framings.

6. **The gas cost of `proof_instance_verify` on the chain we will use.**
   On this local chain a live consume is about 288k gas and a printed
   consume about 286k. That is acceptable here. On a public chain it has
   to stay cheap enough for ushers to admit a line without hesitation,
   including at busy open. Measure on the target fee market before sale.
   Grant-shaped: fee subsidy or a runtime improvement if the number is
   too high.

7. **Move proving and consent signing into a Zafu wallet feature.**
   Today the browser worker holds the secret for a few seconds to prove
   and sign. That is honest, and it works. A wallet path keeps the
   secret out of the page, which matters on a shared or untrusted
   device. Not required if the first event is a room where guests bring
   their own phone and accept in-page proving. Grant-shaped: a Zafu
   feature, a review of the page-held-secret gap, and a fallback for
   guests without the extension (the print grid).

## Does not block the first event

8. **Upload the static front end on-chain**, using the same HTML-store
   contract design as the Headstash UI. Instantiation is already from a
   contract address plus chain config, so the app can be reused without
   a redesign. On-chain hosting removes a web origin we would otherwise
   have to trust, but a first event can ship from a known origin while
   that contract is finished and the bundle is pinned.

9. **NFC as another check-in transport.** The display path is already
   modular (animated QR, printed grid, NFC reserved). NFC does not
   change the proof or the contract. It should wait until there is
   hardware support; the print grid is the official fallback for guests
   who do not want to bring a phone.

10. **Usher-channel room secret kept out of the page.** The admin usher
    chat already states the limit: when this origin opens a sealed
    invite, the page holds the room secret. That is a staff-channel
    issue, not a ticket-soundness issue. A later wallet method can
    close the gap. Until then, treat the admin origin as trusted
    staff-only.

## Support that makes the whole line smoother

These are not blockers, but they are where help pays off: a short
rehearsal with real ushers and printed grids; an independent read of
`cw-event-manifold` and `sezs-ticket-v2-verify` alongside the circuit;
and a written runbook for root publish, watcher failure, and door
replay. The first event should be small enough that any one of those
can be done carefully, not skipped.
