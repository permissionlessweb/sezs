/**
 * frostd / poker-escrow wire — documentation as constants.
 * Port from:
 *   zeratul/poker-escrow frost_relay.rs
 *   payout_signing.rs (SIGN / C / S)
 *   zcli frost_ceremony.rs (dkg1 / dkg2 tags)
 * Do not send KeyPackages on this channel from the browser.
 */

export const RELAY_CLIENT = {
  create: 'create',
  join: 'join',
  msg: 'msg',
  part: 'part',
} as const

export const RELAY_SERVER = {
  created: 'created',
  joined: 'joined',
  msg: 'msg',
  system: 'system',
  error: 'error',
} as const

export const DKG_TAGS = { r1: 'dkg1', r2: 'dkg2' } as const

/** Host once: sighash, alphas, recipient, amounts, PCZT hex for OVK check. */
export const signLine = (parts: {
  sighashHex: string
  alphasCsv: string
  recipient: string
  amountZat: string
  feeZat: string
  pcztHex: string
}) =>
  `SIGN:${parts.sighashHex}:${parts.alphasCsv}:${parts.recipient}:${parts.amountZat}:${parts.feeZat}:${parts.pcztHex}`

export const commitLine = (commits: string[]) => `C:${commits.join('|')}`
export const shareLine = (actionIdx: number, share: string) =>
  `S:${actionIdx}:${share}`
