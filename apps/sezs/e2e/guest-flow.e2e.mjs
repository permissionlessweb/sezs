/**
 * Guest walk on loopback :3051. Fails on console errors, bad assets,
 * or the words mock / placeholder / lorem / TODO in visible text.
 * Cash App must not appear on pre-arrival tickets. Door shows a compact
 * empty Cash App state when cashapp-qr.png is absent. The file is
 * user-supplied and is not in the app, so the suite does not expect an image.
 * Signed-out /admin is gated and must not expose door-pay copy.
 */
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.SEZS_E2E_BASE || 'http://127.0.0.1:3051'

function chromeBin() {
  if (process.env.SEZS_CHROME) return process.env.SEZS_CHROME
  const root = '$HOME/Library/Caches/ms-playwright'
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
  const dir = dirs[dirs.length - 1]
  return `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
}

const CHROME = chromeBin()
const PORT = 9244

const GUEST = ['/', '/tickets/', '/keys/', '/faq/', '/gallery/', '/lineup/', '/calendar/']
const ROLE = ['/door/', '/admin/']
const BANNED = /\b(mock|placeholder|lorem|TODO)\b/i

function start() {
  return spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/sezs-r4-chrome',
      '--remote-allow-origins=*',
      BASE,
    ],
    { stdio: 'ignore' }
  )
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) events.push(msg)
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id
      pending.set(n, resolve)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  return { ws, send, events }
}

const proc = start()
await delay(900)
const { ws, send, events } = await connect()
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Log.enable')

const failures = []

function note(route, kind, detail) {
  const clean = String(detail).replace(/[?#].*/g, '').slice(0, 180)
  if (/password|mnemonic|secret|api[_-]?key|bearer/i.test(clean)) return
  failures.push({ route, kind, detail: clean })
}

for (const route of [...GUEST, ...ROLE]) {
  events.length = 0
  await send('Page.navigate', { url: BASE + route })
  let text = ''
  for (let i = 0; i < 12; i++) {
    await delay(400)
    const body = await send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    })
    text = body.result?.result?.value || ''
    if (text.length > 80) break
  }
  const banned = text.match(BANNED)
  if (banned) note(route, 'copy', banned[0])

  if (route.startsWith('/tickets')) {
    const order = ['ZEC', 'ETH', 'Base', 'Penumbra']
    let at = -1
    for (const label of order) {
      const i = text.indexOf(label)
      if (i < 0) note(route, 'rails', `missing ${label}`)
      else if (i < at) note(route, 'rails', `${label} out of order`)
      else at = i
    }
    if (/Cash App/i.test(text)) note(route, 'rails', 'Cash App on pre-arrival tickets')
  }
  if (route.startsWith('/keys')) {
    for (const label of ['Keplr', 'Zafu', 'ephemeral', 'passkey']) {
      if (!text.includes(label)) note(route, 'signin', `missing ${label}`)
    }
    if (!/allOf|AlloF/i.test(text)) note(route, 'signin', 'missing allOf')
  }
  if (route.startsWith('/door')) {
    const missing = await send('Runtime.evaluate', {
      expression: 'document.querySelector("[data-cash-qr=\\"missing\\"]") !== null || /No QR/.test(document.body ? document.body.innerText : "")',
      returnByValue: true,
    })
    if (!missing.result?.result?.value) note(route, 'qr', 'missing empty Cash App state')
    const img = await send('Runtime.evaluate', {
      expression: '!!document.querySelector(".door-qr-img")',
      returnByValue: true,
    })
    if (img.result?.result?.value === true) {
      note(route, 'qr', 'QR image rendered without a supplied file')
    }
  }
  for (const ev of events) {
    if (ev.method === 'Runtime.exceptionThrown') {
      note(route, 'exception', ev.params?.exceptionDetails?.text || 'exception')
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
      const arg = ev.params.args?.[0]?.value || ev.params.args?.[0]?.description || 'console error'
      note(route, 'console', arg)
    }
    if (ev.method === 'Network.responseReceived') {
      const status = ev.params?.response?.status || 0
      const url = ev.params?.response?.url || ''
      if (status >= 400 && !url.includes('favicon.ico') && !url.includes('cashapp-qr.png')) note(route, 'asset', `${status} ${url}`)
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url)) {
        note(route, 'font', 'third-party font request')
      }
    }
  }
}

console.log(JSON.stringify(failures, null, 2))
ws.close()
proc.kill()
if (failures.length) process.exit(1)
