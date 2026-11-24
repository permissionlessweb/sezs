// CDP screenshots of every SEZS route at desktop + mobile. Usage: node shots.mjs <outdir>
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:3051'
const OUT = process.argv[2] || '/tmp/sezs-shots-v2'
mkdirSync(OUT, { recursive: true })
const root = process.env.HOME + '/Library/Caches/ms-playwright'
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
const CHROME = `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const PORT = 9251
const ROUTES = [
  ['home', '/'], ['tickets', '/tickets/'], ['keys', '/keys/'], ['lineup', '/lineup/'], ['calendar', '/calendar/'],
  ['gallery', '/gallery/'], ['studio', '/gallery/?view=studio'], ['gallery-how', '/gallery/?view=how'], ['faq', '/faq/'],
  ['sponsors', '/sponsors/'], ['admin', '/admin/'], ['door', '/door/'], ['check-in', '/check-in/'], ['404', '/nope/'],
]
const SIZES = [['desktop', 1440, 900, 1], ['mobile', 390, 844, 2]]
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/sezs-shots-chrome', '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' })
await delay(1200)
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pend = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
await send('Page.enable')
const log = []
for (const [w, width, height, dpr] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: w === 'mobile' })
  for (const [name, path] of ROUTES) {
    await send('Page.navigate', { url: BASE + path })
    let len = 0
    for (let i = 0; i < 40; i++) {
      await delay(500)
      const r = await send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.length : 0', returnByValue: true })
      len = r.result?.result?.value || 0
      if (len > 120) break
    }
    await delay(1800)
    const m = await send('Page.getLayoutMetrics')
    const h = Math.min(Math.ceil(m.result.cssContentSize.height), 9000)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } })
    const file = `${OUT}/${name}-${w}.png`
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    log.push(`${file} text=${len} h=${h}`)
  }
}
console.error(log.join('\n'))
ws.close()
proc.kill()
