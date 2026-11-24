# Admin FROST — holders

The event page does not pay artists. Admin changes who may agree to a payout. Cash App stays on the door QR. Nothing on this page is a mainnet transaction.

```mermaid
flowchart TD
  subgraph browser ["Admin page, loopback"]
    A["Current holders"] --> B{"Propose add or remove"}
    B -->|"same group key"| R1["Refuse same_vk"]
    B -->|"new person agrees"| R2["Refuse not_admin"]
    B -->|"new key, current holder"| C["Pending roster"]
    C --> D{"t current holders agree"}
    D -->|"short"| C
    D -->|"enough"| E["New holders and new group key"]
    E --> F{"Rekey id recorded"}
    F -->|"no"| R3["Refuse rekey_incomplete"]
    F -->|"yes"| G["roster_commit for the inbox memo"]
  end
  subgraph lab ["Lab, loopback only"]
    H["Execute rotate_frost_pubkey if contract label is terp-frost"]
    I["HashMerchant inbox 127.0.0.1"]
    N["getrawtransaction 127.0.0.1:18232"]
  end
  E --> H
  G --> I
  F --> N
  N -->|"tx is not rotate_frost_pubkey from the old committee on this contract"| R4["Spend stays blocked"]
  U["Usher add or remove"] --> D
  D --> Door["Door check-in only for ushers still listed"]
```

Also refuse: `morocco-1`, a cross-site Origin, a claimed admin role, a replayed agreement, and a rekey id the local node does not have.


## What this page refuses

| Attempt | Result |
| --- | --- |
| Add or remove without a new group key | `same_vk` |
| Person being added agrees to their own addition | `not_admin` |
| One holder agrees and the roster already changes | stays pending |
| Remove so many holders that t no longer fits | `bad_threshold` |
| Reuse an agreement from an earlier change | `share_replay_epoch` |
| Spend after the key changes, before rekey | `rekey_incomplete` |
| Key package, mnemonic, or share bytes | not accepted; `keypackage_rejected` |
| Ticket marked paid from this page | not offered |
| Cash App checkout | door QR on Admin and Door only |
| Chain id morocco-1 | `mainnet_refused` |
| Cross-site POST | refused without this origin |
| Claimed admin role | ignored; cred must already be an admin |

Chain authority remains the lab contract `rotate_frost_pubkey` (Execute, not Authenticate). The inbox still requires `roster_commit` in `sezs-frost-memo-v1:`. A commit from the previous holder set is `roster_stale`.

## Load

The holder rules run in the browser with no extra request. The inbox call, when used, is the existing loopback rewrite to `127.0.0.1:19091`. This page does not add a proxy. The dev server is `next dev` on `127.0.0.1:3051`. Admin HTML is small; do not cache it as if a holder change had been finalized.


## Session and door

```mermaid
flowchart TD
  Browser["Admin or check-in page"] --> Cookie["HttpOnly sezs_session"]
  Cookie --> Gate{"Role"}
  Gate -->|"no cookie"| R401["401"]
  Gate -->|"usher on /sezs/frost"| R403["403 usher_not_frost"]
  Gate -->|"admin"| Jobs["FROST jobs"]
  Gate -->|"usher"| Door["/sezs/door/consume"]
  Door -->|"not on the list"| RU["not_usher"]
  Door -->|"ticket not paid"| UP["unpaid"]
  Door -->|"already used"| SP["nullifier_spent"]
```
