/**
 * Ceremony chip facts loader (U8 / EH-REG-2).
 *
 * Smart-queries cw-vote-ceremony IsRegistered + Ceremony.
 * Optional capacity/seats queries are attempted only when the deployed
 * contract exposes them (current cw-vote-ceremony does not) — never invent numbers.
 * Fail-closed: missing inputs or query errors → null (unknown chips).
 * Never surfaces nullifiers, JWTs, or nsecs.
 *
 * SoT: docs/research/dao-event-ui-orch/STATUS-U8-SPEC.md §3.4
 */

export type CeremonyChipFacts = {
  isRegistered: boolean | null
  canVote: boolean | null
  /** Ceremony Active + registration_open when query succeeds; null if unknown. */
  registrationOpen: boolean | null
  /** True when ceremony status is Active (serde unit variant). */
  ceremonyActive: boolean | null
  /**
   * Seats remaining when the contract reports capacity stats; null if
   * unknown / unsupported (honest soft-fail — do not invent).
   */
  seatsRemaining: number | null
  /** Max capacity when reported; null if unknown. */
  capacityMax: number | null
  /** Registered count when reported; null if unknown. */
  registeredCount: number | null
}

export type QueryContractSmart = (
  address: string,
  queryMsg: Record<string, unknown>
) => Promise<unknown>

export type LoadCeremonyChipFactsArgs = {
  queryContractSmart: QueryContractSmart
  ceremony: string | undefined
  sessionId: string | undefined
  /**
   * Wallet bech32. When missing, isRegistered/canVote stay null (fail-closed)
   * but ceremony session flags (registrationOpen / capacity) may still load.
   */
  addr: string | undefined
  /** mesh.eventDefaults.requireRegistration — when true, canVote requires registered. */
  requireRegistration: boolean
}

const emptyFacts = (): CeremonyChipFacts => ({
  isRegistered: null,
  canVote: null,
  registrationOpen: null,
  ceremonyActive: null,
  seatsRemaining: null,
  capacityMax: null,
  registeredCount: null,
})

/** Normalize CosmWasm unit/string status variants. */
export function isCeremonyActiveStatus(status: unknown): boolean {
  if (status === 'Active' || status === 'active') return true
  if (status && typeof status === 'object') {
    const keys = Object.keys(status as object)
    return keys.some((k) => k === 'Active' || k === 'active')
  }
  return false
}

/** Parse optional capacity-shaped responses without inventing fields. */
export function parseCapacityStats(raw: unknown): {
  seatsRemaining: number | null
  capacityMax: number | null
  registeredCount: number | null
} {
  if (!raw || typeof raw !== 'object') {
    return { seatsRemaining: null, capacityMax: null, registeredCount: null }
  }
  const o = raw as Record<string, unknown>
  const body =
    o.capacity && typeof o.capacity === 'object'
      ? (o.capacity as Record<string, unknown>)
      : o.stats && typeof o.stats === 'object'
        ? (o.stats as Record<string, unknown>)
        : o

  const asNum = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

  const capacityMax = asNum(
    body.max ?? body.max_capacity ?? body.capacity ?? body.limit
  )
  const registeredCount = asNum(
    body.registered ??
      body.registered_count ??
      body.num_registered ??
      body.count
  )
  const seatsRemainingDirect = asNum(
    body.seats_remaining ?? body.remaining ?? body.seats
  )
  const seatsRemaining =
    seatsRemainingDirect != null
      ? seatsRemainingDirect
      : capacityMax != null && registeredCount != null
        ? Math.max(0, capacityMax - registeredCount)
        : null

  return { seatsRemaining, capacityMax, registeredCount }
}

/**
 * Best-effort optional capacity queries. Current cw-vote-ceremony has no
 * capacity QueryMsg — these soft-fail silently (return null seats).
 */
async function tryLoadCapacityStats(
  queryContractSmart: QueryContractSmart,
  ceremony: string,
  sessionId: string
): Promise<{
  seatsRemaining: number | null
  capacityMax: number | null
  registeredCount: number | null
}> {
  const msgs: Record<string, unknown>[] = [
    { capacity: { session_id: sessionId } },
    { registration_stats: { session_id: sessionId } },
    { seats: { session_id: sessionId } },
  ]
  for (const msg of msgs) {
    try {
      const raw = await queryContractSmart(ceremony, msg)
      const parsed = parseCapacityStats(raw)
      if (
        parsed.seatsRemaining != null ||
        parsed.capacityMax != null ||
        parsed.registeredCount != null
      ) {
        return parsed
      }
    } catch {
      // unsupported query — try next
    }
  }
  return { seatsRemaining: null, capacityMax: null, registeredCount: null }
}

/**
 * Load Registered / Can vote / optional capacity facts for Event Hub chips.
 * Safe to call from useQuery; never throws.
 */
export async function loadCeremonyChipFacts(
  args: LoadCeremonyChipFactsArgs
): Promise<CeremonyChipFacts> {
  if (!args.ceremony || !args.sessionId) {
    return emptyFacts()
  }

  try {
    const cerRaw = await args.queryContractSmart(args.ceremony, {
      ceremony: { session_id: args.sessionId },
    })

    const cerWrap = cerRaw as {
      ceremony?: {
        status?: unknown
        registration_open?: boolean
      }
      status?: unknown
      registration_open?: boolean
    } | null

    const ceremonyBody = cerWrap?.ceremony ?? cerWrap
    const active = isCeremonyActiveStatus(ceremonyBody?.status)
    const registrationOpen =
      typeof ceremonyBody?.registration_open === 'boolean'
        ? ceremonyBody.registration_open
        : null

    const capacity = await tryLoadCapacityStats(
      args.queryContractSmart,
      args.ceremony,
      args.sessionId
    )

    // Wallet required for IsRegistered / canVote personalization.
    if (!args.addr) {
      return {
        ...emptyFacts(),
        registrationOpen,
        ceremonyActive: active,
        ...capacity,
      }
    }

    const regRaw = await args.queryContractSmart(args.ceremony, {
      is_registered: {
        session_id: args.sessionId,
        addr: args.addr,
      },
    })
    const reg = regRaw as { registered?: boolean } | null
    const registered = !!reg?.registered

    // canVote: Active session + (requireRegistration ? registered : true).
    const canVote = active
      ? args.requireRegistration
        ? registered
        : true
      : false

    return {
      isRegistered: registered,
      canVote,
      registrationOpen,
      ceremonyActive: active,
      ...capacity,
    }
  } catch {
    return emptyFacts()
  }
}

/** Human-readable soft capacity label for chips (never invents seat counts). */
export function formatCapacityChipDetail(facts: CeremonyChipFacts): string {
  if (facts.seatsRemaining != null) {
    if (facts.seatsRemaining === 0) {
      return facts.capacityMax != null
        ? `Full (${facts.capacityMax} seats)`
        : 'Full — no seats remaining'
    }
    return facts.capacityMax != null
      ? `${facts.seatsRemaining} of ${facts.capacityMax} seats left`
      : `${facts.seatsRemaining} seats left`
  }
  if (facts.registrationOpen === true) {
    return 'Registration open (seat count not reported by contract)'
  }
  if (facts.registrationOpen === false) {
    return 'Registration closed (seat count not reported by contract)'
  }
  return 'Capacity unknown'
}
