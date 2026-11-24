# Calendar module (dao-dao FE)

Schedule / browse DAO events. Enable/edit publishes **mesh.v1** (headstash defaults + calendar contract). Reads prefer the HTTP **query plane** (`listEvents`); on-chain CW721 is the durable fallback.

## Query plane vs blossom / QMD (lab ops)

**Symptom:** Event Hub / CalendarEventsPanel shows empty list or soft-unavailable copy (`Failed to fetch`, HTTP 404) while operators claim “headstash is up” because `/health` is 200.

**Root cause (lab deploy-host):** `mesh.v1` often sets `query` to `http://localhost:19090`. On that host, **:19090 is currently a blossom/QMD TreeStore surface**, not a calendar index HTTP API.

| Probe (from lab / hop) | Expected when miswired | Meaning |
|------------------------|------------------------|---------|
| `curl -m2 -o/dev/null -w '%{http_code}\n' http://localhost:19090/health` | **200** | Process is up (blossom/QMD health) |
| `curl -m2 -o/dev/null -w '%{http_code}\n' http://localhost:19090/listEvents` | **404** | No calendar `listEvents` path on that base |

**`:19090/health == 200` does not mean calendar `listEvents` works.** Soft-fail in `CalendarEventsPanel` is intentional for 404 / Failed to fetch / 5xx / connection errors so the UI does not alarm when the optional query plane is wrong or empty. On-chain schedule (CW721 / dao-calendar) is unchanged.

### Fix options (pick one)

1. Point `mesh.v1.query` at a real headstash/calendar query plane that implements `listEvents` (or equivalent mesh client paths).
2. Leave mesh as-is and rely on **on-chain** event reads (panel falls through when query returns empty/errors).
3. Deploy/run the correct query-plane container on the published base URL (do not assume compose `:19090` = listEvents).

### Lab topology (reference)

- SDA + chain: build-host `192.168.0.4` — SDA `:3000`, RPC `:26657`, LCD `:1317`
- headstash / hash-market-lab: deploy-host `localhost:19090` (container often maps host 19090 → 9090)

Optional hop probes (operators):

```bash
# from a host that can reach deploy-host, or via hop build-host→deploy-host
curl -m2 -sS -o/dev/null -w 'health %{http_code}\n' http://localhost:19090/health
curl -m2 -sS -o/dev/null -w 'listEvents %{http_code}\n' http://localhost:19090/listEvents
```

## Soft-fail (product)

See `CalendarEventsPanel.tsx`: soft empty-state for query-plane and chain soft-fails; technical detail lives under a collapsed “Technical details” disclosure. Empty `all_tokens` is a **normal product state**, not a red error.

## Clear styling (EN-F4 / P1.2)

- **Tokens only:** `border-border-*`, `bg-background-*`, `text-text-*`, `ring-border-interactive-focus` — no raw gray/blue Tailwind.
- **Selected rows** (Event Hub): `bg-background-interactive-selected` + `ring-border-interactive-focus` (same Clear pattern as multi-auth highlight).
- **Quiet for Event Hub:** `EventCalendarStrip` passes `compact` so source line / plane switcher stay out of first paint.
- **Named empties:** loading / soft-unavailable / no-events each have product copy; raw errors stay under Technical details.
- **Operator mesh** (storage / query / relays) lives in `DevOpsDisclosure`, not above the fold.

## Product UX (CAL-UX-1 / 2 / 3 — epic t_4299019a)

| Piece | Role |
|-------|------|
| `calendarGrid.ts` | Pure month/week cell builders + local/UTC range format |
| `CalendarMonthGrid.tsx` | Month (required) + week grid; chips + `+N` overflow |
| `CalendarEventDetail.tsx` | Detail surface (title, local+UTC, access, description, CID pointer); Escape closes |
| `CalendarEventsPanel.tsx` | View toggle **Calendar** (default) vs **Schedule list**; `sessionStorage` key `dao-dao.calendar.viewMode` |
| `CalendarRenderer.tsx` | Passes `showDetail` + `defaultView="grid"` |

Event Hub strip remains **compact list** (no grid competition with Event Hub chrome). Same `PanelEvent` / chain+query data for all views.


## Sample public event (open-lab / 120u-1)

Open-lab calendar (CW721 / dao-calendar):

`terp13ehuhysn5mqjeaheeuew2gjs785f6k7jm8vfsqg3jhtpkwppcmzq7l3af7`

**Minter is the DAO** (or pre-propose path) — browsers cannot mint without a signed DAO proposal / minter wallet.

### Option A — DAO proposal (preferred product path)

1. Open the open-lab DAO → **Proposals** → execute a wasm message on the calendar contract.
2. Mint path is CW721 `mint` with NIP-style extension, or module `update_extension` / `CreateEvent` depending on deployed code_id.
3. Typical shape (illustrative — match live schema for code_id 7):

```json
{
  "mint": {
    "token_id": "evt/lab-demo-1",
    "owner": "<dao-or-recipient>",
    "token_uri": null,
    "extension": {
      "d_tag": "lab-office-hours",
      "start_time": "2026-08-10T17:00:00Z",
      "end_time": "2026-08-10T18:00:00Z",
      "private": false
    }
  }
}
```

Or `CreateEvent` if the calendar NFT `d` already exists:

```json
{
  "update_extension": {
    "msg": {
      "create_event": {
        "d": "cal/open-lab",
        "event": {
          "d_tag": "lab-office-hours",
          "start_time": "2026-08-10T17:00:00Z",
          "end_time": "2026-08-10T18:00:00Z"
        }
      }
    }
  }
}
```

### Option B — CLI as minter (ops only)

When `terpd` keys hold minter rights (usually they do **not** on open-lab — DAO owns minter):

```bash
# Verify empty schedule via SDA LCD proxy (from 192.168.0.4):
B64=$(printf %s '{"all_tokens":{"limit":5}}' | base64)
curl -sS "http://127.0.0.1:3000/lab-lcd/cosmwasm/wasm/v1/contract/terp13ehuhysn5mqjeaheeuew2gjs785f6k7jm8vfsqg3jhtpkwppcmzq7l3af7/smart/${B64}"
# → {"data":{"tokens":[]}}

# After a successful mint proposal executes, FE Event Hub / Calendar strip lists the token.
```

**Do not** point `mesh.v1.query` at blossom `:19090` and expect events — that is TreeStore health, not `listEvents`. Leave query empty for **chain-only**.

## Non-goals this note

Full headstash/indexer rewrite; forcing mesh.v1 on-chain rewrite without ops choice; hosts outside lab `192.168.0.4` / `localhost`.
