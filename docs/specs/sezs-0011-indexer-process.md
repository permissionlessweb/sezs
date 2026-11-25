```
ZIP: SEZS-0011
Title: Indexer Process
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Argus.** The contract-state indexer whose formula URL shape SEZS
  already speaks in the front end. The canonical upstream is
  [noahsaso/argus](https://github.com/noahsaso/argus).
- **Formula API.** `GET {base}/{chainId}/contract/{address}/{formula}?{args}`

## Abstract

The Indexer Process is a full fork of upstream
[Argus](https://github.com/noahsaso/argus) that implements formulas for the
SEZS session contract definitions ([SEZS-0003](sezs-0003-session-coordinator.md),
[SEZS-0004](sezs-0004-metadata-nip52.md), and the reused cw-ave / cw-420
queries). This repository specifies the API the rest of the stack targets.
The fork itself is a separate workstream and is not built in
[permissionlessweb/sezs](https://github.com/permissionlessweb/sezs).

Until an Argus instance with those formulas is deployed, clients MUST fall
back to LCD smart queries. A failing indexer MUST be skipped for a cool-down
so a dead indexer costs one request per window, not one per read.

## Motivation

`EventView` and related queries are enough to render the site from LCD, but
repeated LCD contract queries are a poor public path. An Argus fork that
understands SEZS formulas gives the same deterministic view at a stable URL
without putting a custom indexer into this monorepo.

The indexer is also the query-caching and load-balancing surface for event
backends. Cached formula results and the ability to place more than one
healthy indexer (or to fail over to LCD) are how the web app is expected
to reach sufficient scale and reliability as session traffic grows.

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
- An indexer base URL used on a public network MUST be served over a
  confidential transport.

## Specification

### URL shape

```
{base}/{chainId}/contract/{address}/{formula}?{args}
```

`base` is the configured indexer base URL. `chainId` is the Tendermint
chain id (for example the public Terp chain). `address` is the contract
address. `formula` names a derived view. Arguments are query-string
key/value pairs.

### Formulas the fork MUST implement

The fork MUST expose formulas that cover the cw-event-manifold queries in
[SEZS-0003](sezs-0003-session-coordinator.md), in particular `EventView`,
`Roles`, `PaidLeaves`, `Roots`, `NullifierSpent`, `Tiers`, `Lineup`, and
`ConsumeConfig`, plus the cw-420 member checks the door uses. Exact formula
names SHOULD match existing [Argus](https://github.com/noahsaso/argus)
conventions (`formula` as a path segment, arguments as query parameters)
and MUST be listed in the fork's own documentation when that workstream
publishes them.

### Client behaviour

If no indexer URL is configured, clients MUST query LCD only. If a request
fails, the client MUST mark that base unhealthy for a cool-down (sixty
seconds in the current front end) and fall back to LCD. Clients MAY use
more than one indexer base and MUST treat each as a cache and load-balance
source for the same deterministic view.

### Trait

`IndexerProcess` is a capability interface: given chain id, contract
address, formula, and arguments, it returns the JSON body or a miss.
SEZS does not ship an implementation in this repository.

## Rationale

Keeping the fork out of this monorepo avoids turning SEZS into an indexer
project and leaves a clean API boundary for the other workstream. Caching
and failover are specified here because they are part of how the web app
stays reliable, not because they change the contract schema.

## Reference Implementation

- Upstream Argus: [noahsaso/argus](https://github.com/noahsaso/argus)
- Client helper (not a server): `apps/sezs/src/query/indexer.ts`
- Trait (target): hash-market `IndexerProcess` (sezs feature)

## Open Issues

- Official formula names and response schemas will be published by the
  Argus-fork workstream; this document cites the URL shape and the
  contract queries that MUST be covered.
- No public Argus instance currently serves the production SEZS chain id.
