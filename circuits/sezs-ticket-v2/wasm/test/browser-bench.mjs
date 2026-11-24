// Headless Chromium prove timing for the web build. Serves wasm/ on 127.0.0.1 only.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')
const root = fileURLToPath(new URL('..', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }
const srv = http.createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!p.startsWith(root)) return res.writeHead(403).end()
  try { res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }).end(await readFile(p)) } catch { res.writeHead(404).end() }
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}/test/bench.html`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.ready === true)
  const r = await page.evaluate(() => window.bench())
  console.log(JSON.stringify({ browser: browser.version(), ...r }))
} finally {
  await browser.close()
  srv.close()
}
