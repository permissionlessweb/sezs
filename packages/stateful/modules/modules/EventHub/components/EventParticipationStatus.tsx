/**
 * Participation chips for Event Hub (U5).
 *
 * UI lives in @dao-dao/stateless (Clear tokens + Button CTA).
 * This module keeps pure chip builders and re-exports the presentational shell.
 * Never displays secrets (JWT, nsec, nullifier).
 */

import {
  EventParticipationStatus as StatelessEventParticipationStatus,
  type ChipState,
  type EventParticipationStatusProps,
  type ParticipationChip,
} from '@dao-dao/stateless'

export type { ChipState, ParticipationChip, EventParticipationStatusProps }

export const EventParticipationStatus = StatelessEventParticipationStatus

/** Build default chip set from parent facts (fail-closed). */
export const buildParticipationChips = ({
  isWalletConnected,
  isMember,
  isRegistered,
  canVote,
  seatsRemaining,
  registrationOpen,
  capacityDetail,
  hasBountySession,
  buzzReady,
  hermesPathKnown,
  hermesDeepLinkConfigured,
  routerCircuitKnown,
}: {
  isWalletConnected: boolean
  isMember: boolean | undefined
  isRegistered?: boolean | null
  canVote?: boolean | null
  /**
   * Seats left when contract reports capacity; null = unknown (soft).
   * 0 → warn full; >0 → ok open seats.
   */
  seatsRemaining?: number | null
  /** Ceremony registration_open flag when known. */
  registrationOpen?: boolean | null
  /** Preformatted capacity detail (from formatCapacityChipDetail). */
  capacityDetail?: string
  hasBountySession?: boolean
  buzzReady?: boolean
  /**
   * Hermes plane (pairing / ADR-36 → evt-* profile). Fail-closed null = unknown.
   * Never green from wallet alone — wallet ≠ Hermes multi-user login.
   */
  hermesPathKnown?: boolean | null
  /** Curator configured hermesDeepLinkUrl (ops deep-link shell). */
  hermesDeepLinkConfigured?: boolean
  /**
   * Frozen ROUTER OBJECT circuit for evt-* registrant. Fail-closed null = unknown.
   */
  routerCircuitKnown?: boolean | null
}): ParticipationChip[] => {
  const capacityState: ChipState =
    seatsRemaining != null
      ? seatsRemaining === 0
        ? 'warn'
        : 'ok'
      : registrationOpen === true
        ? 'muted'
        : registrationOpen === false
          ? 'warn'
          : 'unknown'

  const capacityLabel =
    seatsRemaining != null
      ? seatsRemaining === 0
        ? 'Full'
        : `${seatsRemaining} seats`
      : registrationOpen === true
        ? 'Reg open'
        : registrationOpen === false
          ? 'Reg closed'
          : 'Capacity'

  return [
    {
      id: 'connected',
      label: 'Connected',
      state: isWalletConnected ? 'ok' : 'muted',
      detail: isWalletConnected
        ? 'Wallet connected (membership / ADR-36 plane)'
        : 'Connect a wallet to participate',
    },
    {
      id: 'member',
      label: 'Member',
      state: isMember === undefined ? 'unknown' : isMember ? 'ok' : 'muted',
      detail:
        isMember === undefined
          ? 'Membership unknown'
          : isMember
            ? 'DAO member'
            : 'Not a DAO member',
    },
    {
      id: 'registered',
      label: 'Registered',
      state: isRegistered == null ? 'unknown' : isRegistered ? 'ok' : 'muted',
      detail:
        isRegistered == null
          ? 'Registration status unknown'
          : isRegistered
            ? 'Registered for this event'
            : 'Not registered',
    },
    {
      id: 'capacity',
      label: capacityLabel,
      state: capacityState,
      detail:
        capacityDetail ||
        (seatsRemaining != null
          ? seatsRemaining === 0
            ? 'No seats remaining'
            : `${seatsRemaining} seats remaining`
          : registrationOpen == null
            ? 'Capacity unknown'
            : registrationOpen
              ? 'Registration open (seat count not reported by contract)'
              : 'Registration closed'),
    },
    {
      id: 'can_vote',
      label: 'Can vote',
      state: canVote == null ? 'unknown' : canVote ? 'ok' : 'muted',
      detail:
        canVote == null
          ? 'Vote eligibility unknown (fail-closed)'
          : canVote
            ? 'Eligible to vote'
            : 'Not eligible to vote',
    },
    {
      id: 'bounty',
      label: 'Bounty ID',
      state: hasBountySession ? 'ok' : 'muted',
      detail: hasBountySession
        ? 'Bounty work surface ready (identity opaque — not JWT)'
        : 'No bounty session / work surface not ready',
    },
    {
      id: 'buzz',
      label: 'Buzz access',
      state: buzzReady ? 'ok' : 'muted',
      detail: buzzReady
        ? 'Collab embed shell ready (not raw relay iframe)'
        : 'Collab not ready, gated, or relay-only pending',
    },
    {
      id: 'hermes_path',
      label: 'Hermes path',
      state:
        hermesPathKnown == null
          ? hermesDeepLinkConfigured
            ? 'muted'
            : 'unknown'
          : hermesPathKnown
            ? 'ok'
            : 'muted',
      detail:
        hermesPathKnown == null
          ? hermesDeepLinkConfigured
            ? 'Ops deep-link configured — evt-* pairing/ADR-36 path is Hermes plane (not wallet)'
            : 'Hermes path unknown — pairing/ADR-36 installs evt-* profile (not multi-user :9119)'
          : hermesPathKnown
            ? 'Hermes evt-* path known for this registrant'
            : 'No Hermes evt-* path yet',
    },
    {
      id: 'router',
      label: 'Router circuit',
      state:
        routerCircuitKnown == null
          ? 'unknown'
          : routerCircuitKnown
            ? 'ok'
            : 'muted',
      detail:
        routerCircuitKnown == null
          ? 'Frozen ROUTER OBJECT unknown — operator path mint + router (stage 4 = chips only)'
          : routerCircuitKnown
            ? 'Router info-circuit present (public-safe links only)'
            : 'No router circuit for this registrant',
    },
  ]
}
