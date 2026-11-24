#!/usr/bin/env python3
"""STE-style lint for SEZS narration transcripts (YAML).

Rules (a small ASD-STE100-like subset, adapted for first-person narration):
- Descriptive sentences: 25 words or fewer
- Procedural sentences: 20 words or fewer
- Active voice (passive-voice heuristic)
- Banned filler words
- First-person plural openings (Let's, We, To …, we …) are allowed and
  preferred. Bare approved imperatives are still allowed.
- narration_ste must not contain development or seeded-demo terms
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

WPM = 140
DESC_LIMIT = 25
PROC_LIMIT = 20

APPROVED_IMPERATIVE = {
    "open", "go", "select", "enter", "scan", "show", "wait", "confirm",
    "sign", "save", "print", "transfer", "register", "check", "present",
    "read", "set", "point", "return", "hold", "admit", "refuse", "send",
    "create", "issue", "propose", "execute", "unlock", "connect", "buy",
    "keep", "record", "leave", "stop", "start", "use", "choose", "pick",
    "type", "paste", "copy", "close", "review", "accept", "decline",
    "authorize", "attach", "remove", "add", "rotate", "hash", "share",
    "treat", "complete", "find", "skip", "hide", "redact", "install", "do",
    "walk",
}

# First-person / first-person-plural openings preferred for spoken lines.
FIRST_PERSON = {
    "let's", "lets", "let", "we", "we'll", "we're", "we've",
    "i", "i'll", "i'm", "i've",
}

BANNED = {
    "utilize", "leverage", "currently", "please", "simply", "just",
    "basically", "really", "very", "ensure", "should", "might", "perhaps",
    "maybe", "click here", "in order to", "facilitate",
    "proceed to", "go ahead", "make sure", "you'll want", "we recommend",
    "todo", "tbd", "lorem", "ipsum", "kinda", "gonna", "wanna",
}

# Spoken lines only. Word-boundary checked. Multi-word phrases first.
DEV_PHRASES = (
    "cw-orch",
    "127.0.0.1",
    "seed.rs",
    "lantern night",
    "copper lantern",
    "harbor row",
    "trailblaze",
    "test-only",
    "dev infra",
    "demo holder",
    "demo holders",
    "walkthrough session",
)
DEV_WORDS = {
    "localhost", "devnet", "testnet", "loopback", "terpd", "relayer",
    "relayers", "lab", "labs", "seed", "seeds", "seeded", "port", "ports",
    "test", "tests", "testing", "cw-orch", "trailblaze",
}

PASSIVE = re.compile(
    r"\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+ed\b",
    re.I,
)
WORD = re.compile(r"[A-Za-z0-9']+")
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def load_yaml(path: Path):
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        return yaml.safe_load(text)
    raise RuntimeError(
        "PyYAML is required. Install with: python3 -m pip install --user pyyaml"
    )


def sentences(text: str) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    parts = SENT_SPLIT.split(text)
    return [p.strip() for p in parts if p.strip()]


def word_count(s: str) -> int:
    return len(WORD.findall(s))


def first_word(s: str) -> str:
    return (WORD.findall(s) or [""])[0].lower()


def is_first_person(s: str) -> bool:
    first = first_word(s)
    if first in FIRST_PERSON:
        return True
    # "To access the door, we open Check-in."
    if first == "to" and re.search(r"\bwe\b", s, re.I):
        return True
    return False


def is_procedural(s: str) -> bool:
    if is_first_person(s):
        return True
    return first_word(s) in APPROVED_IMPERATIVE


def is_command_like(s: str) -> bool:
    """True when the sentence looks like a bare instruction to the operator."""
    first = (WORD.findall(s) or [""])[0]
    if not first:
        return False
    if is_first_person(s):
        return False
    skip = {
        "the", "a", "an", "this", "that", "these", "those", "there", "it",
        "they", "we", "you", "when", "if", "after", "before", "each", "one",
        "no", "not", "now", "that",
    }
    if first.lower() in skip:
        return False
    return first[:1].isupper()


def lint_dev_terms(s: str, loc: str) -> list[str]:
    issues = []
    low = s.lower()
    for phrase in DEV_PHRASES:
        if phrase in low:
            issues.append(f"{loc}: development term {phrase!r} in narration: {s}")
    for word in sorted(DEV_WORDS, key=len, reverse=True):
        if re.search(r"\b" + re.escape(word) + r"\b", low):
            issues.append(f"{loc}: development term {word!r} in narration: {s}")
    return issues


def lint_sentence(s: str, loc: str) -> list[str]:
    issues = []
    wc = word_count(s)
    procedural = is_procedural(s)
    limit = PROC_LIMIT if procedural else DESC_LIMIT
    kind = "procedural" if procedural else "descriptive"
    if wc > limit:
        issues.append(f"{loc}: {kind} sentence has {wc} words (limit {limit}): {s}")
    low = s.lower()
    for ban in sorted(BANNED, key=len, reverse=True):
        if re.search(r"\b" + re.escape(ban) + r"\b", low):
            issues.append(f"{loc}: banned word/phrase {ban!r} in: {s}")
    if PASSIVE.search(s):
        issues.append(f"{loc}: passive-voice heuristic in: {s}")
    issues.extend(lint_dev_terms(s, loc))
    return issues


def lint_guide(path: Path) -> list[str]:
    data = load_yaml(path)
    issues: list[str] = []
    if not isinstance(data, dict):
        return [f"{path}: document is not a mapping"]
    steps = data.get("steps") or []
    for i, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            issues.append(f"{path}: step {i} is not a mapping")
            continue
        sid = step.get("id") or f"#{i}"
        loc = f"{path.name}:{sid}"
        narration = step.get("narration_ste") or ""
        for sent in sentences(narration):
            issues.extend(lint_sentence(sent, loc))
            if step.get("status") != "gap":
                if is_command_like(sent) and not is_procedural(sent):
                    issues.append(
                        f"{loc}: procedural line must start with Let's / We "
                        f"or an approved verb: {sent}"
                    )
        action = step.get("on_screen_action") or ""
        for sent in sentences(action if action.endswith((".", "!", "?")) else action + "."):
            wc = word_count(sent)
            if wc > 30:
                issues.append(f"{loc}: on_screen_action has {wc} words: {action}")
            low = sent.lower()
            for ban in BANNED:
                if re.search(r"\b" + re.escape(ban) + r"\b", low):
                    issues.append(f"{loc}: banned word {ban!r} in on_screen_action")
        # producer_note is not spoken; do not lint it for first-person or dev terms.
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="STE lint for narration YAML")
    ap.add_argument("root", nargs="?", default="docs/guides/narration")
    args = ap.parse_args()
    root = Path(args.root)
    if not root.exists():
        print(f"missing narration dir: {root}", file=sys.stderr)
        return 2
    files = sorted(p for p in root.glob("*.yaml") if p.name != "ste-lexicon.yaml")
    if not files:
        print(f"no narration yaml under {root}", file=sys.stderr)
        return 2
    all_issues = []
    for path in files:
        try:
            all_issues.extend(lint_guide(path))
        except Exception as exc:  # noqa: BLE001
            all_issues.append(f"{path}: {exc}")
    if all_issues:
        print(f"narration-lint: {len(all_issues)} issue(s)")
        for item in all_issues:
            print(f"  - {item}")
        return 1
    print(f"narration-lint: ok ({len(files)} guides)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
