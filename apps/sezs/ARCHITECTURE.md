# SEZS Speakeasy guest app

Loopback Next.js 13 (`output: 'export'`) at `127.0.0.1:3051`. Tunnel: `ssh -L 3051:127.0.0.1:3051 build-host`. Existing nginx `sezs-lan.conf` is fully commented (old `0.0.0.0:3050`). No second proxy. No mainnet txs from this app.

Area diagrams:

- [Sign-in / secrets](src/auth/ARCHITECTURE.md)
- [Tickets / pay](src/pay/ARCHITECTURE.md)
- [Admin FROST](src/frost/ARCHITECTURE.md)
- [Gallery / showcase](src/gallery/ARCHITECTURE.md)
- Mail gateway: `<repo>/e2e/lab/sezs/sezs-docs/EMAIL.md`

```mermaid
flowchart TB
  subgraph pages ["Guest pages :3051"]
    HOME["/"]
    T["/tickets"]
    K["/keys"]
    CI["/check-in"]
    G["/gallery"]
    FAQ["/faq"]
    N["/notes"]
    D["/desk"]
    A["/admin"]
    L["/lineup /night /stream /sponsors"]
  end

  subgraph src ["App modules"]
    AUTH["src/auth — Keplr / Zafu / browser key + PartitionedAllOf"]
    PAY["src/pay — ZEC then ETH then Base then Penumbra"]
    FROST["src/frost — roster, not a send"]
    SHOW["src/gallery — showcase draft + CollectionsPrep"]
    MAILC["src/notify — /sezs/mail"]
  end

  subgraph loop ["Loopback backends"]
    NEXT["Next 127.0.0.1:3051"]
    INBOX["FROST inbox 127.0.0.1:19091"]
    GW["mail-gateway 127.0.0.1:3061 spool .eml"]
    DREGG["DREGG 127.0.0.1:8421 — quoted, not paid"]
  end

  subgraph hop ["Existing nginx + tunnel"]
    NGX["sezs-lan.conf commented\nlocation / → :3051\nlocation /sezs/frost/ → :19091"]
    TUN["ssh -L 3051:127.0.0.1:3051"]
  end

  HOME --> AUTH
  T --> AUTH
  T --> PAY
  K --> AUTH
  CI --> AUTH
  G --> SHOW
  G --> AUTH
  FAQ --> MAILC
  N --> MAILC
  D --> FROST
  A --> FROST
  A --> AUTH
  PAY --> DREGG
  PAY --> INBOX
  FROST --> INBOX
  MAILC -->|"port 3051 fallback"| GW
  MAILC -.->|"same-origin /sezs/mail when hop is on"| NGX
  T --> NEXT
  G --> NEXT
  TUN --> NEXT
  NGX -.-> NEXT
  NGX -.-> INBOX
```

Tickets are pre-arrival. Cash App QR is door + Admin. Gallery Buy is off. Mail is spool only. FROST desk flags are not a send.
