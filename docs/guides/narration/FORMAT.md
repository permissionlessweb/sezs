# Narration transcript format

Schema version `1.1.0`. Machine-readable schema: [`schema.json`](schema.json).
Guides written for `1.0.0` can be read through the in-memory migration in
`scripts/narration-validate.py`.

A guide is one YAML file in this directory. It defines the audience, the
prerequisites, the user constraints, and a flow graph. Each step carries spoken
narration in a Simplified Technical English style, the on-screen action, a
trail step reference, the expected UI, earmarked video slots, transitions,
timing, a surface-flow node, optional recorder notes, and empty audio render
fields for TTS and human takes.

The spoken line is for the person reading the guide aloud to viewers. It is
first-person and product-facing. Recorder notes are never spoken.

## Voice

Speak as the person walking the viewer through the product:

- Prefer first-person plural: "Let's walk through…", "We open…", "To access
  the door, we…".
- Keep the language clear and plain.
- Address the product flow as a user experiences it.

## STE style

Follow a small ASD-STE100-like subset ([ASD-STE100](https://www.asd-ste100.org/)),
adapted for this voice:

- Short sentences. One action in each procedural sentence.
- Active voice.
- First-person plural is allowed and preferred for narration. Bare
  imperatives ("Select Open camera.") are still allowed, but "We select Open
  camera." is the usual form.
- Descriptive sentences: 25 words or fewer.
- Procedural sentences: 20 words or fewer.
- Use the approved verb list in [`ste-lexicon.yaml`](ste-lexicon.yaml) for
  actions. Do not use banned filler words.
- Do not put development or lab terms in `narration_ste`. See the banned
  development list in the lint. Refer to events and prices generically
  ("the event", "your ticket tier").

`make narration-lint` checks length, banned words, development terms,
passive-voice heuristics, and openings. `make narration-validate` checks
this schema.

## Fields

Per guide: `schema_version`, `id`, `title`, `status` (`complete`, `draft`,
`has_gaps`), `audience`, `prerequisites`, `user_constraints`, `flow_graph`,
optional `derived_graphs` and `surfaces`, `event`, `timing`, `audio`,
optional `producer_note`, `steps`.

`producer_note` on the guide or on a step is for the recorder only. It is
not rendered to audio and must not be used as a spoken line. Put local
infra, seeded records, Trailblaze trails, and capture caveats there.

Per step: `id`, `status` (`complete` or `gap`), optional `gap` (required
when status is `gap`), optional `role` (`intro`, `step`, or `outro`),
`narration_ste`, `on_screen_action`, `trail_step` (string or `null` until a
trail exists), `expected_ui`, `video_slots`, `transitions`,
`estimated_speech_seconds`, `word_count`, `audio_render`, `flow_node`,
optional `producer_note`.

Each guide must have one `intro` step and one `outro` step in the same
voice as the rest of the transcript.

`flow_node` is the mermaid node id in the guide's surface flow
(`docs/flows/surfaces/<guide>.mmd`). The studio Record view highlights
that node on the surface SVG.

Video slot `type`: `web-capture`, `mobile-wallet-capture`, `device-camera`,
`still-screenshot`, `title-card`. Each slot names the source app or device,
a target duration, a path, and `captured` or `placeholder`. Placeholder
slots must include a `capture_checklist`.

Transitions name two slots on the same step and a type: `cut`, `dissolve`,
`wipe`, `hold`, `match-cut`.

## Gaps

If the current app has no screen for a step, set `status: gap` and explain
the gap in `gap` and, if needed, in `producer_note`. Word `narration_ste`
as product flow anyway. Do not invent UI. Do not put a task-tracker tag
into the spoken line.

## Event data

Spoken lines do not name a seeded demo event, a venue from a seed record,
or a list price. Say "the event" and "your ticket tier". The live page
may still show the event title from the event record. Recorder detail
belongs in `producer_note`.
