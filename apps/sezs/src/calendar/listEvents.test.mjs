import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { eventsFromListBody, fetchContractEvents, lcdAllowed, smartQueryUrl } = await import(
  './listEvents.ts'
)
const MARK = 'r2-chain-marker-not-static'

test('parser returns the contract title, not a baked night list', () => {
  const rows = eventsFromListBody({
    data: {
      events: [{ title: MARK, start: '20:00' }],
    },
  })
  assert.deepEqual(rows, [{ title: MARK, start: '20:00' }])
  assert.ok(!rows.some((r) => /doors|lineup|late/i.test(r.title)))
})

test('static file content is not accepted as the contract list', () => {
  const baked = eventsFromListBody({ events: [{ what: 'Doors', time: '19:00' }] })
  assert.equal(baked.length, 0)
})

test('live loopback list_events is the only source', async () => {
  const server = createServer((req, res) => {
    if (!req.url?.includes('list_events') && !req.url?.includes('/smart/')) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: { events: [{ title: MARK, start: '21:00' }] } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  try {
    const rows = await fetchContractEvents(
      `http://127.0.0.1:${port}`,
      'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6p2x0'
    )
    assert.equal(rows[0]?.title, MARK)
    assert.notEqual(rows[0]?.title, 'Doors')
  } finally {
    server.close()
  }
})

test('lineup page asks the contract and does not feed the posted night into it', () => {
  const page = readFileSync(join(here, '../../pages/lineup.tsx'), 'utf8')
  const calendar = readFileSync(join(here, '../../pages/calendar.tsx'), 'utf8')
  const chain = readFileSync(join(here, 'ChainList.tsx'), 'utf8')
  const lib = readFileSync(join(here, 'listEvents.ts'), 'utf8')
  assert.match(page, /ChainList/)
  assert.match(calendar, /Redirect/)
  assert.match(lib, /list_events/)
  assert.doesNotMatch(chain, /NIGHT/)
  assert.doesNotMatch(lib, /content\/event/)
})

const CONTRACT = 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6p2x0'

test('lcd allowlist is loopback or https testnet, with no userinfo', () => {
  assert.equal(lcdAllowed('http://127.0.0.1:1317'), true)
  assert.equal(lcdAllowed('http://localhost:1317'), true)
  assert.equal(lcdAllowed('https://testnet-api.terp.network'), true)
  assert.equal(lcdAllowed('https://api.terp.network'), true)
  assert.equal(lcdAllowed('http://api.terp.network'), false)
  assert.equal(lcdAllowed('http://testnet-api.terp.network'), false)
  assert.equal(lcdAllowed('https://evil.example'), false)
  assert.equal(lcdAllowed('http://user:pass@127.0.0.1:1317'), false)
  assert.equal(lcdAllowed('javascript:alert(1)'), false)
  assert.equal(smartQueryUrl('http://127.0.0.1:1317', '../x', { list_events: {} }), null)
  const built = smartQueryUrl('http://127.0.0.1:1317/lcd?x=1#h', CONTRACT, {
    list_events: { limit: 1 },
  })
  assert.ok(built)
  const parsed = new URL(built)
  assert.equal(parsed.search, '')
  assert.equal(parsed.hash, '')
  assert.equal(parsed.username, '')
  assert.match(parsed.pathname, /^\/lcd\/cosmwasm\/wasm\/v1\/contract\/terp1/)
})

test('a redirect is not a contract list', async () => {
  let hits = 0
  let port = 0
  const server = createServer((_req, res) => {
    hits += 1
    res.writeHead(302, { location: `http://127.0.0.1:${port}/followed` })
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
  try {
    const rows = await fetchContractEvents(`http://127.0.0.1:${port}`, CONTRACT)
    assert.deepEqual(rows, [])
    assert.equal(hits, 1)
  } finally {
    server.close()
  }
})
