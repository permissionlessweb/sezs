/**
 * Lab-only terpd helpers. Key NAMES only; never prints key material.
 * Loopback node required.
 */
import { spawnSync } from 'node:child_process'
import { cliSigner } from './root-publisher.mjs'

const env = process.env
const isLoopback = (node) => /^(tcp|http):\/\/(127\.0\.0\.1|localhost):\d+$/.test(String(node || ''))

export const chainEnv = () => ({
  terpd: env.SEZS_V2_TERPD || `terpd`,
  home: env.SEZS_V2_KEYRING_HOME,
  node: env.SEZS_V2_NODE || 'tcp://127.0.0.1:26657',
  chainId: env.SEZS_V2_CHAIN_ID || 'sezs-local-1',
  lcd: env.SEZS_V2_LCD || 'http://127.0.0.1:1317',
  contract: env.SEZS_V2_ROOT_CONTRACT || '',
  serviceKey: env.SEZS_V2_KEY_NAME || 'service',
  usherKey: env.SEZS_V2_USHER_KEY || 'usher',
})

/** Address for a lab keyring NAME. Never dumps the key. */
export const addrOf = (name) => {
  const e = chainEnv()
  if (!e.home || !name) return ''
  if (!isLoopback(e.node)) throw new Error('refusing a non-loopback node')
  const r = spawnSync(e.terpd, ['keys', 'show', name, '-a', '--keyring-backend', 'test', '--home', e.home], {
    encoding: 'utf8',
  })
  if (r.status !== 0) return ''
  return String(r.stdout || '').trim()
}

export const executeAs = async (keyName, contract, msg) => {
  const e = chainEnv()
  if (!isLoopback(e.node)) throw new Error('refusing a non-loopback node')
  if (!contract) return { ok: false, error: 'no_contract' }
  const signer = cliSigner({
    terpd: e.terpd,
    home: e.home,
    keyName,
    node: e.node,
    chainId: e.chainId,
  })
  return signer.execute(contract, msg)
}
