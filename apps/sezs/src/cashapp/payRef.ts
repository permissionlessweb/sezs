/** Crockford base32 without I L O U. Fits Cash App "For" note. */
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function randomPayRef(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ABC[b % 32]
  return `cmt_${s}`
}

export const LIST_CENTS = 2500
export const CASHTAG_COPY = '$SEZS_LAB'
export const SKU = 'sezs-speakeasy-oct18'
export const RECEIPT_URL = (payRef: string) => `/cashapp/receipts/${payRef}.json`
