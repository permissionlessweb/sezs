#!/usr/bin/env bash
# Render Mermaid sources under docs/flows and docs/specs/diagrams to SVG
# with the SEZS product theme. Loopback/local only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:${PATH}"
THEME="${ROOT}/docs/specs/diagrams/mermaid-theme.json"
NODE_CAP="${MMDC_NODE_CAP:-80}"

if ! command -v mmdc >/dev/null 2>&1; then
  echo "mmdc is not on PATH. Install with: npm install -g @mermaid-js/mermaid-cli" >&2
  exit 1
fi
if [[ ! -f "${THEME}" ]]; then
  echo "missing mermaid theme: ${THEME}" >&2
  exit 1
fi

find_chrome() {
  local p
  for p in \
    ${HOME}/.cache/puppeteer/chrome/*/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing \
    ${HOME}/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-mac-arm64/chrome-headless-shell \
    ${HOME}/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell \
    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
  do
    if [[ -x "${p}" ]]; then
      printf '%s\n' "${p}"
      return 0
    fi
  done
  return 1
}

TMPDIR_RENDER="$(mktemp -d /tmp/sezs-diagrams-XXXXXX)"
trap 'rm -rf "${TMPDIR_RENDER}"' EXIT
PUPPETEER="${TMPDIR_RENDER}/puppeteer.json"
if CHROME_BIN="$(find_chrome)"; then
  python3 -c 'import json,sys; json.dump({"executablePath":sys.argv[1],"args":["--no-sandbox","--disable-gpu"]}, sys.stdout)' "${CHROME_BIN}" > "${PUPPETEER}"
  echo "mmdc chrome: ${CHROME_BIN}"
else
  echo "warning: no local Chrome found; mmdc will use its default" >&2
  PUPPETEER=""
fi

prepare_mmd() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" "$NODE_CAP" << 'PY'
import re, sys
src, dest, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
raw = open(src, encoding="utf-8").read()

def flatten_labels(text: str) -> str:
    def repl(m):
        inner = m.group(1)
        inner = re.sub(r"\s+", " ", inner).strip()
        inner = inner.replace('"', "#quot;")
        inner = inner.replace("<", " ").replace(">", " ")
        if len(inner) > 160:
            inner = inner[:157] + "..."
        return '["' + inner + '"]'
    return re.sub(r'\["(.*?)"\]', repl, text, flags=re.S)

text = flatten_labels(raw)
ids = re.findall(r"(?m)^    ([A-Za-z_][A-Za-z0-9_]*)\[", text)
if len(ids) <= cap:
    open(dest, "w", encoding="utf-8").write(text)
    print(f"  nodes={len(ids)}")
    sys.exit(0)

lines = text.splitlines(keepends=True)
proxy_ids = set()
for line in lines:
    m = re.match(r"    (proxy_unresolved_[A-Za-z0-9_]+)\[", line)
    if m:
        proxy_ids.add(m.group(1))
out = []
dropped = 0
for line in lines:
    skip = False
    if re.match(r"    proxy_unresolved_[A-Za-z0-9_]+\[", line):
        skip = True
    else:
        for pid in proxy_ids:
            if pid in line and ("-->" in line or "-.->" in line or "..->" in line):
                skip = True
                break
    if skip:
        dropped += 1
        continue
    out.append(line)
new = "".join(out)
ids2 = re.findall(r"(?m)^    ([A-Za-z_][A-Za-z0-9_]*)\[", new)
if len(ids2) > cap:
    header = []
    defs = []
    rest_header_done = False
    for line in out:
        if re.match(r"    ([A-Za-z_][A-Za-z0-9_]*)\[", line):
            rest_header_done = True
            if len(defs) < cap:
                defs.append(line)
        elif not rest_header_done:
            header.append(line)
    note = f'    trailmark_truncated["Graph truncated for SVG: {len(ids)} nodes in source, showing {len(defs)}"]\n'
    new = "".join(header) + note + "".join(defs) + "\n"
    print(f"  nodes={len(ids)} truncated_to={len(defs)} (proxy_dropped={dropped})")
else:
    print(f"  nodes={len(ids)} after_dropping_proxies={len(ids2)} dropped_lines={dropped}")
open(dest, "w", encoding="utf-8").write(new)
PY
}

args=(--configFile "${THEME}" --backgroundColor "#07070a" --quiet)
if [[ -n "${PUPPETEER}" ]]; then
  args+=(--puppeteerConfigFile "${PUPPETEER}")
fi

count=0
fail=0
while IFS= read -r -d '' mmd; do
  svg="${mmd%.mmd}.svg"
  prepared="${TMPDIR_RENDER}/$(echo "${mmd}" | shasum | awk '{print $1}').mmd"
  echo "render ${mmd#${ROOT}/} -> ${svg#${ROOT}/}"
  prepare_mmd "${mmd}" "${prepared}"
  if mmdc -i "${prepared}" -o "${svg}" "${args[@]}"; then
    count=$((count + 1))
  else
    echo "RENDER FAILED ${mmd}" >&2
    fail=$((fail + 1))
  fi
done < <(find "${ROOT}/docs/flows" "${ROOT}/docs/specs/diagrams" -type f -name '*.mmd' -print0 | sort -z)

echo "Rendered ${count} SVG(s); ${fail} failed."
if [[ "${fail}" -ne 0 ]]; then
  exit 1
fi
