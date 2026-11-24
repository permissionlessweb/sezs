/**
 * Headstash private notes types — match seam_note_out NoteEnvelope + hash-market routes.
 *
 * SSOT: crates/terp-rs/crates/seam_note_out + tools/hash-market notes handlers.
 * Cleartext stays client-side after decrypt; never public /content.
 */

/** AEAD scheme string written into every envelope (exact match). */
export const SCHEME_XCHACHA20POLY1305 = 'xchacha20poly1305' as const

/** Cleartext layout tag for V0 fixed 382B serialization. */
export const CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0 = 'SEAM-NOTE-OUT-V0' as const

/** SEAM-NOTE-OUT V0 cleartext length (bytes). */
export const SEAM_NOTE_OUT_V0_LEN = 382

/** Max path segment length for hs_id / addr (hash-market validate_id). */
export const NOTE_ID_MAX_LEN = 200

/**
 * Opaque note blob stored by HeadstashStore (JSON fields).
 * ciphertext + nonce are lowercase hex.
 */
export type NoteEnvelope = {
  /** Lowercase hex of AEAD ciphertext (includes Poly1305 tag). */
  ciphertext: string
  /** Lowercase hex of 24-byte XChaCha20 nonce. */
  nonce: string
  /** Must be `xchacha20poly1305`. */
  scheme: string
  /** Must be `SEAM-NOTE-OUT-V0` for V0 decrypt path. */
  cleartext_layout: string
  /** Cleartext byte length before encryption (382 for V0). */
  cleartext_len: number
  /** Optional lowercase hex SHA256 of raw ciphertext bytes. */
  sha256?: string
}

export type ListNoteKeysResponse = {
  keys: string[]
}

export type PirResponse = {
  /** Hex of equal-padded XOR result (envelope JSON + NUL pad). */
  result: string
}

/** Auth headers for notes routes (Bearer and/or snap secp). */
export type NotesAuthHeaders = Record<string, string>

export type NotesClientOptions = {
  /** hash-market base, e.g. `https://notes.example` (trailing slash stripped). */
  notesBase: string
  /** Optional Authorization: Bearer … or other auth headers. */
  authHeaders?: NotesAuthHeaders
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export type NotesHttpError = {
  kind: 'http'
  status: number
  body: string
}

export type NotesClientError =
  | { kind: 'invalid_id'; id: string }
  | { kind: 'invalid_envelope'; reason: string }
  | { kind: 'bad_hex'; reason: string }
  | { kind: 'addr_not_found'; addr: string }
  | { kind: 'empty_list' }
  | { kind: 'decrypt'; reason: string }
  | { kind: 'encrypt'; reason: string }
  | { kind: 'unsupported_scheme'; scheme: string }
  | { kind: 'unsupported_layout'; layout: string }
  | { kind: 'bad_cleartext_len'; len: number }
  | { kind: 'bad_nonce' }
  | { kind: 'network'; message: string }
  | NotesHttpError

export class HeadstashNotesError extends Error {
  readonly err: NotesClientError

  constructor(err: NotesClientError) {
    super(formatNotesError(err))
    this.name = 'HeadstashNotesError'
    this.err = err
  }
}

export function formatNotesError(err: NotesClientError): string {
  switch (err.kind) {
    case 'http':
      return `notes HTTP ${err.status}: ${err.body.slice(0, 200)}`
    case 'invalid_id':
      return `invalid notes id: ${err.id}`
    case 'invalid_envelope':
      return `invalid envelope: ${err.reason}`
    case 'bad_hex':
      return `bad hex: ${err.reason}`
    case 'addr_not_found':
      return `addr not in note list: ${err.addr}`
    case 'empty_list':
      return 'note list empty'
    case 'decrypt':
      return `decrypt failed: ${err.reason}`
    case 'encrypt':
      return `encrypt failed: ${err.reason}`
    case 'unsupported_scheme':
      return `unsupported scheme: ${err.scheme}`
    case 'unsupported_layout':
      return `unsupported layout: ${err.layout}`
    case 'bad_cleartext_len':
      return `bad cleartext_len: ${err.len}`
    case 'bad_nonce':
      return 'bad nonce (expected 24 bytes)'
    case 'network':
      return `network: ${err.message}`
    default:
      return 'unknown notes error'
  }
}

/**
 * Safe summary after recover — dest binding only, never full cleartext dump.
 */
export type NoteRecoverSummary = {
  addr: string
  path: 'pir' | 'direct'
  /** Lowercase hex of owner_binding (32B) from SEAM cleartext. */
  ownerBindingHex: string
  /** Lowercase hex of cm_public (32B). */
  cmPublicHex: string
  value: string
  scheme: string
  cleartextLayout: string
  cleartextLen: number
}
