# Product flows

Two layers live here.

## `derived/`

Graphs produced by Trailmark from the current source. Do not hand-edit the
`.mmd` files. Refresh them with `make flows-derive`.

Trailmark: <https://github.com/trailofbits/trailmark>

The diagrams follow Trail of Bits’ mermaid skill:

- Repo: <https://github.com/trailofbits/skills>
- Path: [`plugins/trailmark/skills/diagramming-code/SKILL.md`](https://github.com/trailofbits/skills/blob/main/plugins/trailmark/skills/diagramming-code/SKILL.md)

This tree uses Trailmark 0.8.0 and the native `trailmark diagram` command
(the skill’s version gate starts at 0.4.0). SVG rendering uses
`docs/specs/diagrams/mermaid-theme.json`. Very large derived graphs are
simplified for SVG only (proxy nodes dropped). The source `.mmd` stays
complete.

TypeScript React components are often a single module node with no call
edges. Use the curated surfaces plus the cited source files when that
happens.

## `surfaces/`

Curated per-guide product flows for the eight narration guides. Each file
cites the derived graphs and the functions or components it was checked
against, and marks gaps.
