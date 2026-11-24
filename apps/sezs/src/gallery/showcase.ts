/**
 * Artist showcase schema. Spec: GALLERY-ESCROW-SPEC-2026-10-12 §1–§2.
 *
 * Drafts stay on the page. Nothing is posted, signed, or listed until a
 * real registry and escrow exist. No viewing keys. No invented prices.
 */
import type { Adapter, ChainId, Kind } from './CollectionsPrep'

export type LoginMethod = 'passkey' | 'zid' | 'adr036' | 'eip191' | 'eip712'

export const LOGIN_METHODS: LoginMethod[] = [
  'passkey',
  'zid',
  'adr036',
  'eip191',
  'eip712',
]

export type SocialKind = 'site' | 'nostr' | 'x' | 'instagram' | 'farcaster'

export type ShowcaseSocial = { kind: SocialKind; href: string }

export type ShowcaseAsset = {
  kind: 'image' | 'video' | 'audio'
  href: string
  alt?: string
}

export type ShowcaseCollection = {
  chain: ChainId
  addr: string
  kind: Kind
  adapter: Adapter
}

export type ShowcaseWork = {
  id: string
  title: string
  priceZec: number
  listed: boolean
  img?: string
  alt?: string
  about?: string
}

/** Payout addresses stay off-chain with the profile (spec §1.3). Optional until escrow exists. */
export type ShowcasePayout = {
  zec?: string
  terp?: string
  evm?: string
}

/** Artist-picked charity is stored as an allowlist id. Picker UI waits on live ZEC. */
export type ArtistShowcase = {
  artistId: string
  displayName: string
  synopsis: string
  socials: ShowcaseSocial[]
  assets: ShowcaseAsset[]
  collections: ShowcaseCollection[]
  works: ShowcaseWork[]
  artistCharityId: string
  loginMethod?: LoginMethod
  inviteId?: string
  payout: ShowcasePayout
}

export const emptyShowcase = (): ArtistShowcase => ({
  artistId: '',
  displayName: '',
  synopsis: '',
  socials: [],
  assets: [],
  collections: [],
  works: [],
  artistCharityId: '',
  payout: {},
})

/** Curated later. Empty ⇒ no picker, no fake charities. */
export const CHARITY_ALLOWLIST: { id: string; label: string }[] = []

export const SOCIAL_KINDS: SocialKind[] = ['site', 'nostr', 'x', 'instagram', 'farcaster']

export const SYNOPSIS_MAX = 500
export const NAME_MAX = 80
export const HREF_MAX = 2048
export const ABOUT_MAX = 500

const TERP_CONTRACT = /^terp1[02-9ac-hj-np-z]{58}$/
const TERP_ADDR = /^terp1[02-9ac-hj-np-z]{38,58}$/
const EVM = /^0x[0-9a-fA-F]{40}$/
const ZEC_UA = /^u(test|regtest)?1[a-z0-9]{20,}$/i
const ASSET_PATH = /^\/sezs-assets\/[A-Za-z0-9._/-]+$/
const ARTIST_ID = /^[a-z0-9-]{1,64}$/
const INVITE_ID = /^[A-Za-z0-9_-]{8,128}$/

export type FieldError = { path: string; message: string }

const bad = (path: string, message: string): FieldError => ({ path, message })

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function isHttpsUrl(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > HREF_MAX) return false
  if (/[\s<>]/.test(raw)) return false
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    if (u.username || u.password) return false
    if (!u.hostname) return false
    return true
  } catch {
    return false
  }
}

export function isAssetHref(raw: string): boolean {
  if (ASSET_PATH.test(raw) && !/javascript:|data:/i.test(raw)) return true
  return isHttpsUrl(raw)
}

export function validateShowcase(s: ArtistShowcase): FieldError[] {
  const err: FieldError[] = []
  const name = (s.displayName || '').trim()
  if (name.length < 1 || name.length > NAME_MAX) {
    err.push(bad('displayName', 'Name is 1–80 characters.'))
  }
  if ((s.synopsis || '').length > SYNOPSIS_MAX) {
    err.push(bad('synopsis', 'Synopsis is at most 500 characters.'))
  }
  if (s.artistId && !ARTIST_ID.test(s.artistId)) {
    err.push(bad('artistId', 'Artist id is lowercase letters, numbers, hyphens.'))
  }
  if (s.inviteId && !INVITE_ID.test(s.inviteId)) {
    err.push(bad('inviteId', 'Invite id is 8–128 letters, numbers, _ or -.'))
  }
  if (s.loginMethod && !LOGIN_METHODS.includes(s.loginMethod)) {
    err.push(bad('loginMethod', 'Login is passkey, zid, adr036, eip191, or eip712.'))
  }
  if (s.artistCharityId) {
    if (!CHARITY_ALLOWLIST.some((c) => c.id === s.artistCharityId)) {
      err.push(bad('artistCharityId', 'Charity picker opens when shielded ZEC is live.'))
    }
  }
  const pay = s.payout || {}
  if (pay.zec && !ZEC_UA.test(pay.zec)) {
    err.push(bad('payout.zec', 'ZEC payout is a unified address, or leave blank.'))
  }
  if (pay.terp && !TERP_ADDR.test(pay.terp)) {
    err.push(bad('payout.terp', 'Terp payout is a terp1 address, or leave blank.'))
  }
  if (pay.evm && !EVM.test(pay.evm)) {
    err.push(bad('payout.evm', 'EVM payout is 0x plus 40 hex, or leave blank.'))
  }
  ;(s.socials || []).forEach((row, i) => {
    if (!SOCIAL_KINDS.includes(row.kind)) err.push(bad(`socials.${i}.kind`, 'Unknown social.'))
    if (!isHttpsUrl(row.href)) {
      err.push(bad(`socials.${i}.href`, 'Social links are https only.'))
    }
  })
  ;(s.assets || []).forEach((row, i) => {
    if (!['image', 'video', 'audio'].includes(row.kind)) {
      err.push(bad(`assets.${i}.kind`, 'Asset is image, video, or audio.'))
    }
    if (!isAssetHref(row.href)) {
      err.push(bad(`assets.${i}.href`, 'Assets are https or /sezs-assets/…'))
    }
    if ((row.alt || '').length > 120) {
      err.push(bad(`assets.${i}.alt`, 'Alt text is at most 120 characters.'))
    }
  })
  ;(s.collections || []).forEach((row, i) => {
    const ok =
      row.chain === 'terp' ? TERP_CONTRACT.test(row.addr) : EVM.test(row.addr)
    if (!ok) {
      err.push(
        bad(
          `collections.${i}.addr`,
          row.chain === 'terp'
            ? 'Terp contract is terp1 plus 58 bech32 characters.'
            : 'EVM address is 0x plus 40 hex characters.'
        )
      )
    }
  })
  ;(s.works || []).forEach((row, i) => {
    if (!row.title.trim()) err.push(bad(`works.${i}.title`, 'Each work needs a title.'))
    if (row.title.length > 120) err.push(bad(`works.${i}.title`, 'Title is at most 120 characters.'))
    if ((row.about || '').length > ABOUT_MAX) {
      err.push(bad(`works.${i}.about`, 'About is at most 500 characters.'))
    }
    if (!(row.priceZec > 0) || !Number.isFinite(row.priceZec)) {
      err.push(bad(`works.${i}.priceZec`, 'Price is a positive ZEC amount the artist set.'))
    }
    if (row.listed) {
      err.push(bad(`works.${i}.listed`, 'Listing waits on a live escrow. Kept as a draft.'))
    }
  })
  return err
}

export function listedWorks(showcases: ArtistShowcase[]): ShowcaseWork[] {
  return showcases.flatMap((s) =>
    s.works.filter((w) => w.listed && validateShowcase(s).length === 0)
  )
}

/**
 * Escaped HTML for synopsis + socials. Only https hrefs are emitted.
 * Never use unescaped synopsis in innerHTML.
 */
export function renderShowcaseHtml(s: ArtistShowcase): string {
  const socials = (s.socials || [])
    .filter((row) => isHttpsUrl(row.href))
    .map(
      (row) =>
        `<a href="${escapeHtml(row.href)}">${escapeHtml(row.kind)}</a>`
    )
    .join(' ')
  return `<article><h2>${escapeHtml(s.displayName)}</h2><p>${escapeHtml(
    s.synopsis
  )}</p>${socials}</article>`
}

/** Invite lives in the URL fragment so nginx never sees it. */
export type InviteFrag = {
  v: string
  i: string
  B: string
  o: string
  x: string
  s: string
}

export function parseInviteFragment(hash: string): InviteFrag | { error: string } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { error: 'No invite in this link.' }
  const q = new URLSearchParams(raw)
  const v = q.get('v') || ''
  const i = q.get('i') || ''
  const B = q.get('B') || ''
  const o = q.get('o') || ''
  const x = q.get('x') || ''
  const s = q.get('s') || ''
  if (v !== '1' || !i || !B || !s) return { error: 'Invite is incomplete.' }
  const exp = Number(x)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return { error: 'Invite has expired.' }
  return { v, i, B, o, x, s }
}
