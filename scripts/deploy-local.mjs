#!/usr/bin/env node
// Deprecated entrypoint. Local deploy is `scripts/deploy.sh` /
// `make deploy-local`, which runs sezs-orch-deploy against the
// terp-core cw-orch fork. Circuit compile and upload happen inside
// SezsSuite::deploy_on (`upload_circuit` / MsgStoreCircuit). There is
// no terpd store-full-circuit path.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const r = spawnSync('bash', [join(root, 'scripts/deploy.sh')], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status === null ? 1 : r.status)
