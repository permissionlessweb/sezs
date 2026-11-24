/**
 * Helpers for react-hook-form paths under Infusions create/infuse prefixes.
 * Always pass fieldNamePrefix including trailing dot when nested (e.g. `infuse.`).
 */

export type InfusionFormPath =
  | 'chainId'
  | 'infusionMinter'
  | 'infusionId'
  | 'infusionBundles'
  | 'funds'
  | 'collection'
  | 'tokenId'
  | 'description'
  | 'collections'
  | 'infusedCollection'
  | 'infusionParams'
  | 'paymentRecipient'
  | 'owner'
  | 'deposit'
  | 'mode'

/**
 * Join prefix + field without double dots.
 * `prefixed('infuse.', 'funds')` → `infuse.funds`
 * `prefixed('', 'funds')` → `funds`
 */
export const prefixed = (
  fieldNamePrefix: string,
  field: string
): string => {
  if (!fieldNamePrefix) {
    return field
  }
  const prefix = fieldNamePrefix.endsWith('.')
    ? fieldNamePrefix
    : `${fieldNamePrefix}.`
  return `${prefix}${field}`
}

/** Type-cast helper for RHF fieldName props that expect a Path<T>. */
export const asPath = <T extends string>(path: string): T => path as T
