#!/usr/bin/env python3
"""Generate the SEZS recording studio (manifest.json + self-contained index.html).

Reads narration YAML (schema 1.1.0), surface SVGs, shots, audio, Trailblaze
trails, and docs/guides/studio/progress.json. No network, no heavy deps.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML is required. Install with: python3 -m pip install --user pyyaml", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
NARRATION = ROOT / "docs/guides/narration"
STUDIO = ROOT / "docs/guides/studio"
TEMPLATE = ROOT / "scripts/studio-template.html"
MEDIA_CACHE = STUDIO / "media"
AUDIO = NARRATION / "audio"

BROWSER_AUDIO = (".wav", ".webm", ".m4a", ".mp3", ".ogg")
ALL_AUDIO = BROWSER_AUDIO + (".aiff", ".aif")

# Existing trail stubs in this repo, mapped to narration guide ids.
# These files are currently marked status: unrecorded.
GUIDE_TRAILS = {
    "install": ["trails/install.trail.yaml"],
    "registration-and-purchase": ["trails/sezs-speakeasy/ticket-purchase/trail.yaml"],
    "payout-wallet": ["trails/sezs-speakeasy/artist-pay-after-ticket/trail.yaml"],
    "usher-check-in": ["trails/sezs-speakeasy/usher-checkin/trail.yaml"],
    "admin-multisig-payments": ["trails/sezs-speakeasy/admin-frost/trail.yaml"],
}

GUIDE_ORDER = [
    "install",
    "onramp-zec",
    "registration-and-purchase",
    "ticket-transfer",
    "payout-wallet",
    "usher-check-in",
    "usher-zirc-chat",
    "admin-multisig-payments",
]


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def href_from_studio(repo_rel: str) -> str:
    # Absolute from the repo root, which make studio-serve uses as the doc root.
    return "/" + str(repo_rel).lstrip("/")


def load_progress() -> dict:
    path = STUDIO / "progress.json"
    blank = {"version": 1, "exported_at": None, "checks": {}, "notes": {}, "last": {"guide": None, "step": None}}
    if not path.is_file():
        return blank
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"warning: could not parse {path}: {exc}", file=sys.stderr)
        return blank
    data.setdefault("version", 1)
    data.setdefault("checks", {})
    data.setdefault("notes", {})
    data.setdefault("last", {"guide": None, "step": None})
    return data


def read_trail(path: Path) -> dict:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    status = raw.get("status") or "unknown"
    title = raw.get("title") or path.parent.name
    platform = raw.get("platform") or raw.get("driver")
    steps = raw.get("steps") or []
    return {
        "path": rel(path),
        "href": href_from_studio(rel(path)),
        "title": title,
        "status": status,
        "platform": platform,
        "step_count": len(steps) if isinstance(steps, list) else 0,
        "recorded": status not in {"unrecorded", "unknown", None, ""},
        "run_command": f"trailblaze run {rel(path.parent)}",
        "run_command_file": f"trailblaze run {rel(path)}",
    }


def convert_aiff_for_browser(src: Path, dest: Path) -> Path | None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    afconvert = shutil.which("afconvert")
    ffmpeg = shutil.which("ffmpeg")
    try:
        if afconvert:
            subprocess.run(
                [afconvert, "-f", "WAVE", "-d", "LEI16", str(src), str(dest)],
                check=True,
                capture_output=True,
            )
            return dest
        if ffmpeg:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(src), "-acodec", "pcm_s16le", str(dest)],
                check=True,
                capture_output=True,
            )
            return dest
    except subprocess.CalledProcessError as exc:
        print(f"warning: could not convert {src}: {exc}", file=sys.stderr)
    return None


def audio_entry(path: Path | None, kind: str, guide_id: str, step_id: str) -> dict | None:
    if path is None or not path.is_file():
        return None
    href = href_from_studio(rel(path))
    playable = path.suffix.lower() in BROWSER_AUDIO
    converted = None
    if not playable and path.suffix.lower() in {".aiff", ".aif"}:
        dest = MEDIA_CACHE / guide_id / kind / f"{step_id}.wav"
        got = convert_aiff_for_browser(path, dest)
        if got:
            href = href_from_studio(rel(got))
            playable = True
            converted = rel(got)
    return {
        "path": rel(path),
        "href": href,
        "filename": path.name,
        "bytes": path.stat().st_size,
        "playable": playable,
        "converted": converted,
        "format": path.suffix.lower().lstrip("."),
    }


def collect_audio(guide_id: str, step: dict, kind: str) -> dict | None:
    ar = step.get("audio_render") or {}
    key = "tts_path" if kind == "tts" else "human_path"
    declared = ar.get(key)
    candidates: list[Path] = []
    if declared:
        candidates.append(ROOT / declared)
    folder = AUDIO / guide_id / kind
    if folder.is_dir():
        for ext in ALL_AUDIO:
            candidates.append(folder / f"{step['id']}{ext}")
    preferred, rest = [], []
    seen = set()
    for c in candidates:
        (preferred if c.suffix.lower() in BROWSER_AUDIO else rest).append(c)
    found = None
    for c in preferred + rest:
        rp = str(c)
        if rp in seen:
            continue
        seen.add(rp)
        if c.is_file():
            found = c
            break
    return audio_entry(found, kind, guide_id, step["id"])


def slot_payload(slot: dict) -> dict:
    path_s = slot.get("path") or ""
    fp = ROOT / path_s if path_s else None
    exists = bool(fp and fp.is_file() and fp.stat().st_size > 0)
    ext = fp.suffix.lower() if fp else ""
    thumb = exists and ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
    return {
        "id": slot.get("id"),
        "type": slot.get("type"),
        "source_app": slot.get("source_app"),
        "source_device": slot.get("source_device"),
        "duration_seconds": slot.get("duration_seconds"),
        "path": path_s,
        "href": href_from_studio(path_s) if path_s else None,
        "status": slot.get("status") or "placeholder",
        "exists": exists,
        "bytes": fp.stat().st_size if exists else 0,
        "thumbnail": thumb,
        "capture_checklist": slot.get("capture_checklist") or [],
    }


def step_payload(guide_id: str, step: dict) -> dict:
    tts = collect_audio(guide_id, step, "tts")
    human = collect_audio(guide_id, step, "human")
    slots = [slot_payload(s) for s in (step.get("video_slots") or [])]
    captured = sum(1 for s in slots if s["status"] == "captured" and s["exists"])
    placeholders = sum(1 for s in slots if s["status"] != "captured")
    trail_step = step.get("trail_step")
    trail_file = None
    trail_exists = False
    if isinstance(trail_step, str) and trail_step:
        trail_file = trail_step.split("#", 1)[0]
        trail_exists = (ROOT / trail_file).is_file()
    return {
        "id": step.get("id"),
        "status": step.get("status") or "complete",
        "gap": step.get("gap"),
        "narration_ste": step.get("narration_ste") or "",
        "on_screen_action": step.get("on_screen_action") or "",
        "trail_step": trail_step,
        "trail_file": trail_file,
        "trail_file_exists": trail_exists,
        "expected_ui": step.get("expected_ui") or {},
        "video_slots": slots,
        "transitions": step.get("transitions") or [],
        "estimated_speech_seconds": step.get("estimated_speech_seconds"),
        "word_count": step.get("word_count"),
        "role": step.get("role") or "step",
        "flow_node": step.get("flow_node") or "",
        "producer_note": step.get("producer_note") or "",
        "audio": {"tts": tts, "human": human},
        "counts": {
            "slots": len(slots),
            "captured": captured,
            "placeholder": placeholders,
            "tts": bool(tts),
            "human": bool(human),
        },
    }


def guide_status(steps: list[dict], trails: list[dict]) -> str:
    if not steps:
        return "draft"
    slot_list = [s for st in steps for s in st["video_slots"]]
    webby = [s for s in slot_list if s["type"] in {"still-screenshot", "web-capture"}]
    web_ok = bool(webby) and all(s["status"] == "captured" and s["exists"] for s in webby)
    human_ok = all(st["audio"]["human"] for st in steps)
    trail_ok = bool(trails) and all(t.get("recorded") for t in trails)
    if human_ok and web_ok and trail_ok:
        return "rendered"
    if human_ok:
        return "voiced"
    if web_ok:
        return "captured"
    return "draft"


def load_guides() -> list[dict]:
    by_id = {}
    for path in sorted(NARRATION.glob("*.yaml")):
        if path.name == "ste-lexicon.yaml":
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        gid = data.get("id") or path.stem
        steps = [step_payload(gid, s) for s in (data.get("steps") or [])]
        surface = f"docs/flows/surfaces/{gid}.svg"
        surface_mmd = f"docs/flows/surfaces/{gid}.mmd"
        surface_path = ROOT / surface
        trails = []
        for tpath in GUIDE_TRAILS.get(gid, []):
            p = ROOT / tpath
            if p.is_file():
                trails.append(read_trail(p))
        yaml_status = data.get("status") or "draft"
        rec_status = guide_status(steps, trails)
        slot_n = sum(st["counts"]["slots"] for st in steps)
        cap_n = sum(st["counts"]["captured"] for st in steps)
        ph_n = sum(st["counts"]["placeholder"] for st in steps)
        tts_n = sum(1 for st in steps if st["counts"]["tts"])
        hum_n = sum(1 for st in steps if st["counts"]["human"])
        by_id[gid] = {
            "id": gid,
            "title": data.get("title") or gid,
            "yaml_status": yaml_status,
            "status": rec_status,
            "audience": data.get("audience") or "",
            "producer_note": data.get("producer_note") or "",
            "prerequisites": data.get("prerequisites") or [],
            "user_constraints": data.get("user_constraints") or [],
            "flow_graph": data.get("flow_graph"),
            "surface_svg": surface if surface_path.is_file() else None,
            "surface_svg_href": href_from_studio(surface) if surface_path.is_file() else None,
            "surface_mmd": surface_mmd if (ROOT / surface_mmd).is_file() else None,
            "event": data.get("event") or {},
            "timing": data.get("timing") or {},
            "audio": data.get("audio") or {},
            "source": rel(path),
            "source_href": href_from_studio(rel(path)),
            "trails": trails,
            "steps": steps,
            "counts": {
                "steps": len(steps),
                "slots": slot_n,
                "captured": cap_n,
                "placeholder": ph_n,
                "tts": tts_n,
                "human": hum_n,
            },
        }
    ordered = []
    for gid in GUIDE_ORDER:
        if gid in by_id:
            ordered.append(by_id.pop(gid))
    ordered.extend(by_id.values())
    return ordered


def collect_flows() -> dict:
    def listing(folder: Path, prefix: str) -> list[dict]:
        rows = []
        if not folder.is_dir():
            return rows
        for svg in sorted(folder.glob("*.svg")):
            mmd = svg.with_suffix(".mmd")
            rows.append({
                "id": svg.stem,
                "kind": prefix,
                "svg": str(svg.relative_to(ROOT)),
                "svg_href": href_from_studio(str(svg.relative_to(ROOT))),
                "mmd": str(mmd.relative_to(ROOT)) if mmd.is_file() else None,
            })
        return rows
    return {
        "surfaces": listing(ROOT / "docs/flows/surfaces", "surface"),
        "derived": listing(ROOT / "docs/flows/derived", "derived"),
    }


def build_manifest() -> dict:
    guides = load_guides()
    return {
        "schema_version": "1.1.0",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event": (guides[0]["event"] if guides else {}),
        "flows": collect_flows(),
        "trailblaze": {
            "cli": "trailblaze run <trail.yaml-or-dir>",
            "docs": "https://block.github.io/trailblaze/",
            "notes": [
                "Set JAVA_HOME to Homebrew OpenJDK 21 before invoking the CLI.",
                "Replay: trailblaze run trails/sezs-speakeasy/usher-checkin",
                "Also accepted: trailblaze run trails/sezs-speakeasy/usher-checkin/trail.yaml",
                "Optional device pin: trailblaze run --device web <path>",
                "After a live session: trailblaze session save -t \"Title\"",
                "Existing trail files in trails/sezs-speakeasy/ are marked unrecorded until a session is saved.",
            ],
        },
        "progress": load_progress(),
        "guides": guides,
        "counts": {
            "guides": len(guides),
            "steps": sum(g["counts"]["steps"] for g in guides),
            "slots_captured": sum(g["counts"]["captured"] for g in guides),
            "slots_placeholder": sum(g["counts"]["placeholder"] for g in guides),
            "human_takes": sum(g["counts"]["human"] for g in guides),
            "tts_takes": sum(g["counts"]["tts"] for g in guides),
        },
    }


def write_html(manifest: dict) -> None:
    if not TEMPLATE.is_file():
        raise SystemExit(f"missing template: {TEMPLATE}")
    raw = TEMPLATE.read_text(encoding="utf-8")
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    payload = payload.replace("<", "\\u003c")
    if "__MANIFEST_JSON__" not in raw:
        raise SystemExit("template is missing __MANIFEST_JSON__ marker")
    html = raw.replace("__MANIFEST_JSON__", payload)
    out = STUDIO / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {rel(out)} ({out.stat().st_size} bytes)")


def main() -> int:
    STUDIO.mkdir(parents=True, exist_ok=True)
    (STUDIO / "inbox").mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    man_path = STUDIO / "manifest.json"
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {rel(man_path)} ({man_path.stat().st_size} bytes)")
    write_html(manifest)
    print(
        f"guides={manifest['counts']['guides']} "
        f"steps={manifest['counts']['steps']} "
        f"captured={manifest['counts']['slots_captured']} "
        f"placeholder={manifest['counts']['slots_placeholder']} "
        f"human={manifest['counts']['human_takes']} "
        f"tts={manifest['counts']['tts_takes']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
