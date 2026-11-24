import { AuthSession, signInComplete } from './types'
import { canManagePayroll } from './roles.mjs'

/** Artist desk: a finished sign-in (Zafu ZID, or a registered browser key). Not a password. */
export const artistSessionOk = (s?: AuthSession | null): boolean => signInComplete(s)

/** Admin page: signed in and role admin. Role is the HttpOnly cookie from the frost inbox. */
export const adminSessionOk = (s?: AuthSession | null): boolean =>
  signInComplete(s) && canManagePayroll(s?.role)

/** Coordinator tab: ZID/passkey sign-in plus a coordinator session from the event backend. */
export const coordinatorSignedIn = (s?: AuthSession | null): boolean =>
  signInComplete(s) && canManagePayroll(s?.role)
