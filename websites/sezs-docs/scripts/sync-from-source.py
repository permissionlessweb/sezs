#!/usr/bin/env python3
"""Copy source-adjacent specs into this site at compile time.

Sources of truth stay next to the crates and apps. Do not edit the
generated copies under src/pages/specs/{event,ticketing,gallery,admin}.
Files named INTERNAL* are never copied.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ABSTRACT = Path.home() / "abstract"
SEZS_LAB = ABSTRACT / "sezs-lab"
SEZS_APP = ABSTRACT / "sezs-app"

def first_existing(*paths: Path) -> Path:
    for p in paths:
        if p.is_file():
            return p
    return paths[0]

BANNER = (
    "> **Generated — do not edit.** Source: `{src}`. "
    "Change the file next to the code, then rebuild this site.\n"
)

# dest relative to src/pages ; src path ; public source label (no repo folder names)
SOURCES: list[tuple[str, Path, str]] = [
    (
        "specs/event/index.mdx",
        first_existing(
            SEZS_APP / "contracts/cw-ave/contracts/cw-event-manifold/docs/SPEC.md",
            SEZS_LAB / "cw-ave/contracts/cw-event-manifold/docs/SPEC.md",
        ),
        "cw-event-manifold/docs/SPEC.md",
    ),
    (
        "specs/event/benchmark.mdx",
        first_existing(
            SEZS_APP / "contracts/cw-ave/contracts/cw-event-manifold/docs/BENCHMARK.md",
            SEZS_LAB / "cw-ave/contracts/cw-event-manifold/docs/BENCHMARK.md",
        ),
        "cw-event-manifold/docs/BENCHMARK.md",
    ),
    (
        "specs/ticketing/index.mdx",
        first_existing(
            SEZS_APP / "circuits/sezs-ticket-v2/docs/SPEC.md",
            SEZS_LAB / "sezs-ticket-v2/docs/SPEC.md",
        ),
        "sezs-ticket-v2/docs/SPEC.md",
    ),
    (
        "specs/gallery/index.mdx",
        SEZS_APP / "apps/sezs/src/gallery/docs/SPEC.md",
        "apps/sezs/src/gallery/docs/SPEC.md",
    ),
    (
        "specs/admin/index.mdx",
        SEZS_APP / "apps/sezs/src/frost/docs/SPEC.md",
        "apps/sezs/src/frost/docs/SPEC.md",
    ),
]


def mdx_safe(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<(https?://[^>\s]+)>", r"[\1](\1)", text)
    text = re.sub(r"\{([A-Za-z_][\w]*)\}", r"\1", text)
    text = re.sub(r"^> \[!(\w+)\]\s*$", r"> **\1**", text, flags=re.M)
    return text


def splice_banner(text: str, src_label: str) -> str:
    banner = BANNER.format(src=src_label)
    if text.startswith("---"):
        end = text.index("---", 3)
        return text[: end + 3] + "\n\n" + banner + "\n" + text[end + 3 :].lstrip()
    return banner + "\n" + text


def main() -> None:
    pages = ROOT / "src/pages"
    n = 0
    missing: list[str] = []
    for dest_rel, src, label in SOURCES:
        if src.name.upper().startswith("INTERNAL"):
            continue
        if not src.is_file():
            missing.append(str(src))
            continue
        out = pages / dest_rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(splice_banner(mdx_safe(src.read_text()), label))
        print(f"synced {out.relative_to(ROOT)} <- {label}")
        n += 1
    if missing:
        raise SystemExit("sync-from-source: missing " + " | ".join(missing))
    if n < 1:
        raise SystemExit("sync-from-source: copied 0 files")
    print(f"sync-from-source: {n} files")


if __name__ == "__main__":
    main()
