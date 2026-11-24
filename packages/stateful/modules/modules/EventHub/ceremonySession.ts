/**
 * OD-session-map (U8 / F3) — map Event Hub event surface → ceremony session_id.
 *
 * Convention (locked for product leave-unknown path):
 * 1. Module `defaultEventSlug` when set (preferred curator SoT for ceremony StartCeremony).
 * 2. Else selected calendar `eventId` when it is a usable slug (non-empty trim).
 * 3. Else undefined → chips/CTA stay fail-closed unknown (never invent).
 *
 * Operators must StartCeremony with the same session_id string. No identity merge
 * with Buzz nsec / Hermes profile / membership JWT.
 */

export type ResolveCeremonySessionIdArgs = {
  defaultEventSlug?: string | null
  selectedEventId?: string | null
  /** Optional explicit override (future module field); wins when non-empty. */
  ceremonySessionId?: string | null
}

/**
 * Resolve ceremony session_id for chips + Register CTA.
 * Returns undefined when mapping is incomplete.
 */
export function resolveCeremonySessionId(
  args: ResolveCeremonySessionIdArgs
): string | undefined {
  const explicit = args.ceremonySessionId?.trim()
  if (explicit) return explicit

  const slug = args.defaultEventSlug?.trim()
  if (slug) return slug

  const eventId = args.selectedEventId?.trim()
  if (eventId) return eventId

  return undefined
}
