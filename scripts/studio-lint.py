#!/usr/bin/env python3
"""Lightweight checks for the generated SEZS studio page."""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT / "docs/guides/studio"
HTML = STUDIO / "index.html"
MANIFEST = STUDIO / "manifest.json"
TEMPLATE = ROOT / "scripts/studio-template.html"

CDN = re.compile(
    r"""https?://(?:cdn\.|unpkg\.|jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic|ajax\.googleapis)""",
    re.I,
)
SECRETISH = re.compile(
    r"""(?ix)
    (?:api[_-]?key|secret|private[_-]?key|password|mnemonic|seed[_-]?phrase)
    .{0,20}
    (?:['\"][A-Za-z0-9/+=_\-]{12,}['\"])
    """
)
BANNED_COPY = re.compile(r"lab payments|lab terp1|mock receipt|mock-receipt", re.I)

EXPECTED_GUIDES = [
    "install",
    "onramp-zec",
    "registration-and-purchase",
    "ticket-transfer",
    "payout-wallet",
    "usher-check-in",
    "usher-zirc-chat",
    "admin-multisig-payments",
]


def fail(msg: str) -> None:
    print(f"studio-lint: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not HTML.is_file() or not MANIFEST.is_file():
        fail("run make studio first (missing index.html or manifest.json)")
    html = HTML.read_text(encoding="utf-8")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    template = TEMPLATE.read_text(encoding="utf-8")

    if "__MANIFEST_JSON__" in html:
        fail("index.html still contains the template marker")
    if "__MANIFEST_JSON__" not in template:
        fail("studio-template.html is missing __MANIFEST_JSON__")
    if "<script src=" in html.lower() or "<link rel=\"stylesheet\" href=\"http" in html.lower():
        fail("external script or stylesheet tag found")
    if CDN.search(html) or CDN.search(template):
        fail("CDN or webfont URL found")
    if SECRETISH.search(html):
        fail("possible secret-looking literal in index.html")
    if BANNED_COPY.search(html):
        fail("studio copy mentions a lab-payment shortcut")

    guides = manifest.get("guides") or []
    ids = [g.get("id") for g in guides]
    if ids != EXPECTED_GUIDES:
        fail(f"expected 8 guides in order, got {ids}")
    if manifest.get("schema_version") != "1.1.0":
        fail("manifest.schema_version should be 1.1.0")

    usher = next(g for g in guides if g["id"] == "usher-check-in")
    if not usher.get("steps"):
        fail("usher-check-in has no steps")
    if "MediaRecorder" not in html or "localStorage" not in html:
        fail("page is missing MediaRecorder or localStorage wiring")
    for needle in ("trailblaze run", "teleprompter", "keydown"):
        if needle not in html.lower() and needle not in html:
            # teleprompter label is "Teleprompter" / class tele
            if needle == "teleprompter" and ("Teleprompter" in html or 'class="tele"' in html):
                continue
            fail(f"missing expected feature text: {needle}")

    # Bind reminder: serve script must stay on loopback.
    serve = (ROOT / "scripts/studio-serve.sh").read_text(encoding="utf-8")
    if "--bind 127.0.0.1" not in serve and '--bind "127.0.0.1"' not in serve:
        fail("studio-serve.sh must bind 127.0.0.1")


    # Syntax-check the inlined page script when node is available.
    node = shutil.which("node")
    if node:
        import tempfile, subprocess
        start = html.find("<script>")
        end = html.rfind("</script>")
        if start < 0 or end < 0:
            fail("index.html is missing its script block")
        js = html[start + len("<script>"):end]
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(js)
            tmp = fh.name
        try:
            proc = subprocess.run([node, "--check", tmp], capture_output=True, text=True)
        finally:
            Path(tmp).unlink(missing_ok=True)
        if proc.returncode != 0:
            fail("index.html script failed node --check:\n" + (proc.stderr or proc.stdout or ""))

    if "nav-flows" not in html or "renderFlows" not in html:
        fail("studio is missing the Flows view")
    usher_step = (usher.get("steps") or [None])[0]
    if usher_step and "flow_node" not in usher_step:
        fail("usher steps are missing flow_node")
    if "highlightFlowNode" not in html:
        fail("Record mode is missing SVG node highlighting")
    flows = manifest.get("flows") or {}
    if not flows.get("surfaces"):
        fail("manifest.flows.surfaces is empty")

    print("studio-lint: ok")

    print(f"  guides: {len(guides)}")
    print(f"  steps:  {manifest.get('counts', {}).get('steps')}")
    print(f"  html:   {HTML.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
