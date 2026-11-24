/**
 * Event role hierarchy.
 *
 * - frost_admin: the principal FROST signing set (desk / steward / spare).
 *   These seats approve payroll spends; they are not an HTTP cookie role.
 * - admin, coordinator: registered event admins. Participants, payroll, and
 *   event data. Unlocked with a site-scoped ZID (bound to the event contract
 *   domain) or a passkey, then checked against the live cw420 / event Roles
 *   set when a local LCD is configured.
 * - usher: check-in and usher chat only. Refused on payroll and participants.
 * - guest / none: no staff access.
 */
export const ROLES = Object.freeze(['frost_admin', 'admin', 'coordinator', 'usher', 'guest'])

export const EVENT_ADMIN_ROLES = Object.freeze(['admin', 'coordinator', 'frost_admin'])

export const canManagePayroll = (role) => EVENT_ADMIN_ROLES.includes(String(role || ''))

export const canManageParticipants = canManagePayroll

export const canDoor = (role) => {
  const r = String(role || '')
  return r === 'usher' || canManagePayroll(r)
}

export const canUsherChat = canDoor

export const refusalFor = (role) => {
  if (!role) return { error: 'not_member', message: 'Sign in with a ZID or passkey first.' }
  if (role === 'usher') {
    return {
      error: 'usher_forbidden',
      message: 'Ushers may only check in holders and use usher chat.',
    }
  }
  if (!canManagePayroll(role)) {
    return { error: 'not_coordinator', message: 'Only a registered event admin or coordinator may do this.' }
  }
  return null
}
