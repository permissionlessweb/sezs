#!/usr/bin/env node
/**
 * Smoke + e2e for /tickets payments on :3051.
 * Does not mark paid. Does not send mainnet txs.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

const BASE = process.env.SEZS_BASE_URL || 'http://127.0.0.1:3051'

const fetchText = async (path, extra = {}) => {
  const t0 = Date.now()
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'follow',
    ...extra,
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: buf.toString('utf8'),
    bytes: buf.length,
    ms: Date.now() - t0,
  }
}

const collectScripts = (html) =>
  [...html.matchAll(/\/_next\/static\/[^"' ]+/g)].map((m) => m[0])

const main = async () => {
  const tickets = await fetchText('/tickets/')
  assert.equal(tickets.status, 200, 'tickets 200')
  const admin = await fetchText('/admin/')
  assert.equal(admin.status, 200, 'admin 200')

  const chunks = []
  for (const src of collectScripts(tickets.body)) {
    const got = await fetchText(src.startsWith('/') ? src : `/${src}`)
    if (got.status === 200) chunks.push(got.body)
  }
  const ticketsJs = tickets.body + '\n' + chunks.join('\n')

  assert.doesNotMatch(
    ticketsJs,
    /Door only \(not pre-arrival checkout\)/,
    'old Cash App door rail group must be gone from tickets JS'
  )
  assert.match(ticketsJs, /Shielded ZEC/, 'ZEC on tickets')
  assert.match(ticketsJs, /Ether \(obfuscated\)|ETH/, 'ETH on tickets')
  assert.match(ticketsJs, /Base \(obfuscated\)/, 'Base on tickets')
  assert.match(ticketsJs, /Shielded Penumbra/, 'Penumbra named on tickets')
  assert.match(ticketsJs, /coming/i, 'Penumbra coming copy')
  assert.match(ticketsJs, /Checkout opens soon/, 'honest unwired state')
  assert.doesNotMatch(ticketsJs, /commitPaid/, 'commitPaid gone from tickets JS')
  assert.doesNotMatch(
    ticketsJs,
    /127\.0\.0\.1:8421/,
    'guest bundle must not call DREGG loopback'
  )
  assert.doesNotMatch(
    ticketsJs,
    /\/sezs\/pay\/(poll|ticket)/,
    'guest bundle must not fetch /sezs/pay on loopback'
  )
  assert.match(ticketsJs, /Sepolia/, 'Sepolia named')
  assert.match(ticketsJs, /Base-Sepolia|84532/, 'Base-Sepolia named')

  assert.doesNotMatch(
    tickets.body,
    /Cash App/,
    'tickets HTML shell must not name Cash App'
  )

  const adminJsChunks = []
  for (const src of collectScripts(admin.body)) {
    const got = await fetchText(src.startsWith('/') ? src : `/${src}`)
    if (got.status === 200) adminJsChunks.push(got.body)
  }
  const adminJs = admin.body + '\n' + adminJsChunks.join('\n')
  assert.match(adminJs, /door-cashapp-qr/, 'Cash App remains on admin')

  const cache = (tickets.headers['cache-control'] || '').toLowerCase()
  const enc = tickets.headers['content-encoding'] || 'identity'
  const report = {
    ok: true,
    base: BASE,
    tickets_ms: tickets.ms,
    tickets_bytes: tickets.bytes,
    admin_bytes: admin.bytes,
    cache_control: tickets.headers['cache-control'] || null,
    content_encoding: enc,
    content_type: tickets.headers['content-type'] || null,
    cashapp_absent_from_tickets_html: !/Cash App/i.test(tickets.body),
    rails_in_tickets_js: {
      zec: /Shielded ZEC/.test(ticketsJs),
      eth: /Ether \(obfuscated\)/.test(ticketsJs),
      base: /Base \(obfuscated\)/.test(ticketsJs),
      penumbra: /Shielded Penumbra/.test(ticketsJs),
      penumbra_coming: /coming/i.test(ticketsJs),
      checkout_opens_soon: /Checkout opens soon/.test(ticketsJs),
      commitPaid_absent: !/commitPaid/.test(ticketsJs),
      loopback_8421_absent: !/127\.0\.0\.1:8421/.test(ticketsJs),
      pay_poll_ticket_fetch_absent: !/\/sezs\/pay\/(poll|ticket)/.test(ticketsJs),
      session_inbox_19091_in_shared: /127\.0\.0\.1:19091/.test(ticketsJs),
    },
    cashapp_on_admin: /door-cashapp-qr/.test(adminJs),
    browser_forged_paid_unlocks: false,
    notes: [
      cache.includes('no-store')
        ? 'dev Cache-Control is no-store (expected for next dev)'
        : `cache-control=${cache || 'unset'}`,
      enc === 'identity' || !tickets.headers['content-encoding']
        ? 'no content-encoding on this hop (next dev; gzip only if a front proxy adds it)'
        : `encoded ${enc}`,
      `tickets TTFB-ish ${tickets.ms}ms ${tickets.bytes}B shell`,
      'guest pay adapters must not fetch :8421 or /sezs/pay; rust e2e covers forged paid',
      /127\.0\.0\.1:19091/.test(ticketsJs)
        ? 'shared JS still names 127.0.0.1:19091 (p1J session inbox) — not a pay adapter fetch'
        : 'no 127.0.0.1:19091 in tickets JS',
    ],
  }
  console.log(JSON.stringify(report, null, 2))
  const out = process.env.SEZS_E2E_OUT
  if (out) writeFileSync(out, JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
