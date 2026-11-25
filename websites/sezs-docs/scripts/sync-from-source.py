#!/usr/bin/env python3
"""Render the docs site specs from in-repo docs/specs at build time.

Numbered SEZS specifications (ZIP-style preambles) are the source of truth.
This script writes the specs index, one page per specification, and the
sidebar entries. Do not edit the generated copies.

Adjacent in-repo notes that are not numbered specifications (gallery, admin
capabilities, proof benchmarks) are copied from their paths in this
repository so a clean clone still builds. Machine-local trees such as
~/abstract/sezs-app are not consulted.
"""
from __future__ import annotations

import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
REPO = SITE.parent.parent
SPECS = REPO / "docs" / "specs"
PAGES = SITE / "src" / "pages"
GENERATED_DIR = SITE / "src" / "generated"
SPECS_OUT = PAGES / "specs"

PREAMBLE_RE = re.compile(r"^```(?:\w+)?\n(.*?)\n```", re.S)
ABSTRACT_RE = re.compile(r"^## Abstract\s*\n\n(.+?)(?:\n\n|\n## )", re.S)

# Source path is recorded at sync time in stdout only. Do not inject a
# visible "generated" banner into rendered pages.
BANNER = ""

# In-repo notes that are not numbered specifications. Copied so unique
# material (measured gas, gallery showcase, admin UI) still has a page.
# Event and ticketing SPEC.md files are stubs pointing at ZIP specs and
# are not copied.
NOTES: list[tuple[str, Path, str, str, str]] = [
    (
        "specs/event/benchmark.mdx",
        REPO / "contracts/cw-event-manifold/docs/BENCHMARK.md",
        "contracts/cw-event-manifold/docs/BENCHMARK.md",
        "Proof benchmarks",
        "Measured gas and prove times on a private development chain.",
    ),
    (
        "specs/gallery/index.mdx",
        REPO / "apps/sezs/src/gallery/docs/SPEC.md",
        "apps/sezs/src/gallery/docs/SPEC.md",
        "Digital gallery",
        "Showcase and collection viewer; planned escrow is marked as such.",
    ),
    (
        "specs/admin/index.mdx",
        REPO / "apps/sezs/src/frost/docs/SPEC.md",
        "apps/sezs/src/frost/docs/SPEC.md",
        "Admin capabilities",
        "cw420 usher hierarchy and the FROST admin UI.",
    ),
]

# Old hand-written / copied routes replaced by numbered specifications.
ABSORBED: list[tuple[str, str, list[str]]] = [
    (
        "specs/event/index.mdx",
        "Event contract",
        ["sezs-0003-session-coordinator", "sezs-0004-metadata-nip52"],
    ),
    (
        "specs/ticketing/index.mdx",
        "Ticketing",
        ["sezs-0001-ticketing-circuit", "sezs-0010-ticketing-process"],
    ),
]


def mdx_escape_braces(text: str) -> str:
    """Escape curly braces outside fenced code so MDX does not treat them as JSX."""
    out: list[str] = []
    in_fence = False
    open_esc = "{" + "'" + "{" + "'}"
    close_esc = "{" + "'" + "}" + "'}"
    for line in text.splitlines(True):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        escaped = []
        for ch in line:
            if ch == "{":
                escaped.append(open_esc)
            elif ch == "}":
                escaped.append(close_esc)
            else:
                escaped.append(ch)
        out.append("".join(escaped))
    return "".join(out)


def mdx_safe(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<(https?://[^>\s]+)>", r"[\1](\1)", text)
    text = re.sub(r"^> \[!(\w+)\]\s*$", r"> **\1**", text, flags=re.M)
    text = rewrite_spec_links(text)
    return mdx_escape_braces(text)


def rewrite_spec_links(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        label, target = m.group(1), m.group(2)
        name = Path(target).name
        if re.fullmatch(r"sezs-\d{4}(?:-[a-z0-9-]+)?\.md", name):
            return f"[{label}](/specs/{name[:-3]})"
        return m.group(0)

    return re.sub(r"\[([^\]]+)\]\(([^)]+\.md)\)", repl, text)


def parse_preamble(text: str) -> dict[str, str]:
    m = PREAMBLE_RE.match(text.lstrip())
    if not m:
        raise SystemExit("sync-from-source: missing ZIP preamble fence")
    headers: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip()] = value.strip()
    for req in ("ZIP", "Title", "Status", "Category", "Created"):
        if req not in headers:
            raise SystemExit(f"sync-from-source: preamble missing {req}")
    return headers


def first_sentence(text: str) -> str:
    m = ABSTRACT_RE.search(text)
    if not m:
        return ""
    para = re.sub(r"\s+", " ", m.group(1).strip())
    cut = re.split(r"(?<=[.!?])\s", para, maxsplit=1)[0]
    return cut.strip()


def frontmatter(title: str, description: str) -> str:
    desc = description.replace('"', "'")
    return f"---\ntitle: {title}\ndescription: {desc}\n---\n\n"


def splice_banner(text: str, src_label: str) -> str:
    # Kept as a hook for callers; rendered pages must not show a generated tag.
    return text


def load_specs() -> list[dict]:
    files = sorted(SPECS.glob("sezs-*.md"))
    if not files:
        raise SystemExit(f"sync-from-source: no sezs-*.md in {SPECS}")
    specs = []
    for path in files:
        text = path.read_text()
        headers = parse_preamble(text)
        specs.append(
            {
                "path": path,
                "stem": path.stem,
                "zip": headers["ZIP"],
                "title": headers["Title"],
                "status": headers["Status"],
                "category": headers["Category"],
                "created": headers["Created"],
                "abstract": first_sentence(text),
                "text": text,
                "src": f"docs/specs/{path.name}",
            }
        )
    specs.sort(key=lambda s: s["zip"])
    return specs


def write_spec_pages(specs: list[dict]) -> None:
    for s in specs:
        body = frontmatter(
            f"{s['zip']} · {s['title']}",
            s["abstract"] or f"{s['zip']} — {s['title']}",
        )
        # Pages are derived at build time; do not display a generated tag.
        body += mdx_safe(s["text"])
        if not body.endswith("\n"):
            body += "\n"
        out = SPECS_OUT / f"{s['stem']}.mdx"
        out.write_text(body)
        print(f"synced {out.relative_to(SITE)} <- {s['src']}")


def write_index(specs: list[dict]) -> None:
    cards = []
    rows = []
    for s in specs:
        href = f"/specs/{s['stem']}"
        desc = s["abstract"] or f"{s['status']} · {s['category']}"
        desc_attr = desc.replace('"', "'")
        cards.append(
            f'  <Card title="{s["zip"]} · {s["title"]}" description="{desc_attr}" to="{href}" />'
        )
        rows.append(
            f"| [{s['zip']}]({href}) | {s['title']} | {s['status']} | {s['category']} |"
        )
    note_cards = [
        '  <Card title="Proof benchmarks" description="Measured gas and prove times on a private development chain." to="/specs/event/benchmark" />',
        '  <Card title="Digital gallery" description="Showcase and collection viewer; planned escrow is marked as such." to="/specs/gallery" />',
        '  <Card title="Admin capabilities" description="cw420 usher hierarchy and the FROST admin UI." to="/specs/admin" />',
    ]
    text = (
        frontmatter(
            "Specifications",
            "Numbered SEZS specifications rendered from docs/specs at build time.",
        )
        + "import { Card, Cards } from 'vocs'\n\n"
        + "# Specifications\n\n"
        + "These pages are rendered from the numbered files in `docs/specs/` when "
        + "the site is built. Edit those files, then rebuild. They follow the "
        + "ZIP-0000 document shape. They are SEZS specifications, not Zcash "
        + "Improvement Proposals.\n\n"
        + "<Cards>\n"
        + "\n".join(cards)
        + "\n</Cards>\n\n"
        + "| ID | Title | Status | Category |\n"
        + "| --- | --- | --- | --- |\n"
        + "\n".join(rows)
        + "\n\n"
        + "Formal models live in `docs/specs/quint/`.\n\n"
        + "## Adjacent notes\n\n"
        + "`LINEUP-LANES.md` and `GUIDES-AND-DEMO-ENGINE.md` in `docs/specs/` are "
        + "not protocol specifications. The pages below are still copied from "
        + "in-repo notes that have not been numbered yet.\n\n"
        + "<Cards>\n"
        + "\n".join(note_cards)
        + "\n</Cards>\n"
    )
    out = SPECS_OUT / "index.mdx"
    out.write_text(text)
    print(f"wrote {out.relative_to(SITE)}")


def write_notes() -> None:
    for dest_rel, src, label, title, description in NOTES:
        if not src.is_file():
            raise SystemExit(f"sync-from-source: missing note {src}")
        out = PAGES / dest_rel
        out.parent.mkdir(parents=True, exist_ok=True)
        body = frontmatter(title, description) + mdx_safe(src.read_text())
        out.write_text(splice_banner(body, label))
        print(f"synced {out.relative_to(SITE)} <- {label}")


def write_absorbed(specs: list[dict]) -> None:
    by_stem = {s["stem"]: s for s in specs}
    for dest_rel, title, stems in ABSORBED:
        links = []
        for stem in stems:
            s = by_stem[stem]
            links.append(f"- [{s['zip']} · {s['title']}](/specs/{s['stem']})")
        body = (
            frontmatter(title, f"See the numbered specifications for {title.lower()}.")
            + f"# {title}\n\n"
            + "This page previously copied a source-adjacent `SPEC.md`. "
            + "That note was absorbed into the numbered specifications:\n\n"
            + "\n".join(links)
            + "\n"
        )
        out = PAGES / dest_rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body)
        print(f"wrote absorbed stub {out.relative_to(SITE)}")


def write_sidebar(specs: list[dict]) -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    items = ['    { text: "Index", link: "/specs" }']
    for s in specs:
        items.append(
            f'    {{ text: "{s["zip"]} · {s["title"]}", link: "/specs/{s["stem"]}" }}'
        )
    items.append('    { text: "Proof benchmarks", link: "/specs/event/benchmark" }')
    items.append('    { text: "Digital gallery", link: "/specs/gallery" }')
    items.append('    { text: "Admin capabilities", link: "/specs/admin" }')
    text = (
        "// Generated by scripts/sync-from-source.py. Do not edit.\n"
        "export const specSidebarItems = [\n"
        + ",\n".join(items)
        + ",\n]\n"
    )
    out = GENERATED_DIR / "spec-sidebar.ts"
    out.write_text(text)
    print(f"wrote {out.relative_to(SITE)}")


def prune_stale_generated(specs: list[dict]) -> None:
    keep = {f"{s['stem']}.mdx" for s in specs} | {"index.mdx"}
    if SPECS_OUT.is_dir():
        for p in SPECS_OUT.glob("sezs-*.mdx"):
            if p.name not in keep:
                p.unlink()
                print(f"removed stale {p.relative_to(SITE)}")


def main() -> None:
    if not SPECS.is_dir():
        raise SystemExit(f"sync-from-source: missing {SPECS}")
    SPECS_OUT.mkdir(parents=True, exist_ok=True)
    specs = load_specs()
    prune_stale_generated(specs)
    write_spec_pages(specs)
    write_index(specs)
    write_notes()
    write_absorbed(specs)
    write_sidebar(specs)
    print(f"sync-from-source: {len(specs)} specifications")


if __name__ == "__main__":
    main()
