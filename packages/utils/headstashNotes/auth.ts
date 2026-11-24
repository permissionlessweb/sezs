/**
 * Notes auth helpers — bearer from secure session / module config.
 * Never commit secrets; tokens come from env/session at runtime.
 */

import { bearerAuthHeaders, resolveAuthHeaders } from './client'
import type { NotesAuthHeaders } from './types'

export { bearerAuthHeaders, resolveAuthHeaders }

/**
 * Resolve bearer for notes client from layered sources (priority high→low):
 * 1. explicit token argument
 * 2. sessionStorage `terp.notesBearer` (browser)
 * 3. process.env NEXT_PUBLIC_NOTES_BEARER or NOTES_BEARER (lab only)
 *
 * Production deployments should inject via secure session, not public env.
 */
export function resolveNotesBearerToken(explicit?: string): string | undefined {
  if (explicit && explicit.trim()) {
    return explicit.trim()
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const s = sessionStorage.getItem('terp.notesBearer')
      if (s && s.trim()) return s.trim()
    } catch {
      // private mode / blocked
    }
  }

  if (typeof process !== 'undefined' && process.env) {
    const env =
      process.env.NEXT_PUBLIC_NOTES_BEARER ||
      process.env.NOTES_BEARER ||
      process.env.HEADSTASH_NOTES_BEARER
    if (env && env.trim()) return env.trim()
  }

  return undefined
}

/** Persist bearer in sessionStorage (browser lab/ops). Does not log token. */
export function setSessionNotesBearer(token: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem('terp.notesBearer', token.trim())
}

export function clearSessionNotesBearer(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem('terp.notesBearer')
}

/** Build auth headers from optional explicit token + session/env. */
export function notesAuthFromSession(
  explicitBearer?: string
): NotesAuthHeaders {
  const token = resolveNotesBearerToken(explicitBearer)
  return resolveAuthHeaders({ bearerToken: token })
}
