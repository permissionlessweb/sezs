/**
 * PrivateCorridor notes recover helpers.
 *
 * Prefer PIR when notesBase is set and multi-note list is available.
 * Owner key stays in the browser; never sent to the server.
 * UI shows dest binding summary only — not full SEAM cleartext.
 */

import {
  createHeadstashNotesClient,
  listNotesForHs,
  notesAuthFromSession,
  recoverPrivateNote,
  type NoteRecoverSummary,
  type RecoverNoteResult,
} from '@dao-dao/utils'

export type CorridorNotesRecoverInput = {
  notesBase: string
  /** Season slug or cw-headstash contract id (path segment). */
  hsId: string
  addr: string
  /** 32-byte owner key (hex or raw). */
  ownerKey: Uint8Array
  /** Optional explicit bearer (session/env used if omitted). */
  bearerToken?: string
  /** Prefer PIR when list length ≥ 1 (default true). */
  preferPir?: boolean
}

export type CorridorNotesListInput = {
  notesBase: string
  hsId: string
  bearerToken?: string
}

/**
 * List note keys under hs_id via notesBase (auth from session/env).
 */
export async function listCorridorNoteKeys(
  input: CorridorNotesListInput
): Promise<string[]> {
  const base = input.notesBase.replace(/\/$/, '')
  if (!base) {
    throw new Error('notesBase is required')
  }
  const authHeaders = notesAuthFromSession(input.bearerToken)
  return listNotesForHs({
    notesBase: base,
    hsId: input.hsId,
    authHeaders,
  })
}

/**
 * Recover a private note: prefer PIR, decrypt client-side, return safe summary.
 */
export async function recoverCorridorNote(
  input: CorridorNotesRecoverInput
): Promise<RecoverNoteResult> {
  const base = input.notesBase.replace(/\/$/, '')
  if (!base) {
    throw new Error('notesBase is required')
  }
  if (input.ownerKey.length !== 32) {
    throw new Error('ownerKey must be 32 bytes')
  }
  return recoverPrivateNote({
    notesBase: base,
    hsId: input.hsId,
    addr: input.addr,
    ownerKey: input.ownerKey,
    bearerToken: input.bearerToken,
    preferPir: input.preferPir !== false,
    authHeaders: notesAuthFromSession(input.bearerToken),
  })
}

/** Format summary for UI (no cleartext). */
export function formatRecoverSummaryLine(s: NoteRecoverSummary): string {
  const bind =
    s.ownerBindingHex.length > 16
      ? `${s.ownerBindingHex.slice(0, 8)}…${s.ownerBindingHex.slice(-8)}`
      : s.ownerBindingHex
  return `${s.path} · addr=${s.addr} · binding=${bind} · value=${s.value}`
}

/**
 * Build a put-capable client for post-mint note film (host automation may
 * also put; browser path when UI holds SEAM cleartext + owner key).
 */
export function corridorNotesClient(
  notesBase: string,
  bearerToken?: string
) {
  return createHeadstashNotesClient({
    notesBase: notesBase.replace(/\/$/, ''),
    authHeaders: notesAuthFromSession(bearerToken),
  })
}
