/**
 * Recommended WebAuthn user.name / displayName when the person does not pick an alias.
 * Local calendar date, as `sez-<yy-mm-dd>`.
 */
export function defaultPasskeyName(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `sez-${yy}-${mm}-${dd}`
}

/**
 * Name shown by the authenticator for a new passkey. Empty values and the
 * legacy default "guest" become `sez-<yy-mm-dd>` so passkeys are not all named guest.
 */
export function passkeyDisplayName(alias?: string | null, now?: Date): string {
  const trimmed = (alias ?? '').trim()
  if (!trimmed || trimmed === 'guest') return defaultPasskeyName(now)
  return trimmed
}
