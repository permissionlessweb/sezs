#!/usr/bin/env python3
"""Draft offline TTS for narration guides using macOS say. No network."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
GUIDES = sys.argv[1:] or ["usher-check-in", "registration-and-purchase"]


def pick_voice() -> str:
    try:
        out = subprocess.check_output(["say", "-v", "?"], text=True)
    except (OSError, subprocess.CalledProcessError):
        return ""
    if any(line.startswith("Samantha ") for line in out.splitlines()):
        return "Samantha"
    if any(line.startswith("Albert ") for line in out.splitlines()):
        return "Albert"
    return ""


def duration(path: Path) -> str:
    try:
        info = subprocess.check_output(["afinfo", str(path)], text=True)
    except (OSError, subprocess.CalledProcessError):
        return ""
    for line in info.splitlines():
        low = line.lower()
        if "estimated duration" in low or low.strip().startswith("duration"):
            return line.strip()
    return ""


def render(gid: str, voice: str) -> float:
    guide = ROOT / "docs/guides/narration" / f"{gid}.yaml"
    dest_dir = ROOT / "docs/guides/narration/audio" / gid / "tts"
    dest_dir.mkdir(parents=True, exist_ok=True)
    data = yaml.safe_load(guide.read_text())
    step_ids: list[str] = []
    total = 0.0
    for step in data["steps"]:
        sid = step["id"]
        step_ids.append(sid)
        dest = dest_dir / f"{sid}.aiff"
        text = " ".join((step.get("narration_ste") or "").split())
        cmd = ["say", "-o", str(dest)]
        if voice:
            cmd.extend(["-v", voice])
        cmd.append(text)
        subprocess.check_call(cmd)
        dur = duration(dest)
        print(f"wrote {dest.relative_to(ROOT)}  {dur}")
        # parse seconds if present
        for tok in dur.replace(",", " ").split():
            try:
                total += float(tok)
                break
            except ValueError:
                continue
    for p in dest_dir.glob("*.aiff"):
        if p.stem.endswith("-all"):
            continue
        if p.stem not in step_ids:
            p.unlink()
            print("removed stale", p.name)
    print(f"{gid}: {len(step_ids)} steps, ~{total:.1f}s")
    return total


def main() -> None:
    if not shutil_which("say"):
        print("say is not available; skip TTS")
        return
    voice = pick_voice()
    print("voice", voice or "default")
    for gid in GUIDES:
        render(gid, voice)


def shutil_which(name: str) -> str | None:
    import shutil
    return shutil.which(name)


if __name__ == "__main__":
    main()
