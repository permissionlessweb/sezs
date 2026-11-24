/**
 * DEV ONLY splash board walk (needs `pnpm dev:splash`). Uses localhost so
 * WebAuthn has a valid RP ID; a CDP virtual authenticator stands in for a
 * passkey. Steps: board loads → checklist button → usher checks a ticket in
 * on the real /check-in page → the same ticket is refused → admin unlocks
 * /admin with a test passkey. Screenshots go to SEZS_SHOTS (optional).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.env.SEZS_E2E_BASE || 'http://localhost:3051'
const SHOTS = process.env.SEZS_SHOTS || ''
const PORT = 9246

function chromeBin() {
  if (process.env.SEZS_CHROME) return process.env.SEZS_CHROME
  const root = '$HOME/Library/Caches/ms-playwright'
  const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
  return `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
}

const proc = spawn(chromeBin(), ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/sezs-splash-chrome', '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' })
await delay(900)
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })
let n = 0
const wait = new Map()
const events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evalv = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
const text = () => evalv('document.body ? document.body.innerText : ""')
const until = async (re, ms = 15000) => {
  const end = Date.now() + ms
  let t = ''
  while (Date.now() < end) { t = await text(); if (re.test(t)) return t; await delay(300) }
  throw new Error(`timeout waiting for ${re}: …${t.slice(-200)}`)
}
const go = async (path) => { await send('Page.navigate', { url: BASE + path }); await delay(600) }
const size = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile })
const shot = async (name, full = true) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await evalv('document.documentElement.style.setProperty("--depth","0"); window.scrollTo(0,0)')
  await delay(400)
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full })
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
const fill = (sel, v) => evalv(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const click = (label) => evalv(`(() => { const all = [...document.querySelectorAll('button')]; const b = all.find((x) => x.textContent.trim() === ${JSON.stringify(label)}) || all.find((x) => (x.firstChild?.parentElement?.innerText || '').replace(/^[○◉]\\s*/, '').toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())})); if (!b) return false; b.click(); return true })()`)

const results = []
const step = async (name, fn) => {
  try { results.push({ name, ok: true, detail: String((await fn()) || 'ok') }) } catch (e) { results.push({ name, ok: false, detail: e.message }) }
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('WebAuthn.enable')
await send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
await size(1440, 900)

const api = (path, body) =>
  evalv(`fetch('/__splash/api${path}', ${body ? `{ method: 'POST', headers: { 'content-type': 'application/json', 'x-sezs-splash': '1' }, body: ${JSON.stringify(JSON.stringify(body))} }` : '{}'}).then((r) => r.json())`)

await step('board loads and seeds a clean event', async () => {
  await go('/splash/')
  await until(/Scenario/i)
  await api('/reset', { mode: 'reset' })
  await until(/No test identities yet/)
  if (!(await click('Clean event'))) throw new Error('Clean event button not found')
  await until(/admin-1/)
  await delay(800)
  await shot('board-desktop')
  return 'clean seeded'
})
await step('checklist button reports every step', async () => {
  const t0 = Date.now() - 2000
  await click('Run e2e checklist')
  let ck = null
  for (let i = 0; i < 100 && !(ck && ck.at > t0); i++) {
    await delay(300)
    ck = (await api('/state')).checklist
  }
  if (!ck || ck.at <= t0) throw new Error('checklist did not finish')
  await until(new RegExp(`${ck.pass}/${ck.total} passed`))
  await delay(500)
  await shot('board-checklist')
  const bad = ck.steps.filter((x) => !x.ok).map((x) => x.name)
  if (bad.length) throw new Error(`${ck.pass}/${ck.total} passed; failed: ${bad.join('; ')}`)
  return `${ck.pass}/${ck.total}`
})
const ticket = await evalv(`fetch('/__splash/api/state').then(r=>r.json()).then(s=>s.tickets.find(t=>t.holder==='guest-keplr').id)`)
await step('usher checks a ticket in on the real /check-in page', async () => {
  await go(`/splash/?as=usher-1&to=${encodeURIComponent('/check-in/')}`)
  await until(/Consume/i)
  await fill('input[aria-label="Ticket id"]', ticket)
  await click('Consume')
  await until(/That ticket is used/)
  await shot('check-in-admitted')
  return ticket
})
await step('the same ticket is refused the second time', async () => {
  await click('Consume')
  await until(/already used/i)
  await shot('check-in-refused')
  return 'Refused: ticket already used.'
})
await step('/door lists the test usher on duty', async () => {
  await go('/door/')
  await until(/Can check guests in: .*usher-1/)
  return 'usher-1 on duty'
})
await step('admin unlocks /admin with a test passkey', async () => {
  await go(`/splash/?as=admin-1&to=${encodeURIComponent('/admin/')}&passkey=1`)
  await until(/Unlock with passkey/i)
  await click('Unlock with passkey')
  await until(/Roster hash/i)
  await shot('admin-unlocked')
  return 'admin sections visible'
})
await step('board on mobile', async () => {
  await size(390, 844, true)
  await go('/splash/')
  await until(/Event log/i)
  await shot('board-mobile')
  return '390px'
})

console.log(JSON.stringify(results, null, 2))
ws.close()
proc.kill()
if (results.some((r) => !r.ok)) process.exit(1)
