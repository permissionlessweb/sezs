#!/usr/bin/env node
/**
 * terp-rs-shaped TypeScript clients from CosmWasm schema JSON.
 *
 * Layout (same as crates/terp-rs/api/ts/<contract>/):
 *   api/ts/<contract>/{types,client,message-composer}/
 *   api/ts/<contract>/index.ts          re-exports
 *   api/ts/index.ts                     bundle
 *
 * Uses @cosmwasm/ts-codegen (the same package terp-rs historically
 * used before gen-tools grew a custom writer). Output is rearranged
 * into the gen-tools folder layout.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'contracts/cw-ave/ts/package.json'))

let codegen
try {
  codegen = require('@cosmwasm/ts-codegen').default || require('@cosmwasm/ts-codegen')
} catch (e) {
  console.error('Install @cosmwasm/ts-codegen in contracts/cw-ave/ts (yarn) first.')
  throw e
}

const kebab = (s) => s.replace(/_/g, '-')
const contracts = [
  { name: 'CwEventManifold', schema: 'cw-event-manifold' },
  { name: 'Cw420', schema: 'cw420' },
  { name: 'CwAve', schema: 'cw-ave' },
  { name: 'CwAveFactory', schema: 'cw-ave-factory' },
].filter((c) => existsSync(join(ROOT, 'api/schema', `${c.schema}.json`)) || existsSync(join(ROOT, 'contracts/cw-ave/contracts', c.schema, 'schema')))

if (!contracts.length) {
  console.error('No schema JSON found. Run `make schema` first.')
  process.exit(1)
}

const tmp = mkdtempSync(join(tmpdir(), 'sezs-codegen-'))
const entries = contracts.map((c) => {
  const dir = join(ROOT, 'contracts/cw-ave/contracts', c.schema, 'schema')
  const apiSchema = join(ROOT, 'api/schema', `${c.schema}.json`)
  const use = existsSync(dir) ? dir : dirname(apiSchema)
  return { name: c.name, dir: use, schema: c.schema }
})

await codegen({
  contracts: entries.map(({ name, dir }) => ({ name, dir })),
  outPath: tmp,
  options: {
    bundle: { bundleFile: 'index.ts', scope: 'contracts' },
    types: { enabled: true },
    client: { enabled: true },
    reactQuery: { enabled: false },
    recoil: { enabled: false },
    messageComposer: { enabled: true },
  },
})

const outRoot = join(ROOT, 'api/ts')
mkdirSync(outRoot, { recursive: true })

const folderOf = (file) => {
  if (file.endsWith('.types.ts')) return 'types'
  if (file.endsWith('.client.ts')) return 'client'
  if (file.endsWith('.message-composer.ts') || file.endsWith('.messageComposer.ts')) return 'message-composer'
  return null
}

const written = []
for (const c of entries) {
  const dest = join(outRoot, c.schema)
  mkdirSync(join(dest, 'types'), { recursive: true })
  mkdirSync(join(dest, 'client'), { recursive: true })
  mkdirSync(join(dest, 'message-composer'), { recursive: true })
  const files = readdirSync(tmp).filter((f) => f.startsWith(c.name + '.') && f.endsWith('.ts'))
  for (const f of files) {
    const kind = folderOf(f)
    if (!kind) continue
    const src = join(tmp, f)
    const body = readFileSync(src, 'utf8')
    // Fix relative imports when files move into subfolders.
    const fixed = body
      .replaceAll(`from "./${c.name}.types"`, `from "../types/${c.name}.types"`)
      .replaceAll(`from "./${c.name}.client"`, `from "../client/${c.name}.client"`)
      .replaceAll(`from "./${c.name}.message-composer"`, `from "../message-composer/${c.name}.message-composer"`)
    writeFileSync(join(dest, kind, f), fixed)
    written.push(`${c.schema}/${kind}/${f}`)
  }
  const types = files.filter((f) => f.endsWith('.types.ts'))[0]
  const client = files.filter((f) => f.endsWith('.client.ts'))[0]
  const composer = files.filter((f) => f.includes('message-composer') || f.includes('messageComposer'))[0]
  const index = [
    types ? `export * from './types/${types.replace(/\.ts$/, '')}.js'` : '',
    client ? `export * from './client/${client.replace(/\.ts$/, '')}.js'` : '',
    composer ? `export * from './message-composer/${composer.replace(/\.ts$/, '')}.js'` : '',
  ].filter(Boolean).join('\n') + '\n'
  writeFileSync(join(dest, 'index.ts'), index)
  written.push(`${c.schema}/index.ts`)
}

const bundle = entries.map((c) => `export * as ${c.name} from './${c.schema}/index.js'`).join('\n') + '\n'
writeFileSync(join(outRoot, 'index.ts'), bundle)
written.push('index.ts')
console.log('codegen wrote', written.length, 'files under api/ts/')
for (const f of written) console.log(' ', f)
