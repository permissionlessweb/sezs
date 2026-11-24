# Event Hub

Compose **Schedule** (dao-calendar), **Work** (bounties embed), **Collab** (Buzz), and **Ops** (Hermes) for one event context.

## Planes
- **chain** — on-chain calendar NFTs (default when `mesh.v1.query` is empty)
- **public / private** — optional HTTP indexes (`mesh.v1.queryPlanes`)

## Mesh
Reads `mesh.v1` from DAO storage → module values → chain defaults. Never invents relays.

## Registration
Use **Register for event** when the Registered chip is not green. Full ceremony/onboarding path is configured via mesh + onboarding invites.
