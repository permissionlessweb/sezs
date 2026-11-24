/** Page guards. A claimed role is ignored. Mutations stay on this origin. */

export function roleFromCred(
  claimedRole: string,
  credId: string,
  adminCredIds: string[],
  usherCredIds: string[]
): 'admin' | 'usher' | 'guest' {
  if (credId && adminCredIds.includes(credId)) return 'admin'
  if (credId && usherCredIds.includes(credId)) return 'usher'
  void claimedRole
  return 'guest'
}

export function adminSurface(role: string | undefined): boolean {
  return role === 'admin'
}

const PAGE_ORIGINS = new Set([
  'http://127.0.0.1:3051',
  'http://localhost:3051',
])

/** Cross-site POSTs send Origin. Same-tab navigations may omit it. */
export function mutationAllowed(origin: string | null, header: string | null): boolean {
  if (header !== '1') return false
  if (origin && !PAGE_ORIGINS.has(origin)) return false
  return true
}
