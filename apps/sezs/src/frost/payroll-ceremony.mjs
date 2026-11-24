/**
 * Run a 2-of-3 FROST DKG + signing ceremony over the local bouncer.
 * Signing crypto is frost-ed25519 via sezs-frost-payroll.
 * Transport is frostd-lite through the bouncer.
 * Payloads are sealed with Zafu FrostRelayCipher (Noise_K).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelayClient, generateRelayIdentity } from './relay-client.mjs'
import { bindSeal, ensureSeal, openSealed, sealTo } from './seal.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const defaultBins = [
  join(here, '../../../../crates/target/release/sezs-frost-payroll'),
  join(here, '../../dev/frost-payroll/target/release/sezs-frost-payroll'),
]
const defaultBin = defaultBins.find((p) => existsSync(p)) || defaultBins[0]

export const frostPayrollBin = () =>
  process.env.SEZS_FROST_PAYROLL_BIN || defaultBin

export const frostCall = (req, bin = frostPayrollBin()) =>
  new Promise((resolve, reject) => {
    if (!existsSync(bin)) {
      reject(new Error(`sezs-frost-payroll missing at ${bin}`))
      return
    }
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`frost helper exited ${code}`))
        return
      }
      try {
        const json = JSON.parse(out)
        if (!json.ok) reject(new Error(json.error || 'frost_failed'))
        else resolve(json)
      } catch (e) {
        reject(new Error('frost helper bad json'))
      }
    })
    child.stdin.end(JSON.stringify(req))
  })


const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const recvUntil = async (client, sessionId, cipher, pubByRelay, pred, tries = 40) => {
  const got = []
  for (let i = 0; i < tries; i++) {
    const msgs = await client.receive(sessionId)
    for (const m of msgs) {
      const senderPub = pubByRelay[m.sender] || m.sender
      const plain = openSealed(cipher, senderPub, m.msg)
      got.push({ sender: m.sender, body: JSON.parse(plain) })
    }
    if (pred(got)) return got
    await sleep(50)
  }
  throw new Error('timeout waiting for frost messages')
}

const tagOf = (got, tag) => got.filter((m) => m.body.tag === tag).map((m) => m.body)

/**
 * @param {{ host: string, digestHex: string, t?: number, n?: number }} opts
 */
export const runPayrollCeremony = async ({ host, digestHex, t = 2, n = 3 }) => {
  if (!/^[0-9a-f]{64}$/i.test(digestHex)) throw new Error('bad_digest')
  await ensureSeal()
  const seats = []
  for (let i = 0; i < n; i++) {
    const identity = await generateRelayIdentity()
    seats.push({
      id: i + 1,
      relay: identity,
      seal: identity,
      client: null,
      cipher: null,
    })
  }
  for (const s of seats) {
    s.client = createRelayClient({ host })
    await s.client.login(s.relay)
  }
  const pubkeys = seats.map((s) => s.relay.publicKey)
  const sessionId = await seats[0].client.createSession(pubkeys, 64)
  const pubByRelay = Object.fromEntries(seats.map((s) => [s.relay.publicKey, s.seal.publicKey]))
  for (const s of seats) {
    const peers = seats.filter((x) => x.id !== s.id).map((x) => x.seal.publicKey)
    s.cipher = await bindSeal(s.seal, peers)
  }

  const broadcast = async (from, tag, payload) => {
    const body = JSON.stringify({ tag, from: from.id, ...payload })
    for (const s of seats) {
      if (s.id === from.id) continue
      const msg = sealTo(from.cipher, s.seal.publicKey, body)
      await from.client.send(sessionId, [s.relay.publicKey], msg)
    }
  }

  // DKG round 1
  const r1 = {}
  for (const s of seats) {
    const out = await frostCall({ op: 'part1', id: s.id, t, n })
    s.r1secret = out.secret
    r1[s.id] = out.package
    await broadcast(s, 'dkg1', { id: s.id, package: out.package })
  }
  for (const s of seats) {
    const got = await recvUntil(s.client, sessionId, s.cipher, pubByRelay, (g) => tagOf(g, 'dkg1').length === n - 1)
    const packages = {}
    for (const m of tagOf(got, 'dkg1')) packages[m.id] = m.package
    const out = await frostCall({ op: 'part2', id: s.id, n, secret: s.r1secret, packages })
    s.r2secret = out.secret
    s.r2packages = out.packages
    s.r1packages = packages
  }

  for (const s of seats) {
    for (const dest of seats) {
      if (dest.id === s.id) continue
      const pkg = s.r2packages[String(dest.id)]
      if (!pkg) throw new Error(`missing r2 package for ${dest.id} from ${s.id}`)
      const body = JSON.stringify({ tag: 'dkg2', from: s.id, to: dest.id, package: pkg })
      const msg = sealTo(s.cipher, dest.seal.publicKey, body)
      await s.client.send(sessionId, [dest.relay.publicKey], msg)
    }
  }

  let pubkeyPackage = null
  for (const s of seats) {
    const got = await recvUntil(s.client, sessionId, s.cipher, pubByRelay, (g) => tagOf(g, 'dkg2').length === n - 1)
    const r2 = {}
    for (const m of tagOf(got, 'dkg2')) {
      if (m.to && m.to !== s.id) continue
      r2[m.from] = m.package
    }
    const out = await frostCall({
      op: 'part3',
      id: s.id,
      secret: s.r2secret,
      round1: s.r1packages,
      round2: r2,
    })
    s.keyPackage = out.key_package
    pubkeyPackage = out.pubkey_package
  }

  const signers = seats.slice(0, t)
  const commitments = {}
  for (const s of signers) {
    const out = await frostCall({ op: 'sign1', key_package: s.keyPackage })
    s.nonces = out.nonces
    commitments[s.id] = out.commitments
    await broadcast(s, 'sign1', { id: s.id, commitments: out.commitments })
  }
  for (const s of signers) {
    const got = await recvUntil(
      s.client,
      sessionId,
      s.cipher,
      pubByRelay,
      (g) => tagOf(g, 'sign1').filter((m) => signers.some((x) => x.id === m.id)).length === t - 1,
    )
    for (const m of tagOf(got, 'sign1')) commitments[m.id] = m.commitments
  }

  const shares = {}
  const cmap = {}
  for (const s of signers) cmap[String(s.id)] = commitments[s.id]
  for (const s of signers) {
    const out = await frostCall({
      op: 'sign2',
      key_package: s.keyPackage,
      nonces: s.nonces,
      commitments: cmap,
      message: digestHex,
    })
    shares[s.id] = out.share
    await broadcast(s, 'sign2', { id: s.id, share: out.share })
  }
  for (const s of signers.slice(0, 1)) {
    const got = await recvUntil(
      s.client,
      sessionId,
      s.cipher,
      pubByRelay,
      (g) => tagOf(g, 'sign2').length === t - 1,
    )
    for (const m of tagOf(got, 'sign2')) shares[m.id] = m.share
  }
  const shareMap = {}
  for (const s of signers) shareMap[String(s.id)] = shares[s.id]
  const agg = await frostCall({
    op: 'aggregate',
    pubkey_package: pubkeyPackage,
    commitments: cmap,
    shares: shareMap,
    message: digestHex,
  })
  try { await seats[0].client.closeSession(sessionId) } catch {}
  for (const s of seats) {
    try { s.cipher?.free() } catch {}
  }
  return {
    sessionId,
    signature: agg.signature,
    verifyingKey: agg.verifying_key,
    t,
    n,
    cipher: 'zafu-frost-relay-cipher',
  }
}
