/**
 * Sign ADR-36 as a session keyring coordinator. Never logs key material.
 * Tries `coord`, then `curator`. Loopback keyring only.
 */
import { spawnSync } from 'node:child_process'

import { signAdr036 } from '../src/ble/lab-sign.mjs'

const terpdOf = () => process.env.SEZS_V2_TERPD || `process.env.SEZS_V2_TERPD || process.env.TERPD || 'terpd'`
const homeOf = () =>
  process.env.SEZS_V2_KEYRING_HOME ||
  process.env.SEZS_LOCALTERP_HOME ||
  `${process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough'}/terp`

const addrOf = (name) => {
  const r = spawnSync(terpdOf(), ['keys', 'show', name, '-a', '--keyring-backend', 'test', '--home', homeOf()], { encoding: 'utf8' })
  if (r.status !== 0) return ''
  return String(r.stdout || '').trim()
}

const secretOf = (name) => {
  const r = spawnSync(
    terpdOf(),
    ['keys', 'export', name, '--unarmored-hex', '--unsafe', '--yes', '--keyring-backend', 'test', '--home', homeOf()],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) return null
  const cleaned = String(r.stdout || '').replace(/[^0-9a-f]/gi, '')
  if (cleaned.length < 64) return null
  const hex = cleaned.length === 64 ? cleaned : cleaned.slice(-64)
  return Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)))
}

export const sessionCoordinator = () => {
  for (const name of ['coord', 'curator']) {
    const address = addrOf(name)
    const secret = secretOf(name)
    if (address && secret) {
      return {
        name,
        address,
        sign: (bytes) => signAdr036(address, bytes, secret),
      }
    }
  }
  throw new Error('session coordinator key is not available')
}
