/**
 * Registration bounty soft-gate (Event Hub work surface).
 *
 * Product rule (user-perspective review / t_21a7b53c):
 * Do not present OPEN / "pending registration" work as production-ready when
 * mesh.v1 / module has no ceremony (or calendar+ceremony) registration path.
 *
 * Fail-closed honesty: ceremony missing → gate closed + clear reason.
 * Parent never invents ceremony addresses.
 */

export type RegistrationPolicy = 'open' | 'members' | 'ceremony'

export type RegistrationBountyGateCode =
  | 'ok'
  | 'ceremony_missing'
  | 'session_unmapped'
  | 'not_event_registration'

export type RegistrationBountyGate = {
  /** True only when OPEN registration bounty story is allowed. */
  allowOpenRegistrationBounty: boolean
  code: RegistrationBountyGateCode
  /** Operator/user-facing one-liner (English default; i18n at call site). */
  detail: string
  /** Non-empty ceremony address when mapped. */
  ceremonyContract?: string
  /** Ceremony session_id when OD-session-map resolved. */
  sessionId?: string
}

export type EvaluateRegistrationBountyGateArgs = {
  ceremonyContract?: string | null
  /** Optional calendar address — used only for richer detail copy. */
  calendarContract?: string | null
  sessionId?: string | null
  registrationPolicy?: RegistrationPolicy | null
  /**
   * mesh.eventDefaults.requireRegistration (ceremony policy write path).
   * When true, OPEN registration bounty requires ceremony + (preferred) session.
   */
  requireRegistration?: boolean | null
  /**
   * When true (default), Event Hub work surface always requires a ceremony
   * mapping before advertising OPEN registration bounties — even for
   * policy=open/members — so lab OPEN@0 registration cards are not orphan.
   */
  enforceCeremonyForRegistrationBounty?: boolean
}

/**
 * Soft-gate: registration bounty may be OPEN only when ceremony path is set.
 *
 * - Ceremony empty → closed (`ceremony_missing`) when enforcement on or policy/require needs it
 * - Ceremony set, session empty → still allow OPEN mapping to contract, but code
 *   `session_unmapped` so UI can soft-warn (StartCeremony / default slug)
 * - Ceremony + session → `ok`
 */
export function evaluateRegistrationBountyGate(
  args: EvaluateRegistrationBountyGateArgs
): RegistrationBountyGate {
  const ceremony = args.ceremonyContract?.trim() || undefined
  const calendar = args.calendarContract?.trim() || undefined
  const sessionId = args.sessionId?.trim() || undefined
  const policy = args.registrationPolicy || undefined
  const requireReg = !!args.requireRegistration || policy === 'ceremony'
  const enforce =
    args.enforceCeremonyForRegistrationBounty !== false || requireReg

  if (!enforce) {
    return {
      allowOpenRegistrationBounty: true,
      code: 'not_event_registration',
      detail: 'Registration bounty gate not enforced for this surface.',
      ceremonyContract: ceremony,
      sessionId,
    }
  }

  if (!ceremony) {
    return {
      allowOpenRegistrationBounty: false,
      code: 'ceremony_missing',
      detail: calendar
        ? 'Calendar is set but ceremony contract is missing — registration bounty stays pending until mesh.v1.ceremony / Event Hub ceremonyContract is configured.'
        : 'No ceremony/registration contract mapped — registration bounty cannot be OPEN. Set ceremony on Event Hub module or mesh.v1.',
      ceremonyContract: undefined,
      sessionId,
    }
  }

  if (!sessionId) {
    return {
      allowOpenRegistrationBounty: true,
      code: 'session_unmapped',
      detail:
        'Ceremony contract mapped; session_id not linked yet (default event slug / calendar selection). Registration bounty may show; chips stay unknown until OD-session-map resolves.',
      ceremonyContract: ceremony,
      sessionId: undefined,
    }
  }

  return {
    allowOpenRegistrationBounty: true,
    code: 'ok',
    detail: 'Ceremony + session mapped for registration bounty path.',
    ceremonyContract: ceremony,
    sessionId,
  }
}

/**
 * Whether the parent should hide the full bounties iframe "as if registration
 * work is live" and instead show honest pending for registration path.
 *
 * Only when gate closed with ceremony_missing.
 */
export function shouldShowRegistrationBountyPending(
  gate: RegistrationBountyGate
): boolean {
  return (
    !gate.allowOpenRegistrationBounty && gate.code === 'ceremony_missing'
  )
}
