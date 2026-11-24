#!/usr/bin/env python3
import sys
import re
from pathlib import Path

path, chain_id, rpc, grpc, terp_id, terp_rpc, terp_grpc, pcli_cfg, view = sys.argv[1:]
text = Path(pcli_cfg).read_text()
spend = None
for raw in text.splitlines():
    s = raw.strip()
    if s.startswith("spend_key ") or s.startswith("spend_key="):
        if "spend_key_share" in s:
            continue
        m = re.split(r"=", s, 1)
        if len(m) != 2:
            continue
        spend = m[1].strip().strip('"').strip("'")
        break
if not spend:
    sys.stderr.write("no soft-kms spend_key in relayer pcli config\n")
    sys.exit(1)
cfg = "\n".join([
    "[global]",
    "log_level = 'info'",
    "",
    "[mode.clients]",
    "enabled = true",
    "refresh = true",
    "misbehaviour = true",
    "",
    "[mode.connections]",
    "enabled = true",
    "",
    "[mode.channels]",
    "enabled = true",
    "",
    "[mode.packets]",
    "enabled = true",
    "clear_interval = 10",
    "clear_on_start = true",
    "tx_confirmation = true",
    "",
    "[rest]",
    "enabled = false",
    "host = '127.0.0.1'",
    "port = 3000",
    "",
    "[telemetry]",
    "enabled = false",
    "host = '127.0.0.1'",
    "port = 3001",
    "",
    "[[chains]]",
    "id = '%s'" % chain_id,
    "type = 'Penumbra'",
    "rpc_addr = 'http://127.0.0.1:%s'" % rpc,
    "grpc_addr = 'http://127.0.0.1:%s'" % grpc,
    "rpc_timeout = '15s'",
    "event_source = { mode = 'pull', interval = '1s' }",
    "clock_drift = '15s'",
    "max_block_time = '15s'",
    "compat_mode = '0.37'",
    "view_service_storage_dir = '%s'" % view,
    "kms_config = { spend_key = '%s' }" % spend,
    "",
    "[[chains]]",
    "id = '%s'" % terp_id,
    "type = 'CosmosSdk'",
    "rpc_addr = 'http://127.0.0.1:%s'" % terp_rpc,
    "grpc_addr = 'http://127.0.0.1:%s'" % terp_grpc,
    "rpc_timeout = '15s'",
    "account_prefix = 'terp'",
    "key_name = 'rly-terp'",
    "store_prefix = 'ibc'",
    "event_source = { mode = 'push', url = 'ws://127.0.0.1:%s/websocket', batch_delay = '500ms' }" % terp_rpc,
    "gas_price = { price = 0.0, denom = 'uterp' }",
    "gas_multiplier = 1.4",
    "max_gas = 2000000",
    "clock_drift = '15s'",
    "max_block_time = '15s'",
    "trusting_period = '2minutes'",
    "compat_mode = '0.37'",
    "",
])
low = cfg.lower()
for bad in ("rotko", "relay.zafu.pro", "penumbra.zone", "morocco-1", "hs-preview", "47080", "47657", "0.0.0.0"):
    if bad in low:
        sys.stderr.write("refusing config content\n")
        sys.exit(2)
Path(path).write_text(cfg)
