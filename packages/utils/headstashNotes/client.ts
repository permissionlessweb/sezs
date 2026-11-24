/**
 * Pure TS Headstash notes HTTP client for hash-market HeadstashStore.
 *
 * Routes (1:1 with server):
 *   GET  {base}/notes/{hs_id}              → list keys (sorted)
 *   PUT  {base}/notes/{hs_id}/{addr}       → store envelope
 *   GET  {base}/notes/{hs_id}/{addr}       → get envelope
 *   POST {base}/notes/{hs_id}/pir          → XOR PIR (selector one-hot)
 *
 * Auth: Authorization Bearer via notesAuthHeaders / bearerAuthHeaders.
 * Client never sends owner key; decrypt is local only.
 */

import { hexToBytes } from './hex'
import { buildOneHotSelector, stripTrailingNulPad } from './selector'
import {
  HeadstashNotesError,
  NoteEnvelope,
  NotesAuthHeaders,
  NotesClientOptions,
  NOTE_ID_MAX_LEN,
} from './types'

/** Validate hs_id / addr path segment: [a-zA-Z0-9_.-]{1,200}. */
export function validateNoteId(id: string): void {
  if (!id || id.length > NOTE_ID_MAX_LEN) {
    throw new HeadstashNotesError({ kind: 'invalid_id', id })
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new HeadstashNotesError({ kind: 'invalid_id', id })
  }
}

/** Normalize notes base URL (no trailing slash). */
export function normalizeNotesBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * Build Authorization Bearer header map.
 * Never log or commit the token.
 */
export function bearerAuthHeaders(token: string): NotesAuthHeaders {
  const t = token.trim()
  if (!t) {
    return {}
  }
  const value = t.toLowerCase().startsWith('bearer ') ? t : `Bearer ${t}`
  return { Authorization: value }
}

/**
 * Merge auth sources: explicit headers win; then bearer token.
 */
export function resolveAuthHeaders(opts: {
  authHeaders?: NotesAuthHeaders
  bearerToken?: string
}): NotesAuthHeaders {
  const fromBearer = opts.bearerToken
    ? bearerAuthHeaders(opts.bearerToken)
    : {}
  return { ...fromBearer, ...(opts.authHeaders ?? {}) }
}

function assertEnvelope(v: unknown): NoteEnvelope {
  if (!v || typeof v !== 'object') {
    throw new HeadstashNotesError({
      kind: 'invalid_envelope',
      reason: 'not an object',
    })
  }
  const o = v as Record<string, unknown>
  for (const k of [
    'ciphertext',
    'nonce',
    'scheme',
    'cleartext_layout',
    'cleartext_len',
  ] as const) {
    if (!(k in o)) {
      throw new HeadstashNotesError({
        kind: 'invalid_envelope',
        reason: `missing ${k}`,
      })
    }
  }
  if (typeof o.ciphertext !== 'string' || typeof o.nonce !== 'string') {
    throw new HeadstashNotesError({
      kind: 'invalid_envelope',
      reason: 'ciphertext/nonce must be strings',
    })
  }
  if (typeof o.scheme !== 'string' || typeof o.cleartext_layout !== 'string') {
    throw new HeadstashNotesError({
      kind: 'invalid_envelope',
      reason: 'scheme/layout must be strings',
    })
  }
  if (typeof o.cleartext_len !== 'number') {
    throw new HeadstashNotesError({
      kind: 'invalid_envelope',
      reason: 'cleartext_len must be number',
    })
  }
  const env: NoteEnvelope = {
    ciphertext: o.ciphertext,
    nonce: o.nonce,
    scheme: o.scheme,
    cleartext_layout: o.cleartext_layout,
    cleartext_len: o.cleartext_len,
  }
  if (typeof o.sha256 === 'string') {
    env.sha256 = o.sha256
  }
  return env
}

async function notesFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch (e) {
    throw new HeadstashNotesError({
      kind: 'network',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function readErrorBody(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 256)
  } catch {
    return ''
  }
}

function withAuth(
  headers: HeadersInit | undefined,
  auth?: NotesAuthHeaders
): Headers {
  const h = new Headers(headers)
  if (auth) {
    for (const [k, v] of Object.entries(auth)) {
      if (v) h.set(k, v)
    }
  }
  return h
}

export class HeadstashNotesClient {
  readonly notesBase: string
  readonly authHeaders: NotesAuthHeaders
  private readonly fetchImpl: typeof fetch

  constructor(opts: NotesClientOptions) {
    this.notesBase = normalizeNotesBase(opts.notesBase)
    this.authHeaders = opts.authHeaders ?? {}
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (() => {
            throw new HeadstashNotesError({
              kind: 'network',
              message: 'fetch not available',
            })
          }))
  }

  /** GET /notes/{hs_id} → sorted keys. */
  async listNoteKeys(hsId: string): Promise<string[]> {
    validateNoteId(hsId)
    const url = `${this.notesBase}/notes/${encodeURIComponent(hsId)}`
    const resp = await notesFetch(
      url,
      {
        method: 'GET',
        headers: withAuth(undefined, this.authHeaders),
      },
      this.fetchImpl
    )
    if (!resp.ok) {
      throw new HeadstashNotesError({
        kind: 'http',
        status: resp.status,
        body: await readErrorBody(resp),
      })
    }
    const json = (await resp.json()) as { keys?: unknown }
    if (!Array.isArray(json.keys)) {
      throw new HeadstashNotesError({
        kind: 'invalid_envelope',
        reason: 'list response missing keys array',
      })
    }
    return json.keys.filter((k): k is string => typeof k === 'string')
  }

  /** PUT /notes/{hs_id}/{addr} — store envelope JSON. */
  async putNoteEnvelope(
    hsId: string,
    addr: string,
    envelope: NoteEnvelope
  ): Promise<void> {
    validateNoteId(hsId)
    validateNoteId(addr)
    const url = `${this.notesBase}/notes/${encodeURIComponent(
      hsId
    )}/${encodeURIComponent(addr)}`
    const resp = await notesFetch(
      url,
      {
        method: 'PUT',
        headers: withAuth(
          { 'Content-Type': 'application/json' },
          this.authHeaders
        ),
        body: JSON.stringify(envelope),
      },
      this.fetchImpl
    )
    if (!resp.ok) {
      throw new HeadstashNotesError({
        kind: 'http',
        status: resp.status,
        body: await readErrorBody(resp),
      })
    }
  }

  /** GET /notes/{hs_id}/{addr} — direct recover (reveals addr to server). */
  async getNoteEnvelope(hsId: string, addr: string): Promise<NoteEnvelope> {
    validateNoteId(hsId)
    validateNoteId(addr)
    const url = `${this.notesBase}/notes/${encodeURIComponent(
      hsId
    )}/${encodeURIComponent(addr)}`
    const resp = await notesFetch(
      url,
      {
        method: 'GET',
        headers: withAuth(undefined, this.authHeaders),
      },
      this.fetchImpl
    )
    if (!resp.ok) {
      throw new HeadstashNotesError({
        kind: 'http',
        status: resp.status,
        body: await readErrorBody(resp),
      })
    }
    return assertEnvelope(await resp.json())
  }

  /**
   * POST /notes/{hs_id}/pir with one-hot selector → raw padded XOR blob bytes.
   */
  async pirFetchNoteBlob(
    hsId: string,
    selector: readonly number[]
  ): Promise<Uint8Array> {
    validateNoteId(hsId)
    const url = `${this.notesBase}/notes/${encodeURIComponent(hsId)}/pir`
    const resp = await notesFetch(
      url,
      {
        method: 'POST',
        headers: withAuth(
          { 'Content-Type': 'application/json' },
          this.authHeaders
        ),
        body: JSON.stringify({ selector: [...selector] }),
      },
      this.fetchImpl
    )
    if (!resp.ok) {
      throw new HeadstashNotesError({
        kind: 'http',
        status: resp.status,
        body: await readErrorBody(resp),
      })
    }
    const json = (await resp.json()) as { result?: unknown }
    if (typeof json.result === 'string') {
      try {
        return hexToBytes(json.result)
      } catch (e) {
        throw new HeadstashNotesError({
          kind: 'bad_hex',
          reason: e instanceof Error ? e.message : String(e),
        })
      }
    }
    if (Array.isArray(json.result)) {
      return Uint8Array.from(
        json.result.map((x) => {
          const n = Number(x)
          if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new HeadstashNotesError({
              kind: 'invalid_envelope',
              reason: 'pir result byte out of range',
            })
          }
          return n
        })
      )
    }
    throw new HeadstashNotesError({
      kind: 'invalid_envelope',
      reason: 'pir response missing result',
    })
  }

  /**
   * List keys → one-hot for addr → POST /pir → strip NUL pad → envelope JSON.
   * Prefer this over direct GET when multi-note / privacy desired.
   */
  async pirGetNoteEnvelope(
    hsId: string,
    addr: string
  ): Promise<NoteEnvelope> {
    validateNoteId(addr)
    const keys = await this.listNoteKeys(hsId)
    if (keys.length === 0) {
      throw new HeadstashNotesError({ kind: 'empty_list' })
    }
    let selector: number[]
    try {
      selector = buildOneHotSelector(keys, addr)
    } catch {
      throw new HeadstashNotesError({ kind: 'addr_not_found', addr })
    }
    const blob = await this.pirFetchNoteBlob(hsId, selector)
    const stripped = stripTrailingNulPad(blob)
    let parsed: unknown
    try {
      const text = new TextDecoder().decode(stripped)
      parsed = JSON.parse(text)
    } catch (e) {
      throw new HeadstashNotesError({
        kind: 'invalid_envelope',
        reason: e instanceof Error ? e.message : 'JSON parse after pad strip',
      })
    }
    return assertEnvelope(parsed)
  }
}

/** Factory helper. */
export function createHeadstashNotesClient(
  opts: NotesClientOptions
): HeadstashNotesClient {
  return new HeadstashNotesClient(opts)
}
