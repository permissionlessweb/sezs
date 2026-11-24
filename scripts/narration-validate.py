#!/usr/bin/env python3
"""Validate SEZS narration transcripts against the versioned JSON Schema."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

SLOT_TYPES = {
    "web-capture",
    "mobile-wallet-capture",
    "device-camera",
    "still-screenshot",
    "title-card",
}
TRANSITIONS = {"cut", "dissolve", "wipe", "hold", "match-cut"}
STEP_STATUS = {"complete", "gap"}
GUIDE_STATUS = {"complete", "draft", "has_gaps"}


def load_yaml(path: Path):
    if yaml is None:
        raise RuntimeError(
            "PyYAML is required. Install with: python3 -m pip install --user pyyaml"
        )
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def require(cond: bool, issues: list[str], msg: str) -> None:
    if not cond:
        issues.append(msg)


SCHEMA_VERSION = "1.1.0"


def migrate(data: dict) -> tuple[dict, bool]:
    """Upgrade a 1.0.0 document in memory to 1.1.0 field shape.

    Does not invent intro/outro steps or spoken lines. Missing flow_node
    is left as None so later checks can report it.
    """
    if not isinstance(data, dict):
        return data, False
    ver = data.get("schema_version")
    if ver == SCHEMA_VERSION:
        return data, False
    if ver != "1.0.0":
        return data, False
    data = dict(data)
    data["schema_version"] = SCHEMA_VERSION
    if "producer_note" not in data:
        data["producer_note"] = None
    steps = []
    for step in data.get("steps") or []:
        if not isinstance(step, dict):
            steps.append(step)
            continue
        s = dict(step)
        s.setdefault("producer_note", None)
        s.setdefault("flow_node", None)
        s.setdefault("role", "step")
        steps.append(s)
    data["steps"] = steps
    return data, True


def validate(path: Path, schema: dict) -> list[str]:
    issues: list[str] = []
    data = load_yaml(path)
    require(isinstance(data, dict), issues, f"{path.name}: not a mapping")
    if not isinstance(data, dict):
        return issues
    for key in (
        "schema_version",
        "id",
        "title",
        "status",
        "audience",
        "prerequisites",
        "user_constraints",
        "flow_graph",
        "event",
        "timing",
        "audio",
        "steps",
    ):
        require(key in data, issues, f"{path.name}: missing {key}")
    data, migrated = migrate(data)
    if migrated:
        print(f"{path.name}: migrated schema 1.0.0 -> 1.1.0 in memory")
    require(
        data.get("schema_version") == schema.get("x-sezs-schema-version", "1.1.0"),
        issues,
        f"{path.name}: schema_version must be 1.1.0 (got {data.get('schema_version')!r})",
    )
    require(
        data.get("status") in GUIDE_STATUS,
        issues,
        f"{path.name}: status must be one of {sorted(GUIDE_STATUS)}",
    )
    require(isinstance(data.get("prerequisites"), list), issues, f"{path.name}: prerequisites must be a list")
    require(isinstance(data.get("user_constraints"), list), issues, f"{path.name}: user_constraints must be a list")
    require(isinstance(data.get("audience"), str) and data.get("audience"), issues, f"{path.name}: audience required")
    require(isinstance(data.get("flow_graph"), str) and data["flow_graph"].endswith(".mmd"), issues, f"{path.name}: flow_graph must point at a .mmd")
    ev = data.get("event") or {}
    require(isinstance(ev, dict) and ev.get("name") and ev.get("source"), issues, f"{path.name}: event.name and event.source required")
    timing = data.get("timing") or {}
    require(isinstance(timing, dict) and "estimated_speech_seconds" in timing, issues, f"{path.name}: timing.estimated_speech_seconds required")
    audio = data.get("audio") or {}
    require(isinstance(audio, dict) and "tts" in audio and "human" in audio, issues, f"{path.name}: audio.tts and audio.human required")
    steps = data.get("steps") or []
    require(isinstance(steps, list) and len(steps) >= 1, issues, f"{path.name}: at least one step required")
    ids = set()
    slot_ids = set()
    speech_sum = 0.0
    for i, step in enumerate(steps, 1):
        loc = f"{path.name}:step[{i}]"
        if not isinstance(step, dict):
            issues.append(f"{loc}: not a mapping")
            continue
        sid = step.get("id")
        require(isinstance(sid, str) and sid, issues, f"{loc}: id required")
        if sid in ids:
            issues.append(f"{loc}: duplicate id {sid}")
        ids.add(sid)
        require(step.get("status") in STEP_STATUS, issues, f"{loc}: status must be complete or gap")
        if step.get("status") == "gap":
            require(isinstance(step.get("gap"), str) and step["gap"].strip(), issues, f"{loc}: gap steps must explain the gap")
        else:
            require(not step.get("gap"), issues, f"{loc}: complete steps must not set gap")
        require(isinstance(step.get("flow_node"), str) and step["flow_node"].strip(), issues, f"{loc}: flow_node required")
        role = step.get("role") or "step"
        require(role in {"intro", "step", "outro"}, issues, f"{loc}: role must be intro, step, or outro")
        require(isinstance(step.get("narration_ste"), str) and step["narration_ste"].strip(), issues, f"{loc}: narration_ste required")
        require(isinstance(step.get("on_screen_action"), str) and step["on_screen_action"].strip(), issues, f"{loc}: on_screen_action required")
        require("trail_step" in step, issues, f"{loc}: trail_step required (use null if no trail yet)")
        require(isinstance(step.get("expected_ui"), dict), issues, f"{loc}: expected_ui required")
        ui = step.get("expected_ui") or {}
        require("route" in ui, issues, f"{loc}: expected_ui.route required")
        require("estimated_speech_seconds" in step, issues, f"{loc}: estimated_speech_seconds required")
        require("word_count" in step, issues, f"{loc}: word_count required")
        require("audio_render" in step and isinstance(step["audio_render"], dict), issues, f"{loc}: audio_render required")
        ar = step["audio_render"]
        require("tts_path" in ar and "human_path" in ar, issues, f"{loc}: audio_render.tts_path and human_path required")
        slots = step.get("video_slots") or []
        require(isinstance(slots, list) and len(slots) >= 1, issues, f"{loc}: at least one video_slots entry required")
        local_slots = []
        for j, slot in enumerate(slots, 1):
            sl = f"{loc}:slot[{j}]"
            if not isinstance(slot, dict):
                issues.append(f"{sl}: not a mapping")
                continue
            require(isinstance(slot.get("id"), str) and slot["id"], issues, f"{sl}: id required")
            if slot["id"] in slot_ids:
                issues.append(f"{sl}: duplicate slot id {slot['id']}")
            slot_ids.add(slot["id"])
            local_slots.append(slot["id"])
            require(slot.get("type") in SLOT_TYPES, issues, f"{sl}: type must be one of {sorted(SLOT_TYPES)}")
            require(isinstance(slot.get("source_app"), str) and slot["source_app"], issues, f"{sl}: source_app required")
            require(isinstance(slot.get("source_device"), str) and slot["source_device"], issues, f"{sl}: source_device required")
            require(isinstance(slot.get("duration_seconds"), (int, float)), issues, f"{sl}: duration_seconds required")
            require(isinstance(slot.get("path"), str) and slot["path"], issues, f"{sl}: path required")
            require(slot.get("status") in {"captured", "placeholder"}, issues, f"{sl}: status captured or placeholder")
            if slot["status"] == "placeholder":
                cl = slot.get("capture_checklist")
                require(isinstance(cl, list) and len(cl) >= 1, issues, f"{sl}: placeholder slots need a capture_checklist")
        transitions = step.get("transitions") or []
        require(isinstance(transitions, list), issues, f"{loc}: transitions must be a list")
        known = set(local_slots)
        for j, tr in enumerate(transitions, 1):
            tl = f"{loc}:transition[{j}]"
            if not isinstance(tr, dict):
                issues.append(f"{tl}: not a mapping")
                continue
            require(tr.get("type") in TRANSITIONS, issues, f"{tl}: type must be one of {sorted(TRANSITIONS)}")
            require(isinstance(tr.get("duration_seconds"), (int, float)), issues, f"{tl}: duration_seconds required")
            require(tr.get("from") in known, issues, f"{tl}: from must name a slot on this step")
            require(tr.get("to") in known, issues, f"{tl}: to must name a slot on this step")
        try:
            speech_sum += float(step.get("estimated_speech_seconds") or 0)
        except (TypeError, ValueError):
            issues.append(f"{loc}: estimated_speech_seconds must be a number")
    roles = [(step.get("role") or "step") for step in steps if isinstance(step, dict)]
    if roles.count("intro") != 1:
        issues.append(f"{path.name}: each guide must have exactly one intro step (got {roles.count('intro')})")
    if roles.count("outro") != 1:
        issues.append(f"{path.name}: each guide must have exactly one outro step (got {roles.count('outro')})")
    if roles and roles[0] != "intro":
        issues.append(f"{path.name}: the first step must have role intro")
    if roles and roles[-1] != "outro":
        issues.append(f"{path.name}: the last step must have role outro")
    flow_graph = data.get("flow_graph")
    if isinstance(flow_graph, str):
        mmd = (path.parent.parent.parent / flow_graph) if False else None
        # path is docs/guides/narration/<file>; repo root is parents[3]
        repo = path.resolve().parents[3]
        mmd_path = repo / flow_graph
        if mmd_path.is_file():
            mmd_text = mmd_path.read_text(encoding="utf-8")
            for i, step in enumerate(steps, 1):
                if not isinstance(step, dict):
                    continue
                node = step.get("flow_node")
                if isinstance(node, str) and node.strip() and node not in mmd_text:
                    issues.append(f"{path.name}:step[{i}]: flow_node {node!r} not found in {flow_graph}")
    declared = (data.get("timing") or {}).get("estimated_speech_seconds")

    if isinstance(declared, (int, float)) and abs(float(declared) - speech_sum) > 1.5:
        issues.append(
            f"{path.name}: timing.estimated_speech_seconds {declared} != sum of steps {speech_sum:.1f}"
        )
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate narration YAML")
    ap.add_argument("root", nargs="?", default="docs/guides/narration")
    args = ap.parse_args()
    root = Path(args.root)
    schema_path = root / "schema.json"
    if not schema_path.exists():
        print(f"missing schema: {schema_path}", file=sys.stderr)
        return 2
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    files = sorted(p for p in root.glob("*.yaml") if p.name != "ste-lexicon.yaml")
    if not files:
        print(f"no narration yaml under {root}", file=sys.stderr)
        return 2
    all_issues = []
    for path in files:
        try:
            all_issues.extend(validate(path, schema))
        except Exception as exc:  # noqa: BLE001
            all_issues.append(f"{path}: {exc}")
    if all_issues:
        print(f"narration-validate: {len(all_issues)} issue(s)")
        for item in all_issues:
            print(f"  - {item}")
        return 1
    print(f"narration-validate: ok ({len(files)} guides, schema {schema.get('x-sezs-schema-version', '1.1.0')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
