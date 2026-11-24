import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'

import { QueryCache, hashKey, settleAll } from './core.ts'
import { IndexerHealth, indexerFirst, queryIndexer } from './indexer.ts'
import { LcdError, lcdAllowed, lcdSmart, smartPath } from './lcd.ts'
import { startVisibleInterval } from './visibility.ts'

const tick = () => new Promise((r) => setImmediate(r))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---------- core: dedupe, cache, abort ----------

test('hashKey is stable across object key order', () => {
  assert.equal(hashKey(['a', { x: 1, y: 2 }]), hashKey(['a', { y: 2, x: 1 }]))
  assert.notEqual(hashKey(['a', 'b']), hashKey(['a', 'c']))
})

test('concurrent reads of one key share one request', async () => {
  const c = new QueryCache()
  let calls = 0
  const d = deferred()
  const def = { key: ['k', 1], fn: () => (calls++, d.promise) }
  const all = Promise.all([c.fetch(def), c.fetch(def), c.fetch(def)])
  d.resolve('v')
  assert.deepEqual(await all, ['v', 'v', 'v'])
  assert.equal(calls, 1)
})

test('fresh entries are served from cache; stale entries refetch', async () => {
  let now = 1000
  const c = new QueryCache(() => now)
  let calls = 0
  const def = { key: ['k'], staleTime: 30_000, fn: async () => ++calls }
  assert.equal(await c.fetch(def), 1)
  now += 29_999
  assert.equal(await c.fetch(def), 1)
  assert.equal(calls, 1)
  now += 2
  assert.equal(await c.fetch(def), 2)
  assert.equal(calls, 2)
})

test('invalidate by prefix makes matching keys stale and bumps version', async () => {
  const c = new QueryCache()
  let a = 0
  let b = 0
  const da = { key: ['sezs', 'event', 'm', 'view', 'x'], staleTime: 60_000, fn: async () => ++a }
  const db = { key: ['sezs', 'raffle', 'm'], staleTime: 60_000, fn: async () => ++b }
  await c.fetch(da)
  await c.fetch(db)
  c.invalidate(['sezs', 'event'])
  assert.equal(c.peek(da.key).version, 1)
  assert.equal(c.peek(db.key).version, 0)
  await c.fetch(da)
  await c.fetch(db)
  assert.deepEqual([a, b], [2, 1])
})

test('a failed refetch keeps the last good value', async () => {
  let now = 0
  const c = new QueryCache(() => now)
  let fail = false
  const def = { key: ['k'], staleTime: 10, fn: async () => (fail ? Promise.reject(new Error('down')) : 'good') }
  assert.equal(await c.fetch(def), 'good')
  now = 100
  fail = true
  await assert.rejects(c.fetch(def), /down/)
  const s = c.peek(def.key)
  assert.equal(s.status, 'success')
  assert.equal(s.data, 'good')
})

test('shared request aborts only after every caller aborts', async () => {
  const c = new QueryCache()
  let seen
  const def = {
    key: ['slow'],
    fn: ({ signal }) =>
      new Promise((resolve, reject) => {
        seen = signal
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        setTimeout(() => resolve('done'), 50)
      }),
  }
  const a = new AbortController()
  const b = new AbortController()
  const pa = c.fetch(def, { signal: a.signal })
  const pb = c.fetch(def, { signal: b.signal })
  a.abort()
  await assert.rejects(pa, { name: 'AbortError' })
  assert.equal(seen.aborted, false, 'one caller left, request keeps running')
  b.abort()
  await assert.rejects(pb, { name: 'AbortError' })
  assert.equal(seen.aborted, true)
  // A new caller after the abort starts a fresh request.
  assert.equal(await c.fetch({ ...def, fn: async () => 'again' }), 'again')
})

test('setData seeds a key so no request is made', async () => {
  const c = new QueryCache()
  c.setData(['summary', 'x'], { name: 'Baltimore' })
  let calls = 0
  const v = await c.fetch({ key: ['summary', 'x'], staleTime: 60_000, fn: async () => (calls++, {}) })
  assert.deepEqual(v, { name: 'Baltimore' })
  assert.equal(calls, 0)
})

test('unwatched entries are dropped after gcTime', async () => {
  const c = new QueryCache()
  await c.fetch({ key: ['gc'], gcTime: 5, fn: async () => 1 })
  assert.equal(c.size, 1)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(c.size, 0)
})

test('settleAll keeps partial results', async () => {
  const out = await settleAll([async () => 1, async () => Promise.reject(new Error('x')), async () => 3])
  assert.deepEqual(out, [1, null, 3])
})

// ---------- lcd ----------

test('lcdAllowed keeps the host allowlist', () => {
  assert.equal(lcdAllowed('https://api.terp.network'), true)
  assert.equal(lcdAllowed('http://api.terp.network'), false)
  assert.equal(lcdAllowed('https://evil.example'), false)
  assert.equal(lcdAllowed('http://127.0.0.1:1317'), true)
  assert.equal(lcdAllowed('https://u:p@api.terp.network'), false)
})

test('lcdSmart builds the smart path and returns data', async () => {
  const urls = []
  const fake = async (u) => (urls.push(u), json({ data: { name: 'x' } }))
  const v = await lcdSmart('https://api.terp.network/', 'terp1abc', { event_info: {} }, { fetch: fake })
  assert.deepEqual(v, { name: 'x' })
  assert.equal(urls[0], 'https://api.terp.network' + smartPath('terp1abc', { event_info: {} }))
  assert.match(urls[0], /\/smart\/eyJldmVudF9pbmZvIjp7fX0=$/)
  await assert.rejects(lcdSmart('https://api.terp.network', 'terp1abc', {}, { fetch: async () => json({}, 500) }), LcdError)
  await assert.rejects(lcdSmart('https://evil.example', 'terp1abc', {}, { fetch: fake }), /allowlist/)
})

// ---------- indexer first, chain fallback ----------

const cfg = { base: 'https://indexer.example', chainId: 'morocco-1' }
const isObj = (v) => !!v && typeof v === 'object'

test('no indexer configured: chain only, no indexer request', async () => {
  let idx = 0
  const got = await indexerFirst({
    indexer: null,
    fromIndexer: async () => (idx++, {}),
    accept: isObj,
    fromChain: async () => ({ from: 'chain' }),
  })
  assert.deepEqual(got, { data: { from: 'chain' }, source: 'chain' })
  assert.equal(idx, 0)
})

test('indexer answer is used when it passes the type guard', async () => {
  let chain = 0
  const got = await indexerFirst({
    indexer: cfg,
    health: new IndexerHealth(),
    fromIndexer: async () => ({ from: 'indexer' }),
    accept: isObj,
    fromChain: async () => (chain++, { from: 'chain' }),
  })
  assert.equal(got.source, 'indexer')
  assert.equal(chain, 0)
})

test('indexer miss (404 / wrong shape) falls back without marking it down', async () => {
  const health = new IndexerHealth()
  const miss = await indexerFirst({
    indexer: cfg,
    health,
    fromIndexer: (c) => queryIndexer(c, 'terp1x', 'sezs/eventView', undefined, { fetch: async () => new Response('', { status: 404 }) }),
    accept: isObj,
    fromChain: async () => ({ from: 'chain' }),
  })
  assert.equal(miss.source, 'chain')
  assert.equal(health.isDown(cfg.base), false)
  const shape = await indexerFirst({ indexer: cfg, health, fromIndexer: async () => 'nope', accept: isObj, fromChain: async () => ({ ok: 1 }) })
  assert.equal(shape.source, 'chain')
})

test('indexer 5xx or network error falls back and is skipped during the cool-down', async () => {
  let now = 0
  const health = new IndexerHealth(() => now)
  let idx = 0
  const run = () =>
    indexerFirst({
      indexer: cfg,
      health,
      fromIndexer: async () => {
        idx++
        throw new TypeError('fetch failed')
      },
      accept: isObj,
      fromChain: async () => ({ from: 'chain' }),
    })
  assert.equal((await run()).source, 'chain')
  assert.equal((await run()).source, 'chain')
  assert.equal(idx, 1, 'second read skipped the down indexer')
  now += 60_001
  await run()
  assert.equal(idx, 2, 'retried after the cool-down')
})

test('queryIndexer uses the DAO DAO URL shape', async () => {
  const urls = []
  const v = await queryIndexer(cfg, 'terp1x', 'sezs/eventInfo', { limit: 5 }, { fetch: async (u) => (urls.push(u), json({ name: 'n' })) })
  assert.deepEqual(v, { name: 'n' })
  assert.equal(urls[0], 'https://indexer.example/morocco-1/contract/terp1x/sezs/eventInfo?limit=5')
})

test('an abort is passed through, not treated as an indexer failure', async () => {
  const health = new IndexerHealth()
  const ctrl = new AbortController()
  ctrl.abort()
  await assert.rejects(
    indexerFirst({
      indexer: cfg,
      health,
      signal: ctrl.signal,
      fromIndexer: async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      accept: isObj,
      fromChain: async () => ({}),
    }),
    { name: 'AbortError' },
  )
  assert.equal(health.isDown(cfg.base), false)
})

// ---------- event queries (client.ts bundled with esbuild) ----------

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../..')
const esbuild = join(app, '../../node_modules/.pnpm/esbuild@0.25.2/node_modules/esbuild/bin/esbuild')
const bundle = join(tmpdir(), `sezs-event-client-${process.pid}.mjs`)
const entry = join(tmpdir(), `sezs-event-entry-${process.pid}.ts`)
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(here, '../event/client.ts'))}\nexport { queryCache } from ${JSON.stringify(join(here, 'core.ts'))}\n`,
)
execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--outfile=' + bundle], { stdio: 'pipe' })
const ev = await import(bundle)

const VIEW = {
  event: { name: 'Speak-Ez Sessions — Baltimore', start: '1798779600000000000', end: '1798952340000000000', timezone: 'America/New_York', tags: [] },
  venue: { revealed: false },
  lineup: [],
  timeline: [],
  sponsors: [],
  tiers: [],
  raffles: [],
  faq: [],
  roles: {},
}
const decode = (u) => Object.keys(JSON.parse(Buffer.from(decodeURIComponent(u.split('/smart/')[1]), 'base64').toString()))[0]
const withFetch = async (impl, fn) => {
  const prev = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = prev
  }
}

test('Frame + page + modal reading the event at once cost one event_view', async () => {
  const seen = []
  const boot = { contract: 'terp1aaa', lcd: 'https://api.terp.network', chainId: 'test-dedupe', raffle: '', randomness: '' }
  await withFetch(
    async (u) => (seen.push(decode(u)), json({ data: VIEW })),
    async () => {
      const def = () => ev.eventLoadQuery(boot)
      const rows = await Promise.all([ev.queryCache.fetch(def()), ev.queryCache.fetch(def()), ev.queryCache.fetch(def())])
      for (const r of rows) assert.equal(r.data.event.name, VIEW.event.name)
      // The picker label for the selected event comes from the same view.
      const s = await ev.queryCache.fetch(ev.eventSummaryQuery(boot, 'terp1aaa', { viaView: true }))
      assert.equal(s.name, VIEW.event.name)
      assert.ok(s.startsAt.startsWith('2027-01-01'))
    },
  )
  assert.deepEqual(seen, ['event_view'])
})

test('selected event summary joins the in-flight view instead of event_info', async () => {
  const seen = []
  const boot = { contract: 'terp1bbb', lcd: 'https://api.terp.network', chainId: 'test-join', raffle: '', randomness: '' }
  await withFetch(
    async (u) => (seen.push(decode(u)), json({ data: decode(u) === 'event_view' ? VIEW : { name: 'Other', start: '1798779600000000000' } })),
    async () => {
      // Picker effects run before the page's; both end up on one event_view.
      const [s] = await Promise.all([
        ev.queryCache.fetch(ev.eventSummaryQuery(boot, 'terp1bbb', { viaView: true })),
        ev.queryCache.fetch(ev.eventLoadQuery(boot)),
      ])
      assert.equal(s.name, VIEW.event.name)
      const other = await ev.queryCache.fetch(ev.eventSummaryQuery(boot, 'terp1ccc'))
      assert.equal(other.name, 'Other')
    },
  )
  assert.deepEqual(seen.sort(), ['event_info', 'event_view'])
})

test('older contracts without event_view: fan-out runs in parallel', async () => {
  const seen = []
  let inFlight = 0
  let peak = 0
  const boot = { contract: 'terp1old', lcd: 'https://api.terp.network', chainId: 'test-fanout', raffle: '', randomness: '' }
  await withFetch(
    async (u) => {
      const q = decode(u)
      seen.push(q)
      if (q === 'event_view') return json({ code: 2, message: 'Error parsing into type cw_event_manifold::msg::QueryMsg: unknown variant `event_view`, expected one of `event_info`' }, 500)
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight--
      if (q === 'event_info') return json({ data: VIEW.event })
      if (q === 'faq') return json({}, 500)
      return json({ data: { items: [] } })
    },
    async () => {
      const r = await ev.queryCache.fetch(ev.eventLoadQuery(boot))
      assert.equal(r.source, 'chain')
      assert.equal(r.data.event.name, VIEW.event.name)
      assert.deepEqual(r.data.faq, [])
    },
  )
  assert.equal(seen.length, 12)
  assert.ok(peak >= 8, `independent fan-out queries overlap (peak ${peak})`)
})

test('a 503 on event_view fails fast with a note, no older-contract fan-out', async () => {
  let calls = 0
  const boot = { contract: 'terp1bad', lcd: 'https://api.terp.network', chainId: 'test-fail', raffle: '', randomness: '' }
  await withFetch(
    async () => (calls++, json({}, 503)),
    async () => {
      const r = await ev.queryCache.fetch(ev.eventLoadQuery(boot))
      assert.equal(r.source, 'none')
      assert.match(r.note, /could not be read/)
    },
  )
  assert.equal(calls, 1, 'a 503 does not trigger the older-contract fan-out')
})

// ---------- visible-tab polling ----------

test('visible interval ticks immediately, pauses while hidden, and ticks on return', async () => {
  let hidden = false
  const listeners = []
  const io = {
    hidden: () => hidden,
    subscribe: (cb) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
  }
  const hits = []
  const off = startVisibleInterval(() => hits.push(Date.now()), 30, io)
  assert.equal(hits.length, 1, 'immediate tick while visible')
  await new Promise((r) => setTimeout(r, 75))
  const mid = hits.length
  assert.ok(mid >= 3, `interval ran while visible (got ${mid})`)
  hidden = true
  for (const l of [...listeners]) l()
  const atHide = hits.length
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(hits.length, atHide, 'no ticks while hidden')
  hidden = false
  for (const l of [...listeners]) l()
  assert.equal(hits.length, atHide + 1, 'immediate tick when visible again')
  off()
  const after = hits.length
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(hits.length, after, 'stopped after dispose')
})

test('hidden at start does not tick until the tab is visible', async () => {
  let hidden = true
  const listeners = []
  const io = {
    hidden: () => hidden,
    subscribe: (cb) => {
      listeners.push(cb)
      return () => {}
    },
  }
  const hits = []
  const off = startVisibleInterval(() => hits.push(1), 20, io)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(hits.length, 0)
  hidden = false
  for (const l of [...listeners]) l()
  assert.equal(hits.length, 1)
  off()
})

test('other event summaries stay unfetched until asked; the selected one joins event_view', async () => {
  const seen = []
  const boot = { contract: 'terp1sel', lcd: 'https://api.terp.network', chainId: 'test-lazy', raffle: '', randomness: '' }
  await withFetch(
    async (u) => (seen.push(decode(u)), json({ data: decode(u) === 'event_view' ? VIEW : { name: 'Other', start: '1798779600000000000' } })),
    async () => {
      await ev.queryCache.fetch(ev.eventLoadQuery(boot))
      const selected = await ev.queryCache.fetch(ev.eventSummaryQuery(boot, 'terp1sel', { viaView: true }))
      assert.equal(selected.name, VIEW.event.name)
      // Mimic the picker before open/hover/focus: do not fetch other contracts.
      assert.deepEqual(seen, ['event_view'])
      const other = await ev.queryCache.fetch(ev.eventSummaryQuery(boot, 'terp1oth'))
      assert.equal(other.name, 'Other')
    },
  )
  assert.deepEqual(seen, ['event_view', 'event_info'])
})
