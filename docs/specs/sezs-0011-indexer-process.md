```
ZIP: SEZS-0011
Title: Indexer Process
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Argus.** The contract-state indexer whose formula URL shape SEZS
  already speaks in the front end.
- **Formula API.** `GET {base}/{chainId}/contract/{address}/{formula}?{args}`

## Abstract

The Indexer Process is a full Argus fork that implements formulas for the
SEZS event contract definitions (sezs-0003, sezs-0004, and the reused
cw-ave / cw-420 queries). This repository specifies the API the rest of
the stack targets. The fork itself is a separate workstream and is not
built in permissionlessweb/sezs.

Until an Argus instance with those formulas is deployed, clients MUST fall
back to LCD smart queries. A failing indexer MUST be skipped for a cool-down
so a dead indexer costs one request per window, not one per read.

## Motivation

`EventView` and related queries are enough to render the site from LCD, but
repeated LCD contract queries are a poor public path. An Argus fork that
understands SEZS formulas gives the same deterministic view at a stable URL
without putting a custom indexer into this monorepo.

## Privacy Implications

An indexer holds public contract state and derived formulas. It MUST NOT be
given ticket secrets, session tables, or email addresses. Indexer operators
can see the same public data a full node can see, including nullifiers and
paid commitments.

## Requirements

- The Rust `IndexerProcess` trait in hash-market MUST target the formula
  API below, not a private schema.
- This monorepo MUST NOT implement the Argus fork.
- Clients MUST treat the indexer as optional. If it is unset or unhealthy,
  they MUST use LCD.
- An indexer base URL, when configured, MUST be `https` or loopback `http`.

## Specification

### URL shape

```
{base}/{chainId}/contract/{address}/{formula}?{args}
```

`base` comes from configuration (the front end today uses
`NEXT_PUBLIC_SEZS_INDEXER` when set). `chainId` is the Tendermint chain
id (for example the public Terp chain). `address` is the contract
address. `formula` names a derived view. Arguments are query-string
key/value pairs.

### Formulas the fork MUST implement

The fork MUST expose formulas that cover the cw-event-manifold queries in
sezs-0003, in particular `EventView`, `Roles`, `PaidLeaves`, `Roots`,
`NullifierSpent`, `Tiers`, `Lineup`, and `ConsumeConfig`, plus the cw-420
member checks the door uses. Exact formula names SHOULD match existing
Argus conventions (`formula` as a path segment, arguments as query
parameters) and MUST be listed in the fork's own documentation when that
workstream publishes them.

### Client behaviour

If no indexer URL is configured, clients MUST query LCD only. If a request
fails, the client MUST mark that base unhealthy for a cool-down (sixty
seconds in the current front end) and fall back to LCD.

### Trait

`IndexerProcess` is a capability interface: given chain id, contract
address, formula, and arguments, it returns the JSON body or a miss.
SEZS does not ship an implementation in this repository.

## Rationale

Keeping the fork out of this monorepo avoids turning SEZS into an indexer
project and leaves a clean API boundary for the other workstream.

## Reference Implementation

- Client helper (not a server): `apps/sezs/src/query/indexer.ts`
- Trait (target): hash-market `IndexerProcess` (sezs feature)

## Open Issues

- Official formula names and response schemas will be published by the
  Argus-fork workstream; this document cites the URL shape and the
  contract queries that MUST be covered.
- No public Argus instance currently serves the production SEZS chain id.
