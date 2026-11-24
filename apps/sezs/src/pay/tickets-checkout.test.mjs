import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../..')
const read = (p) => readFileSync(join(app, p), 'utf8')

const tickets = read('pages/tickets.tsx')
const panel = read('src/event/CheckoutPanel.tsx')
const index = read('src/pay/index.ts')
const cashapp = read('src/pay/cashapp.ts')
const zec = read('src/pay/zec.ts')
const eth = read('src/pay/eth.ts')
const base = read('src/pay/base.ts')
const pen = read('src/pay/penumbra.ts')
const net = read('src/pay/network.ts')
const dregg = read('src/dregg/zec.ts')
const poll = read('src/pay/dreggPoll.ts')
const serverPaid = read('src/pay/serverPaid.ts')
const session = read('src/auth/session.ts')
const auth = read('src/auth/AuthContext.tsx')
const door = read('src/event/DoorCashAppQr.tsx')
const admin = read('pages/admin.tsx')

test('tickets catalog order is ZEC then ETH then Base then Penumbra', () => {
  assert.match(
    index,
    /export const ADAPTERS: RailAdapter\[] = \[zec, eth, base, penumbra]/
  )
  assert.doesNotMatch(index, /cashapp/)
  assert.doesNotMatch(index, /from '\.\/notLive'/)
})

test('/tickets source does not name Cash App', () => {
  for (const [name, src] of [
    ['tickets.tsx', tickets],
    ['CheckoutPanel.tsx', panel],
  ]) {
    assert.doesNotMatch(src, /Cash App/i, name)
    assert.doesNotMatch(src, /cashapp/i, name)
    assert.doesNotMatch(src, /\$SEZS_LAB/)
  }
})

test('Cash App QR stays on door + admin', () => {
  assert.match(door, /door-cashapp-qr/)
  assert.match(admin, /DoorCashAppQr/)
  assert.match(cashapp, /Door only/)
  assert.match(cashapp, /kind: 'not_live'/)
})

test('commitPaid is gone from the browser checkout', () => {
  assert.doesNotMatch(panel, /commitPaid/)
  assert.doesNotMatch(auth, /commitPaid/)
  assert.match(auth, /refreshPaid/)
  assert.doesNotMatch(panel, /commitPaid/)
  assert.doesNotMatch(zec, /pollDreggWatch/)
  assert.doesNotMatch(eth, /pollDreggWatch/)
  assert.doesNotMatch(base, /pollDreggWatch/)
  assert.doesNotMatch(serverPaid, /fetch\s*\(/)
  assert.match(poll, /Checkout opens soon/)
})

test('Penumbra is coming, not selectable', () => {
  assert.match(pen, /live: false/)
  assert.match(pen, /Coming/)
  assert.match(pen, /kind: 'not_live'/)
  assert.doesNotMatch(pen, /status: 'paid'/)
  assert.match(tickets, /coming, no SEZS watcher/)
})

test('ETH and Base are Sepolia / Base-Sepolia only', () => {
  assert.match(net, /ETH_SEPOLIA = 11155111/)
  assert.match(net, /BASE_SEPOLIA = 84532/)
  assert.match(net, /LAB_EVM_CHAIN_IDS = \[ETH_SEPOLIA, BASE_SEPOLIA\]/)
  assert.doesNotMatch(net, /31337/)
  assert.match(eth, /11155111/)
  assert.match(base, /84532/)
  assert.match(eth, /chain id 1 is refused/)
  assert.match(base, /8453 is refused/)
})

test('mainnet refused', () => {
  assert.match(net, /ETH_MAINNET = 1/)
  assert.match(net, /BASE_MAINNET = 8453/)
  assert.match(dregg, /127\.0\.0\.1:8421/)
  assert.match(dregg, /mainnetOriginRefused/)
  assert.match(dregg, /zecUriLabOk/)
  assert.doesNotMatch(dregg, /dregg-svg\.permissionless\.money/)
  assert.match(pen, /penumbra1 is refused/)
})

test('no invented UA; dest display is not paid', () => {
  assert.doesNotMatch(zec, /from '\.\.\/dregg\/zec'/)
  assert.match(zec, /No zcash: URI from this page/)
  assert.match(panel, /A URI on screen is not paid/)
  assert.match(panel, /A destination on screen is not paid/)
  assert.match(panel, /No mainnet address is quoted from this page/)
  assert.match(tickets, /dest on screen ≠ paid/)
})

test('mock settlement is labeled on Cash App adapter', () => {
  assert.match(cashapp, /MOCK \/ LAB/)
  assert.match(cashapp, /not a tickets settlement writer/)
})

test('session storage drops a forged paid flag', () => {
  assert.match(session, /dropBrowserPaid/)
  assert.match(session, /paid: _forged/)
  assert.match(loadSave(session), /dropBrowserPaid/)
})

test('guest adapters do not fetch loopback', () => {
  for (const [name, src] of [
    ['zec', zec],
    ['eth', eth],
    ['base', base],
    ['pen', pen],
    ['serverPaid', serverPaid],
    ['index', index],
    ['panel', panel],
    ['tickets', tickets],
    ['net', net],
  ]) {
    assert.doesNotMatch(src, /127\.0\.0\.1:8421/, name)
    assert.doesNotMatch(src, /127\.0\.0\.1:19091/, name)
  }
  assert.match(zec, /live: false/)
  assert.match(eth, /live: false/)
  assert.match(base, /live: false/)
  assert.match(pen, /live: false/)
  assert.match(zec, /Checkout opens soon/)
  assert.match(eth, /Checkout opens soon/)
  assert.match(base, /Checkout opens soon/)
  assert.match(pen, /Checkout opens soon/)
})

function loadSave(src) {
  assert.match(src, /export function loadSession/)
  assert.match(src, /export function saveSession/)
  return src
}

test('tickets quantity uses a stepper and checkout opens in a focused flow', () => {
  assert.match(tickets, /qty-stepper/)
  assert.match(tickets, /data-checkout-modal/)
  assert.match(tickets, /SHIELDED_FACTS/)
  assert.match(tickets, /checkout-focus/)
  assert.doesNotMatch(tickets, /TRANSFER_FACTS/)
  assert.doesNotMatch(tickets, /TicketVault/)
  assert.match(panel, /SHIELDED_FACTS/)
  assert.match(panel, /PayDetails/)
  assert.match(tickets, /Cash at the door/)
})
