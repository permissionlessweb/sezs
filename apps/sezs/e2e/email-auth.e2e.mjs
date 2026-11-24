/**
 * Full browser e2e for SEZS email sign-in through the real Next UI, Next
 * rewrite, standalone SQLite email-auth server, and 0600 file sink.
 * Runs in an isolated temp dir on ephemeral loopback ports (does not touch
 * existing :3051/:3052 servers). Loopback only, zero network email.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import {tmpdir, homedir} from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createEmailAuthHttpServer } from '../dev/splash/email-server.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })

function chromeBin() {
  if (process.env.SEZS_CHROME) return process.env.SEZS_CHROME
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'Library/Caches/ms-playwright')
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort()
  if (!dirs.length) throw new Error('chromium_headless_shell not found in ms-playwright cache')
  const dir = dirs[dirs.length - 1]
  return `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
}

const waitForHttp = async (url, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {}
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const waitForFile = async (dir, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
      if (files.length) return join(dir, files.sort().at(-1))
    } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for outbox file in ${dir}`)
}

const stateDir = mkdtempSync(join(tmpdir(), 'sezs-email-e2e-'))
const outboxDir = join(stateDir, 'email-outbox')
const chromeUserDir = join(stateDir, 'chrome')
const emailPort = await freePort()
const nextPort = await freePort()
const cdpPort = await freePort()
const origin = `http://localhost:${nextPort}`

const emailSrv = createEmailAuthHttpServer({
  host: '127.0.0.1',
  port: emailPort,
  stateDir,
  dbPath: join(stateDir, 'email-auth.sqlite'),
  allowedOrigins: [origin, `http://127.0.0.1:${nextPort}`],
})
await emailSrv.listen()

const nextProc = spawn(
  join(APP, 'node_modules/.bin/next'),
  ['dev', '-p', String(nextPort), '-H', '127.0.0.1'],
  {
    cwd: APP,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SEZS_SPLASH: '1',
      NEXT_PUBLIC_SEZS_SPLASH: '1',
      SEZS_EMAIL_AUTH_URL: `http://127.0.0.1:${emailPort}`,
      SEZS_SPLASH_PORT: String(emailPort),
    },
    stdio: 'ignore',
  },
)

let chromeProc = null
let ws = null

try {
  await waitForHttp(`${origin}/`)
  // Warm up page compilation
  await waitForHttp(`${origin}/sezs/auth/email/health`)

  chromeProc = spawn(
    chromeBin(),
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${chromeUserDir}`,
      '--window-size=1280,900',
      '--remote-allow-origins=*',
      `${origin}/`,
    ],
    { stdio: 'ignore' },
  )

  let pageTarget = null
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      pageTarget = list.find((t) => t.type === 'page')
      if (pageTarget) break
    } catch {}
    await delay(200)
  }
  assert.ok(pageTarget, 'CDP page target opened')

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) rej(new Error(m.error.message))
      else res(m.result)
    }
  })
  const cdp = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error')
    return r.result?.value
  }
  const waitUntil = async (fnExpr, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const v = await evalJs(fnExpr)
      if (v) return v
      await delay(100)
    }
    throw new Error(`Condition timed out: ${fnExpr}`)
  }

  await waitUntil(`document.querySelector('button.rail-wallet') !== null`)
  await evalJs(`document.querySelector('button.rail-wallet').click()`)
  await waitUntil(`document.body.innerText.includes('Email')`)
  await evalJs(`Array.from(document.querySelectorAll('button.wallet-opt')).find(b => b.innerText.includes('Email')).click()`)
  await waitUntil(`document.getElementById('email-signin') !== null`)

  // React-compatible input setter
  await evalJs(`(() => {
    const el = document.getElementById('email-signin')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, 'guest-e2e@example.com')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.form.requestSubmit()
  })()`)

  const outboxFile = await waitForFile(outboxDir)
  assert.equal((statSync(outboxFile).mode & 0o777).toString(8), '600')
  const mail = JSON.parse(readFileSync(outboxFile, 'utf8'))
  assert.equal(mail.to, 'guest-e2e@example.com')
  const code = /code is (\d{6})/.exec(mail.text)?.[1]
  assert.ok(code, '6-digit OTP found in 0600 outbox file')

  await waitUntil(`document.getElementById('email-code') !== null`)
  await evalJs(`(() => {
    const el = document.getElementById('email-code')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, ${JSON.stringify(code)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.form.requestSubmit()
  })()`)

  await waitUntil(`(document.body.textContent || '').includes('guest-e2e@example.com') && (document.body.textContent || '').includes('Disconnect')`)

  // Cookie check via browser fetch + HttpOnly verified via CDP Network.getCookies
  const sessInPage = await evalJs(`fetch('/sezs/auth/email/session', { credentials: 'include' }).then(r => r.json())`)
  assert.equal(sessInPage.ok, true)
  assert.equal(sessInPage.email, 'guest-e2e@example.com')
  assert.equal(sessInPage.kind, 'email')

  const { cookies } = await cdp('Network.getCookies', { urls: [origin] })
  const splashCookie = cookies.find((c) => c.name === 'sezs_splash')
  assert.ok(splashCookie, 'sezs_splash cookie set')
  assert.equal(splashCookie.httpOnly, true)
  assert.equal(splashCookie.sameSite, 'Strict')
  assert.match(splashCookie.value, /^v1\./)

  // Reload page and confirm tab session + server cookie both survive
  await cdp('Page.reload')
  await waitUntil(`(document.querySelector('button.rail-wallet')?.textContent || '').includes('guest-e2e@example.com')`)

  // Disconnect and confirm session is revoked on server
  await evalJs(`document.querySelector('button.rail-wallet').click()`)
  await waitUntil(`(document.body.textContent || '').includes('Disconnect')`)
  await evalJs(`Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Disconnect')).click()`)
  await waitUntil(`(document.querySelector('button.rail-wallet')?.textContent || '').trim() === 'Sign in'`)

  // Wait for async logoutRemote() to complete and confirm /session is 401 (revoked)
  await waitUntil(`fetch('/sezs/auth/email/session', { credentials: 'include' }).then(r => r.status === 401)`)

  // Exercise ?email_code=...&email=... magic-link landing and verify URL scrubbing
  const [reqStatus] = await emailSrv.auth.handlers['POST /sezs/auth/email/request'](
    { headers: { origin, 'x-sezs-csrf': '1' }, socket: { remoteAddress: '127.0.0.1' } },
    { email: 'link-e2e@example.com' },
  )
  assert.equal(reqStatus, 200)
  const linkOutbox = await waitForFile(outboxDir)
  const linkMail = JSON.parse(readFileSync(linkOutbox, 'utf8'))
  const linkCode = /\?email_code=(\d{6})&email=/.exec(linkMail.text)?.[1]
  assert.ok(linkCode, '6-digit code present in emailed link')

  await cdp('Page.navigate', { url: `${origin}/?email_code=${linkCode}&email=${encodeURIComponent('link-e2e@example.com')}` })
  await waitUntil(`(document.querySelector('button.rail-wallet')?.textContent || '').includes('link-e2e@example.com')`)
  const currentHref = await evalJs(`window.location.href`)
  assert.ok(!currentHref.includes('email_code='), 'email_code scrubbed from URL bar')

  console.log('email-auth browser e2e ok')
} finally {
  try { ws?.close() } catch {}
  const stopProc = (p) => new Promise((resolve) => {
    if (!p || p.exitCode !== null) return resolve()
    p.once('exit', resolve)
    try { p.kill('SIGTERM') } catch { return resolve() }
    setTimeout(() => { try { p.kill('SIGKILL') } catch {}; resolve() }, 1500).unref?.()
  })
  await Promise.all([stopProc(chromeProc), stopProc(nextProc)])
  await emailSrv.close()
  try { rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 }) } catch {}
}
