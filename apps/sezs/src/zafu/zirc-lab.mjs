/**
 * Lab helpers to load @zafu/zirc and @zafu/zid from the local Zafu checkout
 * and talk to the loopback minirelay only.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertLocalRelay, DEFAULT_LAB_RELAY } from './relay-guard.mjs'

export const zafuRoot = () =>
  process.env.SEZS_ZAFU_ROOT || process.env.SEZS_ZAFU_ROOT

export const labRelayUrl = () => {
  const url = process.env.SEZS_ZIRC_RELAY || DEFAULT_LAB_RELAY
  assertLocalRelay(url, 'zirc lab')
  return url.replace(/\/$/, '')
}

export async function loadZafuPackages() {
  const root = zafuRoot()
  const { ensureZafuLabBundle } = await import('../../dev/zafu-lab/bundle.mjs')
  const paths = ensureZafuLabBundle()
  const room = await import(pathToFileURL(paths.room).href)
  const relayHttp = await import(pathToFileURL(paths.relayHttp).href)
  return { root, room, relayHttp }
}

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function ed25519RoomIdentity(name = 'sezs-event') {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    name,
    pubkey: toHex(rawPub),
    sign: async (msg) => {
      const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, msg))
      return toHex(sig)
    },
    verify: async (msg, sig, pubkey) => {
      const raw = Uint8Array.from(String(pubkey).match(/.{2}/g).map((x) => parseInt(x, 16)))
      const sigb = Uint8Array.from(String(sig).match(/.{2}/g).map((x) => parseInt(x, 16)))
      const pub = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, true, ['verify'])
      return crypto.subtle.verify('Ed25519', pub, sigb, msg)
    },
  }
}

export async function openLabRoom({
  roomSecret,
  appScope = 'sezs-usher-v1',
  channel = '#ushers',
  identity,
  endpoint,
} = {}) {
  const url = endpoint || labRelayUrl()
  assertLocalRelay(url, 'openLabRoom')
  const { room, relayHttp } = await loadZafuPackages()
  if (!relayHttp?.createHttpRelayTransport) {
    throw new Error(`zafu relay transport failed to load (${relayHttp?.error || 'no export'})`)
  }
  const ident = identity || (await ed25519RoomIdentity())
  const secret = roomSecret || room.createRoomSecret()
  const relay = relayHttp.createHttpRelayTransport({
    endpoint: url,
    // zirc records are larger than discovery blobs
    maxEntryBase64: 16_384,
    maxEntries: 16_384,
    maxBodyBytes: 8 * 1024 * 1024,
  })
  const inst = new room.Room(ident, { roomSecret: secret, appScope, channel, relay, public: false })
  return { Room: room, secret, identity: ident, inst, invite: room.encodeInvite({ appScope, channel, secret, endpoint: url }) }
}
