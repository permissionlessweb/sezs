#!/usr/bin/env node
/**
 * One FROST payroll seat as its own process. Talks only to the loopback bouncer.
 *
 * Usage:
 *   node src/frost/payroll-seat.mjs --seat desk --host http://127.0.0.1:3055 \
 *        --rendezvous /tmp/sezs-payroll-rendezvous --digest <64-hex> --coord
 *   node src/frost/payroll-seat.mjs --seat steward --host http://127.0.0.1:3055 \
 *        --rendezvous /tmp/sezs-payroll-rendezvous
 *
 * The coordinator (--coord, typically desk) creates the frostd session and
 * aggregates the signature. Every seat uses one X25519 identity for login
 * and Noise_K (XEdDSA), the same as Zafu. No spend keys, seeds, or .env
 * values are printed.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assertLocalRelay } from '../zafu/relay-guard.mjs'
import { createRelayClient, generateRelayIdentity } from './relay-client.mjs'
import { bindSeal, ensureSeal, openSealed, sealTo } from './seal.mjs'
import { frostCall } from './payroll-ceremony.mjs'

const SEAT_ORDER = ['desk', 'steward', 'spare']

const args = process.argv.slice(2)
const opt = { t: 2, n: 3 }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--seat') opt.seat = args[++i]
  else if (a === '--host') opt.host = args[++i]
  else if (a === '--rendezvous') opt.rendezvous = args[++i]
  else if (a === '--digest') opt.digest = args[++i]
  else if (a === '--coord') opt.coord = true
  else if (a === '--t') opt.t = Number(args[++i])
  else if (a === '--n') opt.n = Number(args[++i])
  else if (a === '--help') opt.help = true
}

const usage = 'Usage: node src/frost/payroll-seat.mjs --seat <desk|steward|spare> --host http://127.0.0.1:PORT --rendezvous DIR [--digest HEX --coord]\n'

const fail = (msg, code = 1) => {
  process.stderr.write(`${msg}\n`)
  if (opt.rendezvous) {
    try {
      mkdirSync(opt.rendezvous, { recursive: true, mode: 0o700 })
      writeFileSync(join(opt.rendezvous, 'error.txt'), String(msg) + '\n', { mode: 0o600 })
    } catch {}
  }
  process.exit(code)
}

if (opt.help) {
  process.stdout.write(usage)
  process.exit(0)
}
if (!opt.host || !opt.seat || !opt.rendezvous) {
  process.stdout.write(usage)
  process.exit(2)
}

assertLocalRelay(opt.host, 'payroll seat')

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

const writeJson = (p, data, mode = 0o600) => {
  writeFileSync(p, JSON.stringify(data) + '\n', { mode })
}

const waitFor = async (fn, tries = 1600, ms = 75) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn()
    if (v) return v
    await delay(ms)
  }
  throw new Error('timeout waiting for rendezvous')
}

const recvUntil = async (inbox, pred, tries = 1600) => {
  const got = []
  for (let i = 0; i < tries; i++) {
    while (inbox.length) got.push(inbox.shift())
    if (pred(got)) return got
    await delay(75)
  }
  throw new Error('timeout waiting for frost messages')
}

const tagOf = (got, tag) => got.filter((m) => m.body.tag === tag).map((m) => m.body)

const run = async () => {
  await ensureSeal()
  mkdirSync(opt.rendezvous, { recursive: true, mode: 0o700 })
  const identity = await generateRelayIdentity()
  const client = createRelayClient({ host: opt.host })
  await client.login(identity)
  writeJson(join(opt.rendezvous, `announce-${opt.seat}.json`), {
    seat: opt.seat,
    publicKey: identity.publicKey,
  })

  let session
  if (opt.coord) {
    if (!opt.digest || !/^[0-9a-f]{64}$/i.test(opt.digest)) {
      throw new Error('coordinator requires --digest <64-hex>')
    }
    const announces = await waitFor(() => {
      const rows = []
      for (const name of SEAT_ORDER.slice(0, opt.n)) {
        const row = readJson(join(opt.rendezvous, `announce-${name}.json`))
        if (!row?.publicKey) return null
        rows.push(row)
      }
      return rows
    })
    const order = announces.map((row, i) => ({ seat: row.seat, publicKey: row.publicKey, id: i + 1 }))
    const pubkeys = order.map((s) => s.publicKey)
    const sessionId = await client.createSession(pubkeys, 64)
    session = {
      sessionId,
      digestHex: opt.digest,
      t: opt.t,
      n: opt.n,
      order,
    }
    writeJson(join(opt.rendezvous, 'session.json'), session)
  } else {
    session = await waitFor(() => readJson(join(opt.rendezvous, 'session.json')))
  }

  const me = session.order.find((s) => s.seat === opt.seat)
  if (!me) throw new Error(`seat ${opt.seat} is not in the session`)
  const id = me.id
  const { t, n, sessionId, digestHex } = session
  const pubByRelay = Object.fromEntries(session.order.map((s) => [s.publicKey, s.publicKey]))
  const peers = session.order.filter((s) => s.seat !== opt.seat).map((s) => s.publicKey)
  const cipher = await bindSeal(identity, peers)
  writeJson(join(opt.rendezvous, `ready-${opt.seat}.json`), { seat: opt.seat, id })
  await waitFor(() => {
    for (const s of session.order) {
      if (!readJson(join(opt.rendezvous, `ready-${s.seat}.json`))) return null
    }
    return true
  })
  const inbox = []
  let pumpOn = true
  const pump = (async () => {
    while (pumpOn) {
      try {
        const msgs = await client.receive(sessionId)
        for (const m of msgs || []) {
          const senderPub = pubByRelay[m.sender] || m.sender
          const plain = openSealed(cipher, senderPub, m.msg)
          inbox.push({ sender: m.sender, body: JSON.parse(plain) })
        }
      } catch {
        // keep pumping; send/recv errors surface through recvUntil timeout
      }
      await delay(40)
    }
  })()

  const sendTo = async (destPub, tag, payload) => {
    const body = JSON.stringify({ tag, from: id, ...payload })
    const msg = sealTo(cipher, destPub, body)
    await client.send(sessionId, [destPub], msg)
  }
  const broadcast = async (tag, payload) => {
    for (const s of session.order) {
      if (s.publicKey === identity.publicKey) continue
      await sendTo(s.publicKey, tag, payload)
    }
  }

  const r1 = await frostCall({ op: 'part1', id, t, n })
  // Wait until every seat has finished the cold wasm part1 before exchanging
  // DKG packages, so a slow seat cannot starve a faster one mid-recvUntil.
  writeJson(join(opt.rendezvous, `warm-${opt.seat}.json`), { seat: opt.seat, id })
  await waitFor(() => {
    for (const s of session.order) {
      if (!readJson(join(opt.rendezvous, `warm-${s.seat}.json`))) return null
    }
    return true
  })
  await broadcast('dkg1', { id, package: r1.package })
  const got1 = await recvUntil(inbox, (g) => tagOf(g, 'dkg1').length === n - 1)
  const packages = {}
  for (const m of tagOf(got1, 'dkg1')) packages[m.id] = m.package
  const r2 = await frostCall({ op: 'part2', id, n, secret: r1.secret, packages })

  for (const dest of session.order) {
    if (dest.id === id) continue
    const pkg = r2.packages[String(dest.id)]
    if (!pkg) throw new Error(`missing r2 package for ${dest.id}`)
    await sendTo(dest.publicKey, 'dkg2', { id, from: id, to: dest.id, package: pkg })
  }
  const got2 = await recvUntil(inbox, (g) => tagOf(g, 'dkg2').length === n - 1)
  const r2in = {}
  for (const m of tagOf(got2, 'dkg2')) {
    if (m.to && m.to !== id) continue
    r2in[m.from] = m.package
  }
  const r3 = await frostCall({
    op: 'part3',
    id,
    secret: r2.secret,
    round1: packages,
    round2: r2in,
  })
  const keyPackage = r3.key_package
  const pubkeyPackage = r3.pubkey_package

  const isSigner = id <= t
  let commitments = {}
  let shares = {}
  if (isSigner) {
    const s1 = await frostCall({ op: 'sign1', key_package: keyPackage })
    commitments[id] = s1.commitments
    await broadcast('sign1', { id, commitments: s1.commitments })
    const gotS1 = await recvUntil(
      inbox,
      (g) => tagOf(g, 'sign1').filter((m) => m.id <= t).length === t - 1,
    )
    for (const m of tagOf(gotS1, 'sign1')) commitments[m.id] = m.commitments
    const cmap = {}
    for (const s of session.order) {
      if (s.id <= t) cmap[String(s.id)] = commitments[s.id]
    }
    const s2 = await frostCall({
      op: 'sign2',
      key_package: keyPackage,
      nonces: s1.nonces,
      commitments: cmap,
      message: digestHex,
    })
    shares[id] = s2.share
    await broadcast('sign2', { id, share: s2.share })
    if (opt.coord) {
      const gotS2 = await recvUntil(
        inbox,
        (g) => tagOf(g, 'sign2').length === t - 1,
      )
      for (const m of tagOf(gotS2, 'sign2')) shares[m.id] = m.share
      const shareMap = {}
      for (const s of session.order) {
        if (s.id <= t) shareMap[String(s.id)] = shares[s.id]
      }
      const agg = await frostCall({
        op: 'aggregate',
        pubkey_package: pubkeyPackage,
        commitments: cmap,
        shares: shareMap,
        message: digestHex,
      })
      writeJson(join(opt.rendezvous, 'result.json'), {
        sessionId,
        signature: agg.signature,
        verifyingKey: agg.verifying_key,
        t,
        n,
        cipher: 'zafu-frost-relay-cipher',
        seats: 'separate-processes',
      })
    }
  }
  writeJson(join(opt.rendezvous, `done-${opt.seat}.json`), { seat: opt.seat, id })
  if (opt.coord) {
    await waitFor(() => {
      for (const s of session.order) {
        if (!readJson(join(opt.rendezvous, `done-${s.seat}.json`))) return null
      }
      return true
    })
    try { await client.closeSession(sessionId) } catch {}
  }
  pumpOn = false
  try { await Promise.race([pump, delay(200)]) } catch {}
  try { cipher?.free() } catch {}
  process.stdout.write(`Seat ${opt.seat} finished.\n`)
}

run().catch((err) => fail(err.message || String(err)))
