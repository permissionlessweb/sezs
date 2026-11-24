/** ZIP-321 payment request. Memo is UTF-8 text (Zafu does not support binary memos). */

export const buildZip321 = ({ address, amountZat, memo, label, message }) => {
  const addr = String(address || '').trim()
  if (!addr) throw new Error('no_address')
  if (addr.startsWith('zcash:') || addr.startsWith('zcash://')) throw new Error('bad_address')
  const q = []
  if (amountZat != null && amountZat !== '') {
    const zat = BigInt(amountZat)
    if (zat < 0n) throw new Error('bad_amount')
    const whole = zat / 100000000n
    const frac = (zat % 100000000n).toString().padStart(8, '0').replace(/0+$/, '')
    q.push('amount=' + (frac ? `${whole}.${frac}` : String(whole)))
  }
  if (memo) q.push('memo=' + encodeURIComponent(memo))
  if (label) q.push('label=' + encodeURIComponent(label))
  if (message) q.push('message=' + encodeURIComponent(message))
  return 'zcash:' + addr + (q.length ? '?' + q.join('&') : '')
}

export const parseZip321 = (uri) => {
  const s = String(uri || '').trim()
  if (!s.startsWith('zcash:') || s.startsWith('zcash://')) return null
  const rest = s.slice('zcash:'.length)
  const [address, query = ''] = rest.split('?')
  const params = new URLSearchParams(query)
  return {
    address,
    amount: params.get('amount'),
    memo: params.get('memo'),
    label: params.get('label'),
    message: params.get('message'),
  }
}
