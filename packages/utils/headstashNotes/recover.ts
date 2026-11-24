/**
 * High-level note recover path for PrivateCorridor.
 *
 * Prefer PIR when multi-note / notesBase set; direct GET fallback.
 * Returns safe summary (dest binding) — not full cleartext dump.
 */

import {
  createHeadstashNotesClient,
  HeadstashNotesClient,
} from './client'
import {
  decryptNoteOut,
  parseSeamNoteOutSummary,
} from './crypto'
import { bytesToHex } from './hex'
import {
  HeadstashNotesError,
  NoteEnvelope,
  NoteRecoverSummary,
  NotesAuthHeaders,
  NotesClientOptions,
} from './types'

export type RecoverNoteOpts = {
  notesBase: string
  hsId: string
  addr: string
  /** 32-byte owner key — never sent to server. */
  ownerKey: Uint8Array
  authHeaders?: NotesAuthHeaders
  bearerToken?: string
  /**
   * Prefer PIR when list has ≥1 keys (default true).
   * Set false to force direct GET.
   */
  preferPir?: boolean
  /** Force path for tests. */
  forcePath?: 'pir' | 'direct'
  fetchImpl?: typeof fetch
}

export type RecoverNoteResult = {
  summary: NoteRecoverSummary
  envelope: NoteEnvelope
  /** 382B cleartext — caller must not log; use summary for UI. */
  cleartext: Uint8Array
}

function authFromOpts(opts: RecoverNoteOpts): NotesAuthHeaders {
  const headers: NotesAuthHeaders = { ...(opts.authHeaders ?? {}) }
  if (opts.bearerToken) {
    const t = opts.bearerToken.trim()
    if (t) {
      headers.Authorization = t.toLowerCase().startsWith('bearer ')
        ? t
        : `Bearer ${t}`
    }
  }
  return headers
}

/**
 * Recover note: list → prefer PIR → decrypt → safe summary.
 * Fail-closed on wrong key / 401 / missing addr.
 */
export async function recoverPrivateNote(
  opts: RecoverNoteOpts
): Promise<RecoverNoteResult> {
  const client = createHeadstashNotesClient({
    notesBase: opts.notesBase,
    authHeaders: authFromOpts(opts),
    fetchImpl: opts.fetchImpl,
  })

  const preferPir = opts.preferPir !== false
  let path: 'pir' | 'direct' = 'direct'
  let envelope: NoteEnvelope

  if (opts.forcePath === 'direct') {
    envelope = await client.getNoteEnvelope(opts.hsId, opts.addr)
    path = 'direct'
  } else if (opts.forcePath === 'pir') {
    envelope = await client.pirGetNoteEnvelope(opts.hsId, opts.addr)
    path = 'pir'
  } else if (preferPir) {
    try {
      const keys = await client.listNoteKeys(opts.hsId)
      if (keys.length >= 1 && keys.includes(opts.addr)) {
        envelope = await client.pirGetNoteEnvelope(opts.hsId, opts.addr)
        path = 'pir'
      } else if (keys.includes(opts.addr)) {
        envelope = await client.getNoteEnvelope(opts.hsId, opts.addr)
        path = 'direct'
      } else {
        // list empty or addr missing — try direct as debug fallback
        envelope = await client.getNoteEnvelope(opts.hsId, opts.addr)
        path = 'direct'
      }
    } catch (e) {
      // If list/pir fails with non-401, still try direct once for offline debug.
      if (
        e instanceof HeadstashNotesError &&
        e.err.kind === 'http' &&
        e.err.status === 401
      ) {
        throw e
      }
      envelope = await client.getNoteEnvelope(opts.hsId, opts.addr)
      path = 'direct'
    }
  } else {
    envelope = await client.getNoteEnvelope(opts.hsId, opts.addr)
    path = 'direct'
  }

  const cleartext = decryptNoteOut(envelope, opts.ownerKey)
  const fields = parseSeamNoteOutSummary(cleartext)

  const summary: NoteRecoverSummary = {
    addr: opts.addr,
    path,
    ownerBindingHex: bytesToHex(fields.ownerBinding),
    cmPublicHex: bytesToHex(fields.cmPublic),
    value: fields.value.toString(10),
    scheme: envelope.scheme,
    cleartextLayout: envelope.cleartext_layout,
    cleartextLen: envelope.cleartext_len,
  }

  return { summary, envelope, cleartext }
}

/**
 * List note keys under hs_id (auth-gated).
 */
export async function listNotesForHs(
  opts: NotesClientOptions & { hsId: string }
): Promise<string[]> {
  const client = new HeadstashNotesClient(opts)
  return client.listNoteKeys(opts.hsId)
}

/**
 * Bridge cm addr: `cm.` + lowercase hex(32B).
 */
export function noteAddrCm(cmPublic: Uint8Array): string {
  if (cmPublic.length !== 32) {
    throw new HeadstashNotesError({
      kind: 'invalid_id',
      id: `cm.bad_len_${cmPublic.length}`,
    })
  }
  return `cm.${bytesToHex(cmPublic)}`
}
