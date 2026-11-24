#!/usr/bin/env python3
"""Bind splash lab identities to the session coord/usher keyring addresses. Never prints them."""
import json, subprocess, os
from pathlib import Path

root = Path(os.environ["SEZS_SESSION_ROOT"])
home = root / "terp"
terpd = os.environ.get("SEZS_V2_TERPD") or os.environ.get("TERPD", "terpd")

def addr(name):
    r = subprocess.run(
        [terpd, "keys", "show", name, "-a", "--keyring-backend", "test", "--home", str(home)],
        capture_output=True, text=True,
    )
    a = (r.stdout or "").strip()
    if not a.startswith("terp1") or len(a) < 20:
        raise SystemExit(f"could not read {name} address (not printed)")
    return a

coord = addr("coord")
usher = addr("usher")
print("got coord and usher addresses (not printed) coord_len", len(coord), "usher_len", len(usher))

state_path = root / "splash" / "state.json"
if not state_path.exists():
    # search
    cands = list(root.rglob("state.json"))
    cands = [p for p in cands if "key-secrets" not in p.parts and "keyring" not in p.parts]
    if not cands:
        raise SystemExit("splash state.json missing")
    state_path = cands[0]

obj = json.loads(state_path.read_text())
ids = obj.get("identities") or (obj.get("v2") or {})
# identities are at top level
if "identities" not in obj:
    obj["identities"] = []

def upsert(id_, role, address):
    cur = next((i for i in obj["identities"] if i.get("id") == id_), None)
    if cur is None:
        obj["identities"].append({"id": id_, "kind": "keplr", "role": role, "address": address})
        print("added identity", id_, "role", role, "addr_len", len(address))
    else:
        cur["address"] = address
        cur["role"] = role
        print("updated identity", id_, "role", role, "addr_len", len(address))

upsert("admin-1", "admin", coord)
upsert("coord-1", "coordinator", coord)
upsert("usher-1", "usher", usher)
state_path.write_text(json.dumps(obj, indent=2) + "\n")
print("wrote", state_path.name, "identities", len(obj["identities"]))
