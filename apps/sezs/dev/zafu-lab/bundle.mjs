/**
 * Bundle @zafu/zirc/room and zid relay-http from the local Zafu checkout
 * into this directory so Node tests can import them. Regenerated on demand.
 * Do not commit the .js / .mjs output.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const labDir = dirname(fileURLToPath(import.meta.url))
export const zafuRoot = () =>
  process.env.SEZS_ZAFU_ROOT || process.env.SEZS_ZAFU_ROOT

const findEsbuild = (root) => {
  const env = process.env.SEZS_ESBUILD
  if (env && existsSync(env)) return env
  const pnpm = join(root, 'node_modules/.pnpm')
  if (!existsSync(pnpm)) return null
  const walk = (dir, depth) => {
    if (depth > 6) return null
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return null
    }
    for (const n of names) {
      const p = join(dir, n)
      if (n === 'esbuild' && existsSync(join(p, 'bin/esbuild'))) return join(p, 'bin/esbuild')
    }
    for (const n of names) {
      if (!n.startsWith('esbuild@')) continue
      const hit = walk(join(dir, n, 'node_modules'), depth + 1)
      if (hit) return hit
    }
    return null
  }
  return walk(pnpm, 0)
}

export const bundlePaths = () => ({
  room: join(labDir, 'room.mjs'),
  relayHttp: join(labDir, 'relay-http.mjs'),
})

export const ensureZafuLabBundle = () => {
  const root = zafuRoot()
  const out = bundlePaths()
  if (existsSync(out.room) && existsSync(out.relayHttp) && process.env.SEZS_REBUILD_ZAFU_LAB !== '1') {
    return out
  }
  const esbuild = findEsbuild(root)
  if (!esbuild) throw new Error('zafu-lab: esbuild not found under ' + root)
  mkdirSync(labDir, { recursive: true })
  const aliases = [
    `--alias:@zafu/zid=${join(root, 'packages/zid/src/index.ts')}`,
    `--alias:@zafu/pq=${join(root, 'packages/pq/src/index.ts')}`,
    `--alias:@zafu/protocol=${join(root, 'packages/zafu-protocol/src/index.ts')}`,
    `--alias:@zafu/service=${join(root, 'packages/service/src/index.ts')}`,
    `--alias:@zafu/interactions=${join(root, 'packages/interactions/src/index.ts')}`,
  ]
  const run = (entry, outfile) => {
    const r = spawnSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', `--outfile=${outfile}`, ...aliases], {
      cwd: join(root, 'packages/zirc'),
      encoding: 'utf8',
    })
    if (r.status !== 0) {
      throw new Error(`zafu-lab bundle failed for ${entry}: ${r.stderr || r.stdout || r.status}`)
    }
  }
  run(join(root, 'packages/zirc/src/room/index.ts'), out.room)
  run(join(root, 'packages/zid/src/relay-http.ts'), out.relayHttp)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = ensureZafuLabBundle()
  console.log('zafu-lab bundle', out)
}
