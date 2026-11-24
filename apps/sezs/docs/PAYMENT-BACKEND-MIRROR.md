# Payment backend

Ticket checkout reuses the payment-status phases of the permissionless.money
SVG mint runtime (waiting, mempool, deposited, entitled, settled). A mempool
(0-conf) sighting is never treated as paid. Paid is only Deposited, Entitled,
or Settled (or `invoice.status === 'paid'`).

Loopback binds and ports are documented on the local-dev recipes, not hardcoded
as the default for a clean clone. Guest adapters do not fetch loopback.
