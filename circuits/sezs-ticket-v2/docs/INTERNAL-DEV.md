# Internal development notes — sezs-ticket-v2

Not for the public docs site. `scripts/sync-from-source.py` does not copy this file.

Root publish in the November 2026 development runs used a local `service` key as a stand-in for the principal FROST set. Payment observation in that environment (watchers, invoices, chain id `sezs-local-1`) is internal development work and must not appear on the public site. The public rule stands: the backend never learns the ticket secret.
