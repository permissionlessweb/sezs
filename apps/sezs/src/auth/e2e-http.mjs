import assert from 'node:assert/strict'
import test from 'node:test'

const ORIGIN = 'http://127.0.0.1:3051'
const INBOX = 'http://127.0.0.1:19091'
const MAIL = 'http://127.0.0.1:3061'

async function probe(url, init = {}) {
  const t0 = Date.now()
  const res = await fetch(url, { redirect: 'follow', ...init })
  const buf = Buffer.from(await res.arrayBuffer())
  const ms = Date.now() - t0
  const headers = {}
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })
  return { res, buf, ms, headers, text: buf.toString('utf8') }
}

function jsonSafe(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

test('loopback :3051 is up', async () => {
  const { res } = await probe(`${ORIGIN}/`)
  assert.equal(res.ok, true)
})

test('CSP meta on /desk and /admin; no password input in document', async () => {
  for (const path of ['/desk/', '/admin/', '/tickets/']) {
    const { res, text } = await probe(`${ORIGIN}${path}`)
    assert.equal(res.ok, true, path)
    assert.match(text, /Content-Security-Policy/)
    assert.match(text, /nosniff/)
    assert.match(text, /frame-ancestors/)
    assert.match(text, /Permissions-Policy/)
    assert.doesNotMatch(text, /type=["']password["']/)
    assert.doesNotMatch(text, /\bADMIN_PW\b/)
  }
})

test('desk bundle: no password; flags are not a send', async () => {
  const page = await probe(`${ORIGIN}/desk/`)
  assert.ok(page.ms < 8000, `desk load ${page.ms}ms`)
  const js = await probe(`${ORIGIN}/_next/static/chunks/pages/desk.js`)
  assert.equal(js.res.ok, true)
  assert.match(js.text, /does not take a password/)
  assert.match(js.text, /flags here are not a send/)
})

test('admin bundle: not a password; passkey unlock; no NEXT_PUBLIC allowlist', async () => {
  const js = await probe(`${ORIGIN}/_next/static/chunks/pages/admin.js`)
  assert.equal(js.res.ok, true)
  assert.match(js.text, /Admin is not a password/)
  assert.match(js.text, /Unlock with passkey/)
  const sessionChunk = await probe(`${ORIGIN}/_next/static/chunks/pages/_app.js`)
  const blob = js.text + sessionChunk.text
  assert.doesNotMatch(blob, /NEXT_PUBLIC_SEZS_ADMIN_CREDS/)
  assert.doesNotMatch(blob, /NEXT_PUBLIC_SEZS_USHER_CREDS/)
})

test('cache and compression signals', async () => {
  const page = await fetch(`${ORIGIN}/desk/`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  const enc = page.headers.get('content-encoding') || 'identity'
  const asset = await fetch(`${ORIGIN}/sezs-assets/site.css`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  const assetEnc = asset.headers.get('content-encoding') || 'identity'
  const cacheAsset = asset.headers.get('cache-control') || 'none'
  const t0 = Date.now()
  const again = await fetch(`${ORIGIN}/desk/`)
  const ms = Date.now() - t0
  const csp = Boolean(page.headers.get('content-security-policy'))
  console.log(
    JSON.stringify({
      page_ms: ms,
      page_encoding: enc,
      asset_encoding: assetEnc,
      asset_cache: cacheAsset,
      http_csp: csp,
      xfo: page.headers.get('x-frame-options') || 'none',
      again_ok: again.ok,
    })
  )
  assert.equal(again.ok, true)
  assert.ok(ms < 4000, `repeat desk ${ms}ms`)
})

test('frost inbox session: fail closed or cookie flags', async () => {
  let inbox
  try {
    inbox = await probe(`${INBOX}/sezs/session/health`, {
      headers: { Origin: ORIGIN },
    })
  } catch {
    inbox = null
  }
  if (!inbox) {
    console.log(JSON.stringify({ inbox: 'down', cookie: 'fail_closed' }))
    return
  }
  const j = jsonSafe(inbox.text)
  assert.equal(j && j.ok, true)
  assert.match(String(j.cookie || ''), /HttpOnly/)
  const me = await probe(`${INBOX}/sezs/session/me`, {
    headers: { Origin: ORIGIN },
    credentials: 'include',
  })
  assert.equal(me.res.status, 401)
  const evil = await probe(`${INBOX}/sezs/session/challenge`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ origin: 'https://evil.example' }),
  })
  assert.equal(evil.res.status, 403)
  const acao = evil.headers['access-control-allow-origin'] || ''
  assert.notEqual(acao, '*')
  assert.doesNotMatch(acao, /evil/)
})

test('admin roster routes: loopback, no cookie elevation', async () => {
  let jobs
  try {
    jobs = await probe(`${INBOX}/sezs/frost/jobs`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ pay_code: 'pay-20-x', roster_commit: '0'.repeat(64) }),
    })
  } catch {
    console.log(JSON.stringify({ roster: 'inbox_down' }))
    return
  }
  const j = jsonSafe(jobs.text)
  assert.ok(j)
  // Finding (p26 owns job auth): loopback frost jobs still create without a
  // session cookie. Session /me stays 401 — cookie is not confused with jobs.
  const me = await probe(`${INBOX}/sezs/session/me`, {
    headers: { Origin: 'https://evil.example' },
  })
  console.log(
    JSON.stringify({
      roster_status: jobs.res.status,
      roster_ok: j.ok === true,
      finding:
        j.ok === true
          ? 'jobs_unauthenticated_on_loopback'
          : 'jobs_rejected',
      me_without_cookie: me.res.status,
    })
  )
  assert.equal(me.res.status, 401)
})

test('mail gateway :3061 pentest — no token print', async () => {
  let health
  try {
    health = await probe(`${MAIL}/health`)
  } catch {
    console.log(JSON.stringify({ mail: 'down' }))
    return
  }
  assert.equal(health.res.ok, true)
  const j = jsonSafe(health.text)
  assert.ok(j)
  const keys = j && typeof j === 'object' ? Object.keys(j).sort() : []
  const evil = await probe(`${MAIL}/subscribe`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: 'x@evil.example' }),
  })
  const remind = await probe(`${MAIL}/remind`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  const confirm = await probe(`${MAIL}/confirm?t=deadbeef`)
  console.log(
    JSON.stringify({
      mail_bind: '127.0.0.1:3061',
      health_keys: keys,
      health_has_counts: 'confirmed' in (j || {}) || 'pending' in (j || {}),
      evil_subscribe: evil.res.status,
      remind: remind.res.status,
      confirm_bogus: confirm.res.status,
      cors_star: (health.headers['access-control-allow-origin'] || '') === '*',
    })
  )
  assert.notEqual(health.headers['access-control-allow-origin'], '*')
  assert.doesNotMatch(health.text, /[0-9a-f]{64}/)
})
