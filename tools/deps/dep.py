#!/usr/bin/env python3
"""SEZS dependency switcher (slim terp-rs patch-git / patch-local control plane).

Version lines in member Cargo.toml stay on crates.io. This tool rewrites one
[patch.crates-io] table per workspace so a clean clone builds from published
git revs, and a developer with a crates checkout can opt into local paths.

Usage:
  python3 tools/deps/dep.py config
  python3 tools/deps/dep.py validate
  python3 tools/deps/dep.py branch-check
  python3 tools/deps/dep.py status
  python3 tools/deps/dep.py switch patch-git [--dry-run] [--workspace PATH]
  python3 tools/deps/dep.py switch patch-local [--dry-run] [--workspace PATH]

patch-local requires SEZS_CRATES_ROOT (a directory that contains the fork
checkouts named in the matrix `local` fields). Those paths are never written
as absolute values into Cargo.toml.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ABS_RE = re.compile(r"^(/|[A-Za-z]:\\)")
PATCH_BEGIN = "# BEGIN SEZS-DEPS-PATCH"
PATCH_END = "# END SEZS-DEPS-PATCH"
GIT_PATCH_BEGIN = "# BEGIN SEZS-DEPS-GIT-PATCH"
GIT_PATCH_END = "# END SEZS-DEPS-GIT-PATCH"



def repo_root() -> Path:
    here = Path(__file__).resolve()
    # tools/deps/dep.py -> repo root
    return here.parents[2]


def load_toml(path: Path) -> dict:
    with path.open("rb") as f:
        return tomllib.load(f)


def devops_dir() -> Path:
    return Path(__file__).resolve().parent / "_devops"


def load_config() -> dict:
    cfg_path = devops_dir() / "dep-config.toml"
    if not cfg_path.exists():
        raise SystemExit(f"missing config: {cfg_path}")
    return load_toml(cfg_path)


def matrix_path(cfg: dict) -> Path:
    rel = cfg.get("paths", {}).get("matrix", "dependency-matrix.toml")
    return devops_dir() / rel


def load_matrix(cfg: dict) -> dict:
    return load_toml(matrix_path(cfg))


def crates(matrix: dict) -> dict[str, dict]:
    """Flatten [crates.name] + [crates.name.git] into one record per crate."""
    raw = matrix.get("crates") or {}
    # tomllib nests [crates.foo.git] as raw['foo']['git'] already when using tables.
    out: dict[str, dict] = {}
    for name, body in raw.items():
        if not isinstance(body, dict):
            continue
        rec = dict(body)
        git = rec.get("git") or {}
        rec["name"] = name
        rec["git_url"] = git.get("url")
        rec["git_branch"] = git.get("branch")
        rec["git_rev"] = git.get("rev")
        out[name] = rec
    return out


def validate(cfg: dict, matrix: dict) -> list[str]:
    errors: list[str] = []
    policy = cfg.get("policy") or {}
    require_full = policy.get("require_full_rev", True)
    forbid_abs = policy.get("forbid_absolute_paths", True)
    recs = crates(matrix)
    if not recs:
        errors.append("matrix has no crates")
    for name, rec in recs.items():
        local = rec.get("local") or ""
        if not local:
            errors.append(f"{name}: missing local path")
        elif forbid_abs and (ABS_RE.match(str(local)) or str(local).startswith("~")):
            errors.append(f"{name}: local path must be relative, got {local!r}")
        url = rec.get("git_url")
        rev = rec.get("git_rev")
        if not url:
            errors.append(f"{name}: missing git.url")
        if not rev:
            errors.append(f"{name}: missing git.rev")
        elif require_full and not SHA_RE.match(str(rev)):
            errors.append(f"{name}: git.rev must be a full 40-char SHA, got {rev!r}")
    for ws in cfg.get("paths", {}).get("workspaces") or []:
        p = repo_root() / ws
        if not p.exists():
            errors.append(f"workspace missing: {ws}")
    return errors


def branch_check(matrix: dict, refresh: bool = False) -> list[str]:
    """git ls-remote: each (url, branch) must exist and, if rev set, contain it.

    We only check that the SHA is advertised as the branch tip or is fetchable
    via ls-remote <url> <rev>. A missing branch is an error; a branch whose
    tip differs from the pin is a warning (pins are SHA-based).
    """
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    recs = crates(matrix)
    for name, rec in recs.items():
        url, branch, rev = rec.get("git_url"), rec.get("git_branch"), rec.get("git_rev")
        if not url or not rev:
            continue
        key = (url, branch or "", rev)
        if key in seen:
            continue
        seen.add(key)
        # Confirm the SHA exists on the remote.
        proc = subprocess.run(
            ["git", "ls-remote", url, rev],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            # Some remotes do not advertise every SHA via ls-remote <sha>;
            # fall back to checking the branch tip.
            if branch:
                proc2 = subprocess.run(
                    ["git", "ls-remote", "--heads", url, branch],
                    capture_output=True,
                    text=True,
                )
                if proc2.returncode != 0 or not proc2.stdout.strip():
                    errors.append(f"{name}: unpublished branch {url} {branch}")
                    continue
                tip = proc2.stdout.split()[0]
                if tip != rev:
                    # Remotes often do not advertise ancestor SHAs. Pins are
                    # SHA-based; a newer branch tip is a warning, not a failure.
                    print(
                        f"warning: {name}: pin {rev} is not the advertised tip "
                        f"of {branch} ({tip})",
                        file=sys.stderr,
                    )
            else:
                errors.append(f"{name}: git ls-remote did not advertise {rev} at {url}")
        if branch:
            procb = subprocess.run(
                ["git", "ls-remote", "--heads", url, branch],
                capture_output=True,
                text=True,
            )
            if procb.returncode != 0 or not procb.stdout.strip():
                errors.append(f"{name}: branch {branch} not on {url}")
    return errors


def render_patch_git(recs: dict[str, dict]) -> str:
    lines = [
        "[patch.crates-io]",
        PATCH_BEGIN,
        "# Generated by tools/deps/dep.py switch patch-git. Do not hand-edit;",
        "# add pins to tools/deps/_devops/dependency-matrix.toml instead.",
    ]
    for name, rec in recs.items():
        if rec.get("git_only"):
            continue
        url, rev = rec.get("git_url"), rec.get("git_rev")
        if not url or not rev:
            continue
        pkg = rec.get("package")
        extra = f', package = "{pkg}"' if pkg else ""
        lines.append(f'{name} = {{ git = "{url}", rev = "{rev}"{extra} }}')
    lines.append(PATCH_END)
    lines.append("")
    return "\n".join(lines)


def render_patch_local(recs: dict[str, dict], crates_root_rel: str) -> str:
    """crates_root_rel is a relative path from the workspace Cargo.toml dir to SEZS_CRATES_ROOT."""
    if ABS_RE.match(crates_root_rel) or crates_root_rel.startswith("~"):
        raise SystemExit("refusing to write an absolute path into Cargo.toml")
    lines = [
        "[patch.crates-io]",
        PATCH_BEGIN,
        "# Generated by tools/deps/dep.py switch patch-local. Do not commit.",
    ]
    for name, rec in recs.items():
        if rec.get("git_only"):
            continue
        local = rec.get("local")
        if not local:
            continue
        rel = os.path.normpath(os.path.join(crates_root_rel, local))
        if rel.startswith("/"):
            raise SystemExit(f"absolute path produced for {name}: {rel}")
        pkg = rec.get("package")
        extra = f', package = "{pkg}"' if pkg else ""
        lines.append(f'{name} = {{ path = "{rel}"{extra} }}')
    lines.append(PATCH_END)
    lines.append("")
    return "\n".join(lines)


def replace_patch_section(text: str, new_block: str) -> str:
    """Replace an existing managed patch block, or a whole [patch.crates-io] table."""
    if PATCH_BEGIN in text and PATCH_END in text:
        pattern = re.compile(
            r"\[patch\.crates-io\]\n" + re.escape(PATCH_BEGIN) + r".*?" + re.escape(PATCH_END) + r"\n?",
            re.S,
        )
        if not pattern.search(text):
            # managed markers exist but not immediately after the table header
            pattern = re.compile(
                re.escape(PATCH_BEGIN) + r".*?" + re.escape(PATCH_END) + r"\n?",
                re.S,
            )
            return pattern.sub(new_block.rstrip() + "\n", text, count=1)
        return pattern.sub(new_block.rstrip() + "\n", text, count=1)
    # Replace from [patch.crates-io] to next top-level [section] that is not a patch subtable,
    # or end of file.
    m = re.search(r"^\[patch\.crates-io\]\s*$", text, re.M)
    if not m:
        if not text.endswith("\n"):
            text += "\n"
        return text + "\n" + new_block
    start = m.start()
    rest = text[m.end() :]
    nxt = re.search(r"^\[(?!patch\.)", rest, re.M)
    end = m.end() + (nxt.start() if nxt else len(rest))
    return text[:start] + new_block + text[end:]


def relative_to(from_dir: Path, to_dir: Path) -> str:
    return os.path.relpath(to_dir, start=from_dir)



def render_git_only_patch_git() -> str:
    """Clear path overrides for fork-only crates. Member Cargo.toml keeps the git dep."""
    return (
        f"{GIT_PATCH_BEGIN}\n"
        "# git-only crates use the git dep in member Cargo.toml.\n"
        "# Path overrides belong only in patch-local and must not be committed.\n"
        "# hash-market patch-git needs the sezs/service-trait SHA on origin.\n"
        f"{GIT_PATCH_END}\n"
    )


def render_git_only_patch_local(recs: dict[str, dict], crates_root_rel: str) -> str:
    """Write [patch."<git-url>"] path overrides for git_only crates. Do not commit."""
    if ABS_RE.match(crates_root_rel) or crates_root_rel.startswith("~"):
        raise SystemExit("refusing to write an absolute path into Cargo.toml")
    groups: dict[str, list] = {}
    for name, rec in recs.items():
        if not rec.get("git_only"):
            continue
        url, local = rec.get("git_url"), rec.get("local")
        if not url or not local:
            continue
        rel = os.path.normpath(os.path.join(crates_root_rel, local))
        if rel.startswith("/"):
            raise SystemExit(f"absolute path produced for {name}: {rel}")
        groups.setdefault(url, []).append((name, rel, rec.get("package")))
    lines = [
        GIT_PATCH_BEGIN,
        "# Generated by tools/deps/dep.py switch patch-local. Do not commit.",
        "# Fork-only crates are not on crates.io; this [patch] points the git dep at a local path.",
    ]
    for url, items in groups.items():
        lines.append(f'[patch."{url}"]')
        for name, rel, pkg in items:
            extra = f', package = "{pkg}"' if pkg else ""
            lines.append(f'{name} = {{ path = "{rel}"{extra} }}')
    if not groups:
        lines.append("# (no git-only crates in the matrix)")
    lines.append(GIT_PATCH_END)
    lines.append("")
    return "\n".join(lines)


def replace_git_only_section(text: str, new_block: str) -> str:
    if GIT_PATCH_BEGIN in text and GIT_PATCH_END in text:
        pattern = re.compile(
            re.escape(GIT_PATCH_BEGIN) + r".*?" + re.escape(GIT_PATCH_END) + r"\n?",
            re.S,
        )
        return pattern.sub(new_block.rstrip() + "\n", text, count=1)
    if not text.endswith("\n"):
        text += "\n"
    return text + "\n" + new_block


def switch(mode: str, cfg: dict, matrix: dict, workspace: str | None, dry_run: bool) -> int:
    recs = crates(matrix)
    workspaces = cfg.get("paths", {}).get("workspaces") or []
    if workspace:
        workspaces = [workspace]
    if mode == "patch-local":
        root_env = os.environ.get("SEZS_CRATES_ROOT")
        if not root_env:
            print(
                "patch-local requires SEZS_CRATES_ROOT (directory containing fork checkouts)",
                file=sys.stderr,
            )
            return 2
        crates_root = Path(root_env).expanduser().resolve()
        if not crates_root.is_dir():
            print(f"SEZS_CRATES_ROOT is not a directory: {crates_root}", file=sys.stderr)
            return 2
    changed = 0
    for ws in workspaces:
        path = repo_root() / ws
        if not path.exists():
            print(f"skip missing workspace {ws}", file=sys.stderr)
            continue
        original = path.read_text()
        git_only_only = os.environ.get("SEZS_DEPS_GIT_ONLY") == "1"
        if mode == "patch-git":
            git_block = render_git_only_patch_git()
            if git_only_only:
                updated = replace_git_only_section(original, git_block)
                block = ""
            else:
                block = render_patch_git(recs)
                updated = replace_patch_section(original, block)
                updated = replace_git_only_section(updated, git_block)
        else:
            rel = relative_to(path.parent, crates_root)
            git_block = render_git_only_patch_local(recs, rel)
            if git_only_only:
                updated = replace_git_only_section(original, git_block)
                block = ""
            else:
                block = render_patch_local(recs, rel)
                updated = replace_patch_section(original, block)
                updated = replace_git_only_section(updated, git_block)
        if updated == original:
            print(f"unchanged: {ws}")
            continue
        if dry_run:
            print(f"--- dry-run {ws} ---")
            if block:
                print(block)
            print(git_block)
        else:
            path.write_text(updated)
            print(f"wrote {mode} patch: {ws}")
        changed += 1
    return 0 if changed >= 0 else 1


def status(cfg: dict, matrix: dict) -> None:
    recs = crates(matrix)
    print(f"repo: {repo_root()}")
    print(f"crates in matrix: {len(recs)}")
    for name, rec in recs.items():
        kind = "git-only" if rec.get("git_only") else "crates.io"
        print(f"  {name:28s} {kind:10s} {rec.get('git_url')}@{rec.get('git_rev','')[:12]}")
    for ws in cfg.get("paths", {}).get("workspaces") or []:
        p = repo_root() / ws
        print(f"workspace {ws}: {'ok' if p.exists() else 'MISSING'}")
        if not p.exists():
            continue
        text = p.read_text()
        mode = "unmanaged"
        if PATCH_BEGIN in text:
            if "switch patch-local" in text or "Do not commit" in text:
                mode = "patch-local"
            elif "switch patch-git" in text or "dependency-matrix.toml" in text:
                mode = "patch-git"
            else:
                mode = "managed"
        elif "[patch.crates-io]" in text:
            mode = "hand-written [patch.crates-io]"
        print(f"  patch mode: {mode}")


def cmd_config(cfg: dict) -> None:
    print(f"repo_root = {repo_root()}")
    print(f"devops    = {devops_dir()}")
    print(f"matrix    = {matrix_path(cfg)}")
    print("workspaces:")
    for ws in cfg.get("paths", {}).get("workspaces") or []:
        print(f"  {ws}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("config")
    sub.add_parser("validate")
    bc = sub.add_parser("branch-check")
    bc.add_argument("--refresh", action="store_true")
    sub.add_parser("status")
    sw = sub.add_parser("switch")
    sw.add_argument("mode", choices=["patch-git", "patch-local"])
    sw.add_argument("--workspace", help="workspace Cargo.toml relative to repo root")
    sw.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    cfg = load_config()
    matrix = load_matrix(cfg)
    if args.cmd == "config":
        cmd_config(cfg)
        return 0
    if args.cmd == "validate":
        errs = validate(cfg, matrix)
        if errs:
            print("validate failed:")
            for e in errs:
                print(f"  {e}")
            return 1
        print("validate: ok")
        return 0
    if args.cmd == "branch-check":
        errs = branch_check(matrix, refresh=args.refresh)
        if errs:
            print("branch-check failed:")
            for e in errs:
                print(f"  {e}")
            return 1
        print("branch-check: ok")
        return 0
    if args.cmd == "status":
        status(cfg, matrix)
        return 0
    if args.cmd == "switch":
        errs = validate(cfg, matrix)
        if errs:
            print("validate failed; refusing to switch:")
            for e in errs:
                print(f"  {e}")
            return 1
        return switch(args.mode, cfg, matrix, args.workspace, args.dry_run)
    return 2


if __name__ == "__main__":
    sys.exit(main())
