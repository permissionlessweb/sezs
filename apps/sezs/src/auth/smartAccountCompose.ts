/**
 * Chain composition for x/smartaccount — types + encode hints.
 * Product add/remove of account modules lives with the identity stack.
 * Nested AnyOf/AllOf was a 2026-07-19 MVP non-goal; SEZS needs it for devices.
 *
 * Do not broadcast from this module. Passkey is not the chain signer.
 * Register each device as CosmwasmAuthenticatorV1 (or SignatureVerification),
 * then wrap with type "AnyOf" / "AllOf" when the ante accepts that config.
 */

export type ComposeOp = 'anyOf' | 'allOf'

export type AuthenticatorInit = {
  authenticatorType: string
  dataBase64: string
}

/** Osmosis-shaped init list. Exact bytes belong in a later encode test vs chain. */
export const composeHint = (
  op: ComposeOp,
  members: AuthenticatorInit[]
): { authenticatorType: string; members: AuthenticatorInit[] } => ({
  authenticatorType: op === 'allOf' ? 'AllOf' : 'AnyOf',
  members,
})
