/** Resolve the event contract + chain config for a reusable front end.
 *
 * Instantiation is purely from an address and chain endpoints. Precedence:
 *  1. query string `?contract=&lcd=&chainId=`
 *  2. sessionStorage selection (from the in-app event picker)
 *  3. `window.__SEZS_BOOT` (static on-chain embed can inject this)
 *  4. Next public env (`NEXT_PUBLIC_SEZS_EVENT_CONTRACT`, `NEXT_PUBLIC_SEZS_EVENTS`,
 *     `NEXT_PUBLIC_SEZS_LCD`, `NEXT_PUBLIC_SEZS_CHAIN_ID`)
 */

export type ChainBoot = {
  contract: string
  lcd: string
  chainId: string
  raffle: string
  randomness: string
}

const LAB_LCD = 'http://127.0.0.1:1317'
const MAINNET_LCD = 'https://api.terp.network'
const LAB_CHAIN = 'sezs-local-1'
const SELECTED_CONTRACT_KEY = 'sezs-selected-event-contract'

const trim = (v: string | undefined) => String(v || '').trim()
const hasProc = () => typeof process !== 'undefined' && !!process.env
const envEvents = () =>
  hasProc() ? trim(process.env.NEXT_PUBLIC_SEZS_EVENTS) || trim(process.env.SEZS_EVENTS) : ''
const envContract = () =>
  hasProc()
    ? trim(process.env.NEXT_PUBLIC_SEZS_EVENT_CONTRACT) || trim(process.env.SEZS_EVENT_CONTRACT)
    : ''
const envChainId = () =>
  hasProc() ? trim(process.env.NEXT_PUBLIC_SEZS_CHAIN_ID) || trim(process.env.SEZS_CHAIN_ID) : ''
const envLcd = () =>
  hasProc()
    ? trim(process.env.NEXT_PUBLIC_SEZS_LCD) ||
      trim(process.env.NEXT_PUBLIC_SEZS_REST) ||
      trim(process.env.SEZS_LCD)
    : ''
const envRaffle = () =>
  hasProc()
    ? trim(process.env.NEXT_PUBLIC_SEZS_RAFFLE_CONTRACT) || trim(process.env.SEZS_RAFFLE_CONTRACT)
    : ''
const envRandomness = () =>
  hasProc()
    ? trim(process.env.NEXT_PUBLIC_SEZS_RANDOMNESS_CONTRACT) ||
      trim(process.env.SEZS_RANDOMNESS_CONTRACT)
    : ''

export const eventContracts = (): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (addr: string) => {
    const clean = addr.trim()
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    out.push(clean)
  }
  const list = envEvents()
  for (const part of list.split(',')) push(part)
  if (typeof window !== 'undefined') {
    const raw = (window as unknown as { __SEZS_BOOT?: { events?: unknown; contract?: unknown } }).__SEZS_BOOT
    if (raw && Array.isArray(raw.events)) {
      for (const e of raw.events) if (typeof e === 'string') push(e)
    }
    if (raw && typeof raw.contract === 'string') push(raw.contract)
  }
  push(envContract())
  return out
}

export const selectedContract = (): string => {
  if (typeof window === 'undefined') return ''
  try {
    return (window.sessionStorage.getItem(SELECTED_CONTRACT_KEY) || '').trim()
  } catch {
    return ''
  }
}

export const rememberSelectedContract = (contract: string): void => {
  if (typeof window === 'undefined') return
  const clean = contract.trim()
  try {
    if (clean) window.sessionStorage.setItem(SELECTED_CONTRACT_KEY, clean)
    else window.sessionStorage.removeItem(SELECTED_CONTRACT_KEY)
  } catch {
    /* ignore */
  }
}

const searchBoot = (): Partial<ChainBoot> => {
  if (typeof window === 'undefined') return {}
  try {
    const q = new URLSearchParams(window.location.search)
    return {
      contract: (q.get('contract') || q.get('event') || '').trim(),
      lcd: (q.get('lcd') || q.get('rest') || '').trim(),
      chainId: (q.get('chainId') || q.get('chain') || '').trim(),
      raffle: (q.get('raffle') || '').trim(),
      randomness: (q.get('randomness') || q.get('beacon') || '').trim(),
    }
  } catch {
    return {}
  }
}

const injectedBoot = (): Partial<ChainBoot> => {
  if (typeof window === 'undefined') return {}
  const raw = (window as unknown as { __SEZS_BOOT?: Partial<ChainBoot> }).__SEZS_BOOT
  if (!raw || typeof raw !== 'object') return {}
  return {
    contract: String(raw.contract || '').trim(),
    lcd: String(raw.lcd || '').trim(),
    chainId: String(raw.chainId || '').trim(),
    raffle: String(raw.raffle || '').trim(),
    randomness: String(raw.randomness || '').trim(),
  }
}

export const readBoot = (): ChainBoot => {
  const q = searchBoot()
  const inj = injectedBoot()
  const listed = eventContracts()
  const picked = selectedContract()
  const validPicked = picked && (!listed.length || listed.includes(picked)) ? picked : ''
  const contract =
    q.contract ||
    validPicked ||
    envContract() ||
    listed[0] ||
    inj.contract ||
    ''
  const chainId =
    q.chainId ||
    inj.chainId ||
    envChainId() ||
    (contract ? LAB_CHAIN : '')
  const defaultLcd = chainId === 'morocco-1' ? MAINNET_LCD : LAB_LCD
  const lcd = (
    q.lcd ||
    inj.lcd ||
    envLcd() ||
    (contract ? defaultLcd : '')
  ).replace(/\/$/, '')
  const raffle =
    q.raffle ||
    inj.raffle ||
    envRaffle() ||
    ''
  const randomness =
    q.randomness ||
    inj.randomness ||
    envRandomness() ||
    ''
  return { contract, lcd, chainId, raffle, randomness }
}

export const bootQuery = (boot: ChainBoot): string => {
  const p = new URLSearchParams()
  if (boot.contract) p.set('contract', boot.contract)
  if (boot.lcd) p.set('lcd', boot.lcd)
  if (boot.chainId) p.set('chainId', boot.chainId)
  if (boot.raffle) p.set('raffle', boot.raffle)
  if (boot.randomness) p.set('randomness', boot.randomness)
  const s = p.toString()
  return s ? `?${s}` : ''
}
