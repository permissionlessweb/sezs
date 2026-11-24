/**
 * Sign a CosmWasm execute as a session keyring name (default: usher).
 * Never logs key material. Loopback only. Used by e2e when the live
 * session has SEZS_ALLOW_V3_RELAY_AUTH off.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const terpdOf = () => process.env.SEZS_V2_TERPD || `process.env.SEZS_V2_TERPD || process.env.TERPD || 'terpd'`
const homeOf = () =>
  process.env.SEZS_V2_KEYRING_HOME ||
  process.env.SEZS_LOCALTERP_HOME ||
  `${process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough'}/terp`
const nodeOf = () => process.env.SEZS_V2_NODE || 'tcp://127.0.0.1:26657'
const chainOf = () => process.env.SEZS_V2_CHAIN_ID || process.env.SEZS_CHAIN_ID || 'sezs-local-1'

const isLoopback = (node) => /^(tcp|http):\/\/(127\.0\.0\.1|localhost):\d+$/.test(String(node || ''))

export const signExecuteAs = ({ keyName = 'usher', contract, msg, fee = '5000uterp', gas = '400000' }) => {
  if (!isLoopback(nodeOf())) throw new Error('refusing a non-loopback node')
  if (!contract) throw new Error('no_contract')
  const dir = mkdtempSync(join(tmpdir(), 'sezs-sign-'))
  try {
    const unsigned = join(dir, 'unsigned.json')
    const signed = join(dir, 'signed.json')
    const gen = spawnSync(
      terpdOf(),
      [
        'tx', 'wasm', 'execute', contract, JSON.stringify(msg),
        '--from', keyName,
        '--keyring-backend', 'test',
        '--home', homeOf(),
        '--chain-id', chainOf(),
        '--node', nodeOf(),
        '--generate-only',
        '--gas', gas,
        '--fees', fee,
        '-o', 'json',
      ],
      { encoding: 'utf8' },
    )
    if (gen.status !== 0) throw new Error('generate_only_failed')
    writeFileSync(unsigned, gen.stdout, { mode: 0o600 })
    const sig = spawnSync(
      terpdOf(),
      [
        'tx', 'sign', unsigned,
        '--from', keyName,
        '--keyring-backend', 'test',
        '--home', homeOf(),
        '--chain-id', chainOf(),
        '--node', nodeOf(),
        '-o', 'json',
      ],
      { encoding: 'utf8' },
    )
    if (sig.status !== 0) throw new Error('sign_failed')
    writeFileSync(signed, sig.stdout, { mode: 0o600 })
    const enc = spawnSync(terpdOf(), ['tx', 'encode', signed], { encoding: 'utf8' })
    if (enc.status !== 0) throw new Error('encode_failed')
    return String(enc.stdout || '').trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
