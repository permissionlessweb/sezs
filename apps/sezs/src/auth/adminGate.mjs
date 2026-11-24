/**
 * /admin page gate. A finished sign-in is required. Live on-chain staff
 * membership wins when a role query is present.
 */
import { canManagePayroll } from './roles.mjs'

const signInComplete = (s) => {
  const w = s?.wallet
  if (!w) return false
  if (w.kind === 'zid') return !!w.zidPubkey
  if (w.kind === 'passkey') return !!w.passkeyCredId && !!w.passkeyVerified
  if (w.kind === 'email') return !!w.email && !!w.emailVerified
  if (w.kind === 'browser') return !!w.address && !!w.registered
  return !!w.address
}

export const isStaffRole = (role) => canManagePayroll(role)

const inList = (address, list) => {
  if (!address || !list?.length) return false
  const a = String(address).toLowerCase()
  return list.some((x) => String(x || '').toLowerCase() === a)
}

export const addressIsStaff = (address, live) => {
  if (!address || !live) return false
  if (inList(address, live.coordinators) || inList(address, live.curators)) return true
  if (live.role && isStaffRole(live.role) && String(live.address || '').toLowerCase() === String(address).toLowerCase()) {
    return true
  }
  return false
}

export const adminGate = ({ ready, session, live } = {}) => {
  if (ready === false) return 'loading'
  if (!signInComplete(session)) return 'signed_out'
  const address = session?.wallet?.address
  const hint = live || undefined
  if (hint?.live) {
    return addressIsStaff(address, hint) || isStaffRole(hint.role) ? 'ok' : 'forbidden'
  }
  if (addressIsStaff(address, hint)) return 'ok'
  if (isStaffRole(session?.role)) return 'ok'
  return 'forbidden'
}
