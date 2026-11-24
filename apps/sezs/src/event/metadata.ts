/** Resolve event metadata from the calendar contract.
 *
 * On-chain EventView is authoritative. Structured details may also live in
 * NIP-52 tags stored inline (string tags that are JSON arrays) or in an
 * external URI that points at a Nostr kind 31922/31923 event. A SHA-256
 * hash, when the contract stores one, is verified before URI tags are used.
 */
import {
  EventManifold,
  GalleryWork,
  LineupSlot,
  RafflePrize,
  ResolvedEvent,
  Sponsor,
  Stage,
  StageSet,
  VendorListing,
  ArtistListing,
} from './api'

export type MetadataFetch = (url: string) => Promise<{ ok: boolean; status: number; bytes: Uint8Array; text: string }>

export type ResolveOpts = {
  fetch?: MetadataFetch
  /** Override "now" only in tests. */
  origin?: string
}

export type Nip52Tag = string[]

const textOf = (b: Uint8Array) => {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b)
  return Buffer.from(b).toString('utf8')
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes.slice())
    return [...new Uint8Array(buf)].map((n) => n.toString(16).padStart(2, '0')).join('')
  }
  const { createHash } = await import('crypto')
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

const hexNorm = (s?: string) => String(s || '').trim().toLowerCase().replace(/^0x/, '')

/** Loopback, same-origin relative, or https with a content hash. Plain http to the public net is refused. */
export const metadataUriAllowed = (uri: string, opts?: { hasHash?: boolean; origin?: string }): { ok: boolean; reason: string } => {
  const raw = String(uri || '').trim()
  if (!raw) return { ok: false, reason: 'No metadata URI is set.' }
  try {
    const base = opts?.origin || 'http://127.0.0.1:3051'
    const u = new URL(raw, base)
    if (u.username || u.password) return { ok: false, reason: 'The metadata URI must not include credentials.' }
    const host = u.hostname.toLowerCase()
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
    if (u.protocol === 'http:' && loopback) return { ok: true, reason: '' }
    if (u.protocol === 'https:' && loopback) return { ok: true, reason: '' }
    if (u.protocol === 'https:' && opts?.hasHash) return { ok: true, reason: '' }
    if (u.protocol === 'https:') {
      return { ok: false, reason: 'A non-loopback metadata URI needs a content hash on the contract before it is fetched.' }
    }
    return { ok: false, reason: 'This metadata URI is not a loopback http(s) address, so it was not fetched.' }
  } catch {
    return { ok: false, reason: 'The metadata URI could not be parsed.' }
  }
}

const isLoopbackHost = (host: string) => {
  const h = host.toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'
}

const portOf = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80')

/**
 * Treat 127.0.0.1 and localhost as the same host when the page is also loopback.
 * Browsers treat them as different origins, so a contract URI of
 * http://127.0.0.1:3051/... fails with "Failed to fetch" when the app is
 * opened at http://localhost:3051 (required for WebAuthn passkeys).
 */
export const rewriteLoopbackMetadataUrl = (uri: string, origin?: string): string => {
  const raw = String(uri || '').trim()
  if (!raw) return raw
  const base =
    origin ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '')
  if (!base) return raw
  try {
    const u = new URL(raw, base)
    const here = new URL(base)
    if (!isLoopbackHost(u.hostname) || !isLoopbackHost(here.hostname)) return raw
    if (u.protocol !== here.protocol || portOf(u) !== portOf(here)) return raw
    u.hostname = here.hostname
    return u.toString()
  } catch {
    return raw
  }
}

const logMetadata = (msg: string, extra?: unknown) => {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  if (extra !== undefined) console.warn(msg, extra)
  else console.warn(msg)
}


/** Parse contract `tags` (hashtags and/or JSON-encoded NIP-52 tag arrays) plus a raw Nostr event. */
export const collectNip52Tags = (source: { tags?: unknown; content?: string; event?: unknown }): Nip52Tag[] => {
  const out: Nip52Tag[] = []
  const push = (t: unknown) => {
    if (!Array.isArray(t) || t.length < 1) return
    out.push(t.map((x) => String(x)))
  }
  const ev = (source.event && typeof source.event === 'object' ? source.event : source) as Record<string, unknown>
  if (Array.isArray(ev.tags)) {
    for (const t of ev.tags) {
      if (typeof t === 'string') {
        const s = t.trim()
        if (s.startsWith('[')) {
          try {
            push(JSON.parse(s))
          } catch {
            /* hashtag that happens to start with [ */
          }
        }
      } else {
        push(t)
      }
    }
  }
  const maybeJson = String(source.content || ev.content || '').trim()
  if (maybeJson.startsWith('{')) {
    try {
      const parsed = JSON.parse(maybeJson) as { tags?: unknown; kind?: number }
      if (parsed && Array.isArray(parsed.tags)) {
        for (const t of parsed.tags) push(t)
      }
    } catch {
      /* content is prose */
    }
  }
  return out
}

const tagValues = (tags: Nip52Tag[], name: string) => tags.filter((t) => t[0] === name)

const optStr = (v: unknown) => {
  const s = String(v || '').trim()
  return s ? s : undefined
}

const sponsorFromFields = (
  id: string,
  name: string,
  href?: string,
  logo?: string,
  tier?: string,
  note?: string,
  example?: boolean,
): Sponsor => ({
  id,
  handle: name,
  href: optStr(href),
  logo: optStr(logo),
  note: optStr(note),
  tier: optStr(tier),
  example: example || undefined,
})

/** NIP-52 `sponsor` tag: id, name, url?, logo?, tier?, note? */
const sponsorsFromTags = (tags: Nip52Tag[]): Sponsor[] =>
  tagValues(tags, 'sponsor').map((t, i) =>
    sponsorFromFields(
      t[1] || `sp-${i}`,
      t[2] || t[1] || `Sponsor ${String(i + 1).padStart(2, '0')}`,
      t[3],
      t[4],
      t[5],
      t[6],
    ),
  )

/** Top-level metadata `sponsors: [{ name, url, logo, tier, id?, note?, example? }]`. */
export const sponsorsFromDocument = (raw: unknown): Sponsor[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((s, i) => {
    const x = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
    const name = optStr(x.name) || optStr(x.handle) || `Sponsor ${String(i + 1).padStart(2, '0')}`
    return sponsorFromFields(
      optStr(x.id) || `sp-${i}`,
      name,
      (x.url as string) || (x.href as string),
      x.logo as string,
      x.tier as string,
      x.note as string,
      x.example === true,
    )
  })
}

const fillSponsor = (base: Sponsor | undefined, over: Sponsor): Sponsor => ({
  id: over.id || base?.id || '',
  handle: over.handle || base?.handle || over.id,
  note: over.note || base?.note,
  href: over.href || base?.href,
  logo: over.logo || base?.logo,
  tier: over.tier || base?.tier,
  example: over.example ?? base?.example,
})

/** Union two sponsor lists. `authoritative` wins on a shared id; missing fields fill from fallback. */
export const mergeSponsors = (authoritative: Sponsor[] = [], fallback: Sponsor[] = []): Sponsor[] => {
  const out = new Map<string, Sponsor>()
  for (const s of fallback) out.set(s.id, s)
  for (const s of authoritative) out.set(s.id, fillSponsor(out.get(s.id), s))
  return [...out.values()]
}


const asIso = (s: string) => {
  const t = String(s || '').trim()
  if (!t) return ''
  if (/^\d+$/.test(t)) {
    const n = Number(t)
    const ms = t.length >= 18 ? n / 1e6 : t.length >= 13 ? n : n * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? t : d.toISOString()
}

export type ParsedExtras = {
  stages: { id: string; name: string }[]
  sets: StageSet[]
  prizes: RafflePrize[]
  vendors: VendorListing[]
  gallery: GalleryWork[]
  artists: ArtistListing[]
  sponsors: Sponsor[]
  doorCents?: number
  title?: string
  summary?: string
  location?: string
  image?: string
  start?: string
  end?: string
}

export const extrasFromTags = (tags: Nip52Tag[]): ParsedExtras => {
  const stages = tagValues(tags, 'stage').map((t, i) => ({
    id: t[1] || `stage-${i}`,
    name: t[2] || t[1] || `Stage ${i + 1}`,
  }))
  const sets: StageSet[] = tagValues(tags, 'set').map((t, i) => {
    const stageId = t[1] || ''
    const start = asIso(t[3] || '')
    const end = asIso(t[4] || '')
    return {
      id: t[6] || `set-${stageId}-${i}`,
      stageId,
      stage: stages.find((s) => s.id === stageId)?.name || stageId,
      artist: t[2] || `Set ${i + 1}`,
      start,
      end: end || undefined,
      role: t[5] || undefined,
    }
  })
  const prizes: RafflePrize[] = tagValues(tags, 'prize').map((t, i) => ({
    id: t[1] || `rf-${i}`,
    title: t[2] || `Prize ${String(i + 1).padStart(2, '0')}`,
    note: t[3] || undefined,
    entries: Number(t[4] || 0) || 0,
    status: ((t[5] as RafflePrize['status']) || 'open') as RafflePrize['status'],
  }))
  const vendors: VendorListing[] = tagValues(tags, 'vendor').map((t, i) => ({
    id: t[1] || `vendor-${i}`,
    name: t[2] || `Vendor ${String(i + 1).padStart(2, '0')}`,
    services: t[3] || undefined,
    href: t[4] || undefined,
    handle: t[2] || undefined,
    address: t[5] || undefined,
  }))
  const gallery: GalleryWork[] = tagValues(tags, 'gallery').map((t, i) => {
    const artist = t[3] || 'Artist'
    return {
      id: t[1] || `gw-${i}`,
      artistId: t[6] || `artist-${artist.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      artist,
      title: t[2] || `Work ${i + 1}`,
      priceZec: Number(t[4] || 0) || 0,
      img: t[5] || undefined,
      about: t[7] || undefined,
    }
  })
  const artists: ArtistListing[] = tagValues(tags, 'artist').map((t, i) => ({
    id: t[1] || `artist-${i}`,
    name: t[2] || `Artist ${String(i + 1).padStart(2, '0')}`,
    address: t[3] || undefined,
    about: t[4] || undefined,
  }))
  const door = tagValues(tags, 'door-price')[0]
  const title = tagValues(tags, 'title')[0]?.[1]
  const summary = tagValues(tags, 'summary')[0]?.[1]
  const location = tagValues(tags, 'location')[0]?.[1]
  const image = tagValues(tags, 'image')[0]?.[1]
  const start = tagValues(tags, 'start')[0]?.[1]
  const end = tagValues(tags, 'end')[0]?.[1]
  return {
    stages,
    sets,
    prizes,
    vendors,
    gallery,
    artists,
    sponsors: sponsorsFromTags(tags),
    doorCents: door && door[1] ? Number(door[1]) || undefined : undefined,
    title,
    summary,
    location,
    image,
    start: start ? asIso(start) : undefined,
    end: end ? asIso(end) : undefined,
  }
}

const endOfSlot = (slot: LineupSlot) => {
  const t = Date.parse(slot.start)
  if (!Number.isFinite(t)) return undefined
  return new Date(t + slot.durationMin * 60_000).toISOString()
}

/** Festival-style stages and set times, from NIP-52 tags plus on-chain lineup/timeline. */
export const deriveStages = (data: EventManifold, extras?: ParsedExtras): Stage[] => {
  const named = new Map<string, string>()
  for (const s of extras?.stages || []) named.set(s.id, s.name)
  const skip = new Set(['door', 'back'])
  const laneName = (lane: string) => named.get(lane) || lane
  for (const s of data.lineup) {
    if (s.lane && !skip.has(s.lane)) named.set(s.lane, laneName(s.lane))
  }
  for (const s of extras?.sets || []) {
    if (s.stageId) named.set(s.stageId, s.stage || s.stageId)
  }
  const setsBy: Record<string, StageSet[]> = {}
  const add = (set: StageSet) => {
    const id = set.stageId || 'main'
    if (skip.has(id)) return
    named.set(id, set.stage || named.get(id) || id)
    if (!setsBy[id]) setsBy[id] = []
    const exists = setsBy[id].some((x) => x.id === set.id || (x.artist === set.artist && x.start === set.start))
    if (!exists) setsBy[id].push(set)
  }
  for (const s of extras?.sets || []) add(s)
  for (const s of data.lineup) {
    if (s.role === 'vendor') continue
    if (!s.lane || skip.has(s.lane)) continue
    add({
      id: s.id,
      stageId: s.lane,
      stage: laneName(s.lane),
      artist: s.handle,
      start: s.start,
      end: endOfSlot(s),
      role: s.role,
    })
  }
  const stages: Stage[] = [...named.entries()]
    .filter(([id]) => !skip.has(id))
    .map(([id, name]) => ({
      id,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      sets: (setsBy[id] || []).slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    }))
    .filter((s) => s.sets.length || extras?.stages.some((x) => x.id === s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  return stages
}

const vendorsFromChain = (data: EventManifold, extras?: ParsedExtras): VendorListing[] => {
  const out = new Map<string, VendorListing>()
  for (const v of extras?.vendors || []) out.set(v.id, v)
  for (const s of data.lineup.filter((x) => x.role === 'vendor')) {
    const id = s.id
    const prev = out.get(id)
    out.set(id, {
      id,
      name: prev?.name || s.handle,
      handle: s.handle,
      services: prev?.services,
      href: prev?.href || s.ref,
    })
  }
  return [...out.values()]
}

const artistsFrom = (data: EventManifold, extras?: ParsedExtras, works?: GalleryWork[]): ArtistListing[] => {
  const out = new Map<string, ArtistListing>()
  for (const a of extras?.artists || []) out.set(a.id, a)
  for (const s of data.lineup.filter((x) => x.role === 'dj' || x.role === 'vj' || x.role === 'other')) {
    const id = s.id
    if (!out.has(id) && !out.has(s.handle)) {
      out.set(id, { id, name: s.handle, about: undefined, address: s.ref })
    }
  }
  for (const w of works || []) {
    if (![...out.values()].some((a) => a.id === w.artistId || a.name === w.artist)) {
      out.set(w.artistId, { id: w.artistId, name: w.artist })
    }
  }
  return [...out.values()]
}

const mergePrizes = (data: EventManifold, extras?: ParsedExtras): RafflePrize[] => {
  const out = new Map<string, RafflePrize>()
  for (const p of extras?.prizes || []) out.set(p.id, p)
  for (const p of data.raffles) out.set(p.id, p) // chain wins
  return [...out.values()]
}

const defaultFetch: MetadataFetch = async (url) => {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  const buf = new Uint8Array(await r.arrayBuffer())
  return { ok: r.ok, status: r.status, bytes: buf, text: textOf(buf) }
}

const emptyResolved = (data: EventManifold, mode: ResolvedEvent['metadataMode'], note: string, extras?: ParsedExtras): ResolvedEvent => {
  const gallery = extras?.gallery || []
  return {
    ...data,
    raffles: mergePrizes(data, extras),
    sponsors: mergeSponsors(data.sponsors, extras?.sponsors),
    stages: deriveStages(data, extras),
    vendors: vendorsFromChain(data, extras),
    gallery,
    artists: artistsFrom(data, extras, gallery),
    doorCents: extras?.doorCents ?? data.tiers[0]?.listCents,
    metadataMode: mode,
    metadataNote: note,
  }
}

export async function resolveEventMetadata(data: EventManifold, opts: ResolveOpts = {}): Promise<ResolvedEvent> {
  const inlineTags = collectNip52Tags({ tags: data.event.tags, content: data.event.content })
  const inlineExtras = extrasFromTags(inlineTags)
  const uri = String(data.event.metadataUri || '').trim()
  const hash = hexNorm(data.event.metadataHash)
  if (!uri) {
    return emptyResolved(data, 'inline', '', inlineExtras)
  }
  const allow = metadataUriAllowed(uri, { hasHash: hash.length === 64, origin: opts.origin })
  if (!allow.ok) {
    logMetadata(allow.reason, uri)
    return emptyResolved(data, 'inline', allow.reason, inlineExtras)
  }
  const fetcher = opts.fetch || defaultFetch
  const fetchUrl = rewriteLoopbackMetadataUrl(uri, opts.origin)
  let got: { ok: boolean; status: number; bytes: Uint8Array; text: string }
  try {
    got = await fetcher(fetchUrl)
  } catch (e) {
    const note = `The metadata URI could not be read (${e instanceof Error ? e.message : 'error'}).`
    logMetadata(note, fetchUrl)
    return emptyResolved(data, 'inline', note, inlineExtras)
  }
  if (!got.ok) {
    const note = `The metadata URI returned HTTP ${got.status}.`
    logMetadata(note, fetchUrl)
    return emptyResolved(data, 'inline', note, inlineExtras)
  }
  if (hash.length === 64) {
    const gotHash = await sha256Hex(got.bytes)
    if (gotHash !== hash) {
      const note = 'The metadata URI did not match the content hash stored on the contract, so it was ignored.'
      logMetadata(note, fetchUrl)
      return emptyResolved(data, 'inline', note, inlineExtras)
    }
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(got.text) as Record<string, unknown>
  } catch {
    const note = 'The metadata URI was not valid JSON, so it was ignored.'
    logMetadata(note, fetchUrl)
    return emptyResolved(data, 'inline', note, inlineExtras)
  }
  const uriTags = collectNip52Tags(body)
  const uriExtras = extrasFromTags([...inlineTags, ...uriTags])
  uriExtras.sponsors = mergeSponsors(sponsorsFromDocument(body.sponsors), uriExtras.sponsors)
  const mode: ResolvedEvent['metadataMode'] = hash.length === 64 ? 'uri' : 'uri-unverified'
  const note =
    mode === 'uri'
      ? ''
      : 'The contract does not store a content hash for this metadata URI, so the bytes were not integrity-checked.'
  if (note) logMetadata(note, fetchUrl)
  return emptyResolved(data, mode, note, uriExtras)
}

