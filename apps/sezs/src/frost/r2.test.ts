import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { test } from 'node:test'

import { adminSurface, mutationAllowed, roleFromCred } from './adminGuard.ts'
import { verifyRekeyTx } from './rekeyVerify.ts'
import { isCommitteeRotateTx, labChainAllowed, rotateExecuteBody, submitRotateToLab } from './rotateLab.ts'
import {
  ackUsher,
  doorCheckIn,
  emptyUsherBook,
  proposeUsher,
  usherCanAdmin,
} from './usherBook.ts'

const holders = ['desk', 'steward', 'spare']

test('usher add then remove revokes door check-in immediately', () => {
  let book = emptyUsherBook()
  const p = proposeUsher(book, holders, 'desk', 'ada', 'add')
  assert.equal(p.ok, true)
  if (!p.ok) return
  assert.equal(doorCheckIn('usher', 'ada', p.book), false)
  const a = ackUsher(p.book, holders, 'desk', 'u:desk:1', 2)
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = ackUsher(a.book, holders, 'steward', 'u:steward:1', 2)
  assert.equal(b.ok, true)
  if (!b.ok) return
  book = b.book
  assert.equal(doorCheckIn('usher', 'ada', book), true)
  assert.equal(doorCheckIn('admin', 'ada', book), false)
  assert.equal(doorCheckIn('guest', 'ada', book), false)
  assert.equal(usherCanAdmin(), false)
  const rm = proposeUsher(book, holders, 'desk', 'ada', 'remove')
  assert.equal(rm.ok, true)
  if (!rm.ok) return
  assert.equal(doorCheckIn('usher', 'ada', rm.book), true)
  const r1 = ackUsher(rm.book, holders, 'desk', 'u:desk:rm', 2)
  assert.equal(r1.ok, true)
  if (!r1.ok) return
  const r2 = ackUsher(r1.book, holders, 'steward', 'u:steward:rm', 2)
  assert.equal(r2.ok, true)
  if (!r2.ok) return
  assert.equal(doorCheckIn('usher', 'ada', r2.book), false)
})

test('replayed usher agreement is refused', () => {
  let book = emptyUsherBook()
  const p = proposeUsher(book, holders, 'desk', 'ada', 'add')
  assert.equal(p.ok, true)
  if (!p.ok) return
  const a = ackUsher(p.book, holders, 'desk', 'replay-blob', 2)
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = ackUsher(a.book, holders, 'steward', 'fresh', 2)
  assert.equal(b.ok, true)
  if (!b.ok) return
  book = b.book
  const p2 = proposeUsher(book, holders, 'desk', 'ada', 'remove')
  assert.equal(p2.ok, true)
  if (!p2.ok) return
  const again = ackUsher(p2.book, holders, 'desk', 'replay-blob', 2)
  assert.equal(again.ok, false)
  if (again.ok) return
  assert.equal(again.error, 'share_replay_epoch')
})

test('claimed admin role without a known cred stays guest', () => {
  assert.equal(roleFromCred('admin', 'cred-guest', ['cred-admin'], ['cred-usher']), 'guest')
  assert.equal(roleFromCred('guest', 'cred-admin', ['cred-admin'], []), 'admin')
  assert.equal(adminSurface('guest'), false)
  assert.equal(adminSurface(undefined), false)
  assert.equal(adminSurface('admin'), true)
})

test('cross-site mutation is refused', () => {
  assert.equal(mutationAllowed('https://evil.example', '1'), false)
  assert.equal(mutationAllowed('http://127.0.0.1:3051', null), false)
  assert.equal(mutationAllowed('http://127.0.0.1:3051', '1'), true)
  assert.equal(mutationAllowed(null, '1'), true)
})

test('mainnet chain id is refused and rotate body has no authenticator', () => {
  assert.equal(labChainAllowed('morocco-1'), false)
  assert.equal(labChainAllowed('artmint-local-1'), true)
  const msg = rotateExecuteBody({ newVkCommit: 'abc', nextSeats: ['desk'], nextT: 2, nextN: 1 })
  assert.equal('authenticator_type' in (msg.rotate_frost_pubkey as object), false)
})

test('submit refuses a local chain that has no frost contract', async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    calls.push(String(url))
    if (String(url).includes('node_info')) {
      return {
        ok: true,
        json: async () => ({ default_node_info: { network: 'artmint-local-1' } }),
      }
    }
    return { ok: false, json: async () => ({}) }
  }) as unknown as typeof fetch
  const r = await submitRotateToLab(
    { lcd: 'http://127.0.0.1:1417', contract: 'terp1notfrost', newVkCommit: 'abc' },
    fetchImpl
  )
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error, 'lab_contract_missing')
  assert.equal(calls.some((u) => u.includes('/smart/execute')), false)
})

test('fake rekey id is rejected by the local node', async () => {
  const fake = 'ab'.repeat(32)
  const r = await verifyRekeyTx(fake)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error, 'fixture_txid')
})

test('only this contract rotate from the old committee counts', () => {
  const contract = 'terp1frostlab'
  const sender = 'terp1oldcommittee'
  const good = {
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmwasm.wasm.v1.MsgExecuteContract',
            sender,
            contract,
            msg: { rotate_frost_pubkey: { new_vk_commit: 'abc' } },
          },
        ],
      },
    },
  }
  const otherConfirmed = {
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmwasm.wasm.v1.MsgStoreCode',
            sender,
          },
        ],
      },
    },
  }
  const otherContract = {
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmwasm.wasm.v1.MsgExecuteContract',
            sender,
            contract: 'terp1someoneelse',
            msg: { rotate_frost_pubkey: { new_vk_commit: 'abc' } },
          },
        ],
      },
    },
  }
  assert.equal(isCommitteeRotateTx(good, contract, sender), true)
  assert.equal(isCommitteeRotateTx(otherConfirmed, contract, sender), false)
  assert.equal(isCommitteeRotateTx(otherContract, contract, sender), false)
})

test('live lab rotate tx matches this contract and a share tx does not', async () => {
  const path = new URL('../../public/frost-lab.json', import.meta.url)
  if (!existsSync(path)) return
  const lab = JSON.parse(readFileSync(path, 'utf8')) as {
    lcd: string
    contract: string
    rotate_tx: string
    other_tx: string
    sender: string
  }
  const load = async (hash: string) => {
    const res = await fetch(`${lab.lcd}/cosmos/tx/v1beta1/txs/${hash}`)
    return res.json()
  }
  assert.equal(isCommitteeRotateTx(await load(lab.rotate_tx), lab.contract, lab.sender), true)
  assert.equal(isCommitteeRotateTx(await load(lab.other_tx), lab.contract, lab.sender), false)
})

test('Cash App QR is only imported by admin and door', () => {
  const pages = readdirSync(new URL('../../pages/', import.meta.url))
  const hits = pages.filter((name) => {
    if (!name.endsWith('.tsx')) return false
    const text = readFileSync(new URL(`../../pages/${name}`, import.meta.url), 'utf8')
    return text.includes('DoorCashAppQr')
  })
  hits.sort()
  assert.deepEqual(hits, ['admin.tsx', 'door.tsx'])
})
