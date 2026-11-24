# SEZS Speakeasy guest app

Loopback Next.js 13 (`output: 'export'`) at `127.0.0.1:3051`. An optional SSH local-forward of port 3051 to that loopback address can be used when browsing from another machine. Existing nginx `sezs-lan.conf` is fully commented (old `0.0.0.0:3050`). No second proxy. No mainnet txs from this app.

Area diagrams:

- [Sign-in / secrets](src/auth/ARCHITECTURE.md)
- [Tickets / pay](src/pay/ARCHITECTURE.md)
- [Admin FROST](src/frost/ARCHITECTURE.md)
- [Gallery / showcase](src/gallery/ARCHITECTURE.md)
- Mail: in-process on `sezs-server` when `SEZS_EMAIL_ENABLE=1` (file sink, 4 KiB cap)

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
    SRV["sezs-server 127.0.0.1:3058 — /sezs one bind"]
    OUT["sezs-outpost 127.0.0.1:3061 — usher BLE"]
    DREGG["DREGG 127.0.0.1:8421 — quoted, not paid"]
  end

  subgraph hop ["Existing nginx + tunnel"]
    NGX["sezs-lan.conf commented\nlocation / → :3051\nlocation /sezs/ → :3058"]
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
  PAY --> SRV
  FROST --> SRV
  MAILC -->|"/sezs/mail on the one bind"| SRV
  MAILC -.->|"same-origin /sezs when hop is on"| NGX
  T --> NEXT
  G --> NEXT
  TUN --> NEXT
  NGX -.-> NEXT
  CI --> OUT
  NGX -.-> SRV
```

Tickets are pre-arrival. Cash App QR is door + Admin. Gallery Buy is off. Mail is a file sink on the one bind when enabled. FROST desk flags are not a send.
