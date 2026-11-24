import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../..')
const bundle = join(tmpdir(), 'sezs-metadata-test.mjs')
const esbuild = join(app, '../../node_modules/.pnpm/esbuild@0.25.2/node_modules/esbuild/bin/esbuild')
execFileSync(esbuild, [join(here, 'metadata.ts'), '--bundle', '--platform=node', '--format=esm', '--outfile=' + bundle], { stdio: 'pipe' })
const { extrasFromTags, collectNip52Tags, metadataUriAllowed, resolveEventMetadata, deriveStages, rewriteLoopbackMetadataUrl, mergeSponsors, sponsorsFromDocument } = await import(bundle)


const sha = (s) => createHash('sha256').update(s).digest('hex')

const baseEvent = {
  api: 2,
  schema: 'sezs-event-v2',
  event: {
    api: 2,
    name: 'Speakez Sessions',
    status: 'announced',
    start: '2027-01-16T01:00:00.000Z',
    end: '2027-01-16T08:00:00.000Z',
    timezone: 'America/New_York',
    kind: 31923,
    dTag: 'speakez-sessions',
    summary: 'Music until late.',
    tags: ['music', 'night'],
  },
  venue: { api: 2, revealed: false, note: 'Location is shared with ticket holders.' },
  lineup: [
    { id: 's1', index: 1, role: 'dj', handle: 'Mira', start: '2027-01-16T02:00:00.000Z', durationMin: 60, lane: 'cellar' },
    { id: 's2', index: 2, role: 'dj', handle: 'North Room', start: '2027-01-16T02:00:00.000Z', durationMin: 60, lane: 'floor' },
    { id: 'v1', index: 3, role: 'vendor', handle: 'Night Kitchen', start: '2027-01-16T01:00:00.000Z', durationMin: 400, lane: 'alcove' },
  ],
  timeline: [],
  sponsors: [],
  tiers: [{ id: 'ga', label: 'Admission', listCents: 4000, discountsBps: { zec: 5000, penumbra: 5000 }, supply: 200, sold: 0, rails: ['zec', 'penumbra'] }],
  raffles: [{ id: 'rf-01', title: 'A print from the floor wall', note: 'One paid ticket is one entry.', entries: 0, status: 'open' }],
  faq: [],
  roles: { curators: [], coordinators: [], ushers: [] },
}

const nostr = {
  kind: 31923,
  tags: [
    ['d', 'speakez-sessions'],
    ['title', 'Speakez Sessions'],
    ['door-price', '4000'],
    ['stage', 'cellar', 'Cellar'],
    ['stage', 'floor', 'Floor'],
    ['set', 'cellar', 'Mira', '2027-01-16T02:00:00.000Z', '2027-01-16T03:00:00.000Z', 'dj'],
    ['prize', 'rf-02', 'A reserved late-room seat', 'Same entry pool.'],
    ['vendor', 'v-print', 'Print Cart', 'Letterpress and small editions at the alcove.'],
    ['gallery', 'gw-01', 'Ink study I', 'Floor artist', '0.08', '', 'artist-floor', 'Brush work from the floor wall, priced in ZEC.'],
    ['artist', 'artist-floor', 'Floor artist'],
  ],
  content: 'Music until late.',
}

const encode = (obj) => {
  const text = JSON.stringify(obj)
  return { text, bytes: new Uint8Array(Buffer.from(text)) }
}

test('inline NIP-52 JSON tags plus on-chain lineup derive two stages and door price', async () => {
  const ev = {
    ...baseEvent,
    event: {
      ...baseEvent.event,
      tags: ['music', JSON.stringify(['stage', 'yard', 'Yard']), JSON.stringify(['door-price', '4500'])],
    },
  }
  const resolved = await resolveEventMetadata(ev)
  assert.equal(resolved.metadataMode, 'inline')
  assert.equal(resolved.doorCents, 4500)
  assert.ok(resolved.stages.some((s) => s.id === 'cellar'))
  assert.ok(resolved.stages.some((s) => s.id === 'floor'))
  assert.ok(resolved.stages.some((s) => s.id === 'yard'))
  assert.ok(resolved.vendors.some((v) => v.name === 'Night Kitchen'))
  assert.equal(resolved.raffles[0].title, 'A print from the floor wall')
})

test('URI metadata with a matching hash adds gallery works, vendors, and prizes', async () => {
  const { text, bytes } = encode(nostr)
  const ev = {
    ...baseEvent,
    event: { ...baseEvent.event, metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json', metadataHash: sha(text) },
    raffles: [],
  }
  const resolved = await resolveEventMetadata(ev, {
    fetch: async () => ({ ok: true, status: 200, bytes, text }),
  })
  assert.equal(resolved.metadataMode, 'uri')
  assert.equal(resolved.metadataNote, '')
  assert.equal(resolved.gallery.length, 1)
  assert.equal(resolved.gallery[0].title, 'Ink study I')
  assert.ok(resolved.vendors.some((v) => v.name === 'Print Cart'))
  assert.ok(resolved.raffles.some((p) => p.id === 'rf-02'))
  assert.equal(resolved.doorCents, 4000)
})

test('a bad content hash ignores the URI and keeps on-chain fields', async () => {
  const { text, bytes } = encode(nostr)
  const ev = {
    ...baseEvent,
    event: {
      ...baseEvent.event,
      metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json',
      metadataHash: 'aa'.repeat(32),
    },
  }
  const resolved = await resolveEventMetadata(ev, {
    fetch: async () => ({ ok: true, status: 200, bytes, text }),
  })
  assert.equal(resolved.metadataMode, 'inline')
  assert.match(resolved.metadataNote, /did not match the content hash/)
  assert.equal(resolved.gallery.length, 0)
  assert.equal(resolved.raffles[0].title, 'A print from the floor wall')
})

test('missing fields stay empty instead of inventing copy', async () => {
  const ev = {
    ...baseEvent,
    lineup: [],
    raffles: [],
    tiers: [],
    event: { ...baseEvent.event, tags: [] },
  }
  const resolved = await resolveEventMetadata(ev)
  assert.equal(resolved.stages.length, 0)
  assert.equal(resolved.gallery.length, 0)
  assert.equal(resolved.raffles.length, 0)
  assert.equal(resolved.vendors.length, 0)
  assert.equal(resolved.doorCents, undefined)
})

test('URI without a hash is used only from loopback and marked unverified', async () => {
  const { text, bytes } = encode(nostr)
  const ev = {
    ...baseEvent,
    event: { ...baseEvent.event, metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json' },
    raffles: [],
  }
  const resolved = await resolveEventMetadata(ev, {
    fetch: async () => ({ ok: true, status: 200, bytes, text }),
  })
  assert.equal(resolved.metadataMode, 'uri-unverified')
  assert.match(resolved.metadataNote, /not integrity-checked/)
  assert.ok(resolved.gallery.length)
})

test('a non-loopback http URI is refused', () => {
  const r = metadataUriAllowed('http://example.com/meta.json', { hasHash: true })
  assert.equal(r.ok, false)
})

test('https URI without a hash is refused; with a hash it is allowed', () => {
  assert.equal(metadataUriAllowed('https://example.com/meta.json', { hasHash: false }).ok, false)
  assert.equal(metadataUriAllowed('https://example.com/meta.json', { hasHash: true }).ok, true)
})

test('collectNip52Tags reads JSON-encoded contract tags and a raw Nostr body', () => {
  const tags = collectNip52Tags({
    tags: ['music', JSON.stringify(['vendor', 'v1', 'Night Kitchen', 'Late plates'])],
    content: JSON.stringify(nostr),
  })
  assert.ok(tags.some((t) => t[0] === 'vendor' && t[2] === 'Night Kitchen'))
  assert.ok(tags.some((t) => t[0] === 'gallery'))
})

test('deriveStages groups lineup by lane and skips the door lane', () => {
  const stages = deriveStages(baseEvent)
  assert.deepEqual(stages.map((s) => s.id).sort(), ['cellar', 'floor'])
  assert.equal(stages.find((s) => s.id === 'cellar').sets[0].artist, 'Mira')
})

test('loopback metadata URIs rewrite 127.0.0.1 to the page origin host', () => {
  const uri = 'http://127.0.0.1:3051/lantern-night-nip52.json'
  assert.equal(
    rewriteLoopbackMetadataUrl(uri, 'http://localhost:3051'),
    'http://localhost:3051/lantern-night-nip52.json',
  )
  assert.equal(rewriteLoopbackMetadataUrl(uri, 'http://127.0.0.1:3051'), uri)
  assert.equal(rewriteLoopbackMetadataUrl(uri, 'http://localhost:4000'), uri)
  assert.equal(rewriteLoopbackMetadataUrl('https://cdn.example/meta.json', 'http://localhost:3051'), 'https://cdn.example/meta.json')
})

test('URI fetch uses the rewritten loopback URL', async () => {
  const { text, bytes } = encode(nostr)
  const ev = {
    ...baseEvent,
    event: { ...baseEvent.event, metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json', metadataHash: sha(text) },
  }
  let seen = ''
  await resolveEventMetadata(ev, {
    origin: 'http://localhost:3051',
    fetch: async (url) => {
      seen = url
      return { ok: true, status: 200, bytes, text }
    },
  })
  assert.equal(seen, 'http://localhost:3051/event-metadata.nip52.json')
})

test('a thrown metadata fetch keeps on-chain fields and records the failure', async () => {
  const ev = {
    ...baseEvent,
    event: { ...baseEvent.event, metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json', metadataHash: 'ab'.repeat(32) },
  }
  const warnings = []
  const prev = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    const resolved = await resolveEventMetadata(ev, {
      fetch: async () => { throw new Error('Failed to fetch') },
    })
    assert.equal(resolved.metadataMode, 'inline')
    assert.match(resolved.metadataNote, /Failed to fetch/)
    assert.equal(resolved.raffles[0].title, 'A print from the floor wall')
    assert.ok(warnings.some((w) => /Failed to fetch/.test(w)))
  } finally {
    console.warn = prev
  }
})

test('sponsors come from NIP-52 tags and a top-level metadata array', async () => {
  const body = {
    ...nostr,
    tags: [...nostr.tags, ['sponsor', 'sp-tag', 'Tag Press', '', '', 'community', 'A printed programme.']],
    sponsors: [
      { id: 'sp-doc', name: 'Harbor Type', url: 'https://example.com', logo: '/sezs-assets/favicon.svg', tier: 'presenting', example: true, note: 'An invented listing for local events.' },
    ],
  }
  const { text, bytes } = encode(body)
  const ev = {
    ...baseEvent,
    sponsors: [{ id: 'sp-chain', handle: 'On-chain Press', note: 'From the contract.' }],
    event: { ...baseEvent.event, metadataUri: 'http://127.0.0.1:3051/event-metadata.nip52.json', metadataHash: sha(text) },
  }
  const resolved = await resolveEventMetadata(ev, {
    fetch: async () => ({ ok: true, status: 200, bytes, text }),
  })
  assert.ok(resolved.sponsors.some((s) => s.id === 'sp-chain' && s.handle === 'On-chain Press'))
  const doc = resolved.sponsors.find((s) => s.id === 'sp-doc')
  assert.equal(doc.handle, 'Harbor Type')
  assert.equal(doc.href, 'https://example.com')
  assert.equal(doc.tier, 'presenting')
  assert.equal(doc.logo, '/sezs-assets/favicon.svg')
  assert.equal(doc.example, true)
  const tagged = resolved.sponsors.find((s) => s.id === 'sp-tag')
  assert.equal(tagged.handle, 'Tag Press')
  assert.equal(tagged.tier, 'community')
})

test('mergeSponsors lets the contract win on a shared id and keeps logo from metadata', () => {
  const merged = mergeSponsors(
    [{ id: 'sp-1', handle: 'Contract Name', href: '/from-chain' }],
    [{ id: 'sp-1', handle: 'Meta Name', logo: '/logo.svg', tier: 'presenting', href: '/from-meta' }],
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].handle, 'Contract Name')
  assert.equal(merged[0].href, '/from-chain')
  assert.equal(merged[0].logo, '/logo.svg')
  assert.equal(merged[0].tier, 'presenting')
})

test('sponsorsFromDocument reads name, url, logo, and tier', () => {
  const list = sponsorsFromDocument([{ name: 'Harbor Type', url: 'https://example.com', logo: '/l.svg', tier: 'presenting', example: true }])
  assert.equal(list[0].handle, 'Harbor Type')
  assert.equal(list[0].href, 'https://example.com')
  assert.equal(list[0].logo, '/l.svg')
  assert.equal(list[0].tier, 'presenting')
  assert.equal(list[0].example, true)
})
