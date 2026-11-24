import { signInComplete, AuthSession } from '../auth/types'
import { ResolvedEvent } from './api'

/** Live usher gate: a finished sign-in plus membership on the event usher list (cw420). */
export const isSignedInUsher = (
  session: AuthSession | null | undefined,
  event?: Pick<ResolvedEvent, 'roles'> | null,
  opts?: { splashUsher?: boolean },
): boolean => {
  if (!signInComplete(session)) return false
  if (session?.role === 'usher') return true
  const addr = String(session?.wallet?.address || '').trim()
  if (addr && event?.roles?.ushers?.some((a) => a === addr)) return true
  // Cookie/lab usher still requires a finished sign-in, which is already checked.
  return opts?.splashUsher === true && !!addr
}

/** Registration / "Show your work" is only for a signed-in wallet listed as an artist. */
export const isSignedInArtist = (
  session: AuthSession | null | undefined,
  event?: Pick<ResolvedEvent, 'artists'> | null,
): boolean => {
  if (!signInComplete(session)) return false
  const addr = String(session?.wallet?.address || '').trim().toLowerCase()
  if (!addr) return false
  return (event?.artists || []).some((a) => String(a.address || '').trim().toLowerCase() === addr)
}

/** Vendor desk / listing: signed-in wallet listed as a registered vendor. */
export const isSignedInVendor = (
  session: AuthSession | null | undefined,
  event?: Pick<ResolvedEvent, 'vendors'> | { vendors?: { address?: string }[] } | null,
): boolean => {
  if (!signInComplete(session)) return false
  const addr = String(session?.wallet?.address || '').trim().toLowerCase()
  if (!addr) return false
  return (event?.vendors || []).some((v) => String((v as { address?: string }).address || '').trim().toLowerCase() === addr)
}
