# Lineup lanes

Status: draft. A design contract for a scalable event-lanes diagram driven
by the live schedule. Do not hardcode stages, hours, or set names. This
document does not change the current ring figure in `NightLanes`.

Language: short sentences, active voice. Read the schedule from the same
deterministic on-chain API the rest of the site uses. Do not invent rows.

## 1. Purpose

Show every timed set on a lane, on a shared time axis, for the night that
is on the event record. A guest can see what overlaps, where it happens,
and open a set’s detail without leaving the page.

The existing `NightLanes` figure is a concentric ring: one ring per lane,
arcs for sets, a side panel for the selected set. A lanes diagram is the
long-term layout: one horizontal (or stacked) track per stage or room.

## 2. Data contract

The page reads `EventManifold` (see `apps/sezs/src/event/api.ts` and
`fromManifold` in `apps/sezs/src/event/view.ts`). Nothing is hardcoded.

### Event bounds

| Field | Type | Use |
| --- | --- | --- |
| `event.start` | ISO-8601 | Origin of the time axis. Offset zero. |
| `event.end` | ISO-8601 | End of the time axis. |
| `event.timezone` | IANA tz | Clock labels. Format with `formatClock`. |

`nightLength` is `end - start` in minutes. If the span is missing or
non-positive, fall back to 7 hours so an empty axis still has a scale.
Do not invent a start time.

### Lanes

A lane is a stage or room id from the schedule, not a fixed list.

```
lane id  ←  LineupSlot.lane  and  TimelineItem.lane (when set)
label    ←  first letter uppercased, or a label the manifold later provides
```

`fromManifold` builds `Lane[]` as the unique ids in `data.lineup` and
`data.timeline`, stable-sorted with a preferred order when those ids are
present: `cellar`, `floor`, `alcove`, `door`, `back`. Any other id from
the record is appended in first-seen order. If the record has no lane
ids, the diagram has no tracks.

Do not keep a dead track for a preferred name that the night does not
use. Do not drop a lane the record does use.

### Sets (timed)

`LineupSlot` in the manifold:

| Field | Type | Use |
| --- | --- | --- |
| `id` | string | Selection key and URL hash (`/lineup#id`). |
| `handle` | string | Artist or act name. Click opens the existing artist info modal. |
| `role` | SlotRole | Visual kind: `dj` / `vj` / `host` → music; `vendor` / `flow` → service; else floor. |
| `start` | ISO-8601 | Block start. Minutes after `event.start` via `offsetMin`. |
| `durationMin` | number | Block end = start offset + duration. |
| `lane` | string | Track id. |
| `index` | number | Tie-break when two sets share a start. |

A slot with `durationMin >= 180` is an all-night presence. Do not draw it
as a timed block on the axis. List it in an “around / all night” row
beside or under the diagram (see `fromManifold().around`).

`TimelineItem` rows with a start and end (and not `untimed`) may also
become blocks on the lane in `item.lane` when that field is set. Untimed
timeline rows join the “around” list. They are not placed on the axis.

`fromManifold().sets` is the current timed list (`LineupSet`: `id`,
`name`, `lane`, `start`, `end`, `kind`, `setlist`, `tracks`). Reuse it.
`fmt(min)` prints a clock in the event timezone.

### Overlap

Two blocks on the same lane overlap when
`a.start < b.end && b.start < a.end`. The diagram must remain readable
when this happens: stack or inset overlapping blocks on that lane (a
second sub-row, or a shorter bar on the same track). Do not hide a set.
Do not move a set to another lane to avoid a collision. Cross-lane
overlap (same time, different rooms) is expected and is the point of
the figure — keep a shared vertical time cursor so the guest can compare.

## 3. Time axis

The axis spans `event.start` to `event.end`. Tick at one-hour steps (and
a final tick at the end if it is not on the hour). Labels use the event
timezone, not the browser zone. A now-indicator is optional and must use
the same origin; hide it when the night is not today.

Horizontal layout (desktop): time runs left → right; lanes are rows.
Vertical layout (narrow): time runs top → bottom; lanes are columns or
stacked rows. Pick one consistent mapping and keep hit targets large
enough for a finger.

## 4. Responsive

| Width | Layout |
| --- | --- |
| 1440 | All lanes visible in one figure. Time axis on the long edge. Selected set detail in a side panel, in parallel, not a popover. |
| 390 | Lanes stack or become a swipeable column. The axis remains the event bounds (do not crop the night to “now” unless the guest asks). Detail sits under the figure, still one panel, not a second copy of the same facts. |

The figure must scroll inside its own frame if the night is long or the
lane count is high. Do not shrink labels below a readable pixel size;
abbreviate the lane label or let the row scroll.

## 5. Interaction

- Click a block or its name: select that set. Update the side panel
  (time, lane, setlist badge or tracks). Artist names use `ArtistName`.
- Click the same set again: clear the selection, or keep it — pick one
  and stay consistent with `NightLanes`.
- Deep link: `/lineup#<slot id>` opens with that set selected and the
  block scrolled into view (`block: 'center'`). Do not jump the page to
  the top.
- Empty setlist: a compact badge (`No setlist` / `No set`), not a
  sentence.

## 6. Empty and loading states

Use badges, not paragraphs.

| State | Treatment |
| --- | --- |
| Manifold not loaded | A compact loading badge. No fake lanes. |
| No lineup slots and no timeline | One empty badge in place of the figure (“No sets”). |
| Lanes exist, no timed sets | Draw the axis and empty tracks. All-night rows may still list. |
| A set has no tracks | Badge on the detail panel, as today. |
| A slot has no start or a bad date | `offsetMin` returns 0 today; do not draw a misleading block at the origin unless the record really starts then. Prefer to omit a broken slot and log `console.warn`. |

Do not show contract or environment errors (for example an unpublished
door pointer) on this diagram. Log those to the console.

## 7. What not to do

- Do not ship a static mock of cellar / floor / alcove when the record
  has other rooms, or fewer rooms.
- Do not implement this figure until the design is agreed. `NightLanes`
  remains the live view.
- Do not fetch a second, different schedule. One manifold, one night.
