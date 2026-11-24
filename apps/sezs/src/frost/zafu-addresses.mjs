/**
 * Addresses from a connected Zafu (or Zigner QR). Never asks for a seed.
 * Diversified addresses are produced by the wallet, not derived here.
 */
import { looksShieldedZec, looksUmBech32, parseAddressQr } from '../pay/bech32.mjs'

const fromWindow = () => {
  if (typeof globalThis === 'undefined') return null
  const w = globalThis
  return w.__SEZS_ZAFU__ || w.__SEZS_ZAFU_ADDRESSES__ || w.zafu || null
}

const pick = (src) => {
  if (!src || typeof src !== 'object') return { zec: '', um: '' }
  const zec = String(src.zec || src.unified || src.ua || src.zcash || '').trim()
  const um = String(src.um || src.penumbra || src.penumbraAddress || '').trim()
  return { zec, um }
}

export const getConnectedAddresses = async () => {
  const src = fromWindow()
  if (!src) return { ok: false, error: 'zafu_not_connected', zec: '', um: '' }
  let raw = src
  if (typeof src.getAddresses === 'function') raw = await src.getAddresses()
  const { zec, um } = pick(raw)
  return { ok: true, zec, um, zecOk: !zec || looksShieldedZec(zec), umOk: !um || looksUmBech32(um) }
}

export const randomizeConnectedAddresses = async () => {
  const src = fromWindow()
  if (!src) return { ok: false, error: 'zafu_not_connected', zec: '', um: '' }
  if (typeof src.randomize === 'function') {
    const raw = await src.randomize()
    const { zec, um } = pick(raw)
    return { ok: true, zec, um, zecOk: !zec || looksShieldedZec(zec), umOk: !um || looksUmBech32(um) }
  }
  if (typeof src.diversify === 'function') {
    const raw = await src.diversify()
    const { zec, um } = pick(raw)
    return { ok: true, zec, um, zecOk: !zec || looksShieldedZec(zec), umOk: !um || looksUmBech32(um) }
  }
  return { ok: false, error: 'randomize_unsupported', zec: '', um: '' }
}

export const addressFromQrText = (text) => parseAddressQr(text)

export { looksShieldedZec, looksUmBech32 }
