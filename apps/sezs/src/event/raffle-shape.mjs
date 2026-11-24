/** Pure raffle listing helpers shared by the LCD client and unit tests. */

const rec = (v) => (v && typeof v === 'object' ? v : {})
const num = (v, d = 0) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  return d
}
const str = (v, d = '') => (typeof v === 'string' ? v : d)

export const asCoin = (v) => {
  const x = rec(v)
  const coin = rec(x.coin)
  const denom = str(coin.denom || x.denom)
  const amount = str(coin.amount || x.amount)
  if (!denom && !amount) return undefined
  return { denom, amount }
}

const nsToIso = (v) => {
  if (v == null || v === '') return undefined
  const raw = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(raw)) return undefined
  const ms = raw > 1e15 ? raw / 1e6 : raw > 1e12 ? raw : raw * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export const formatCoin = (c) => {
  if (!c || c.amount == null || c.amount === '') return '—'
  const denom = c.denom || ''
  let amount
  try {
    amount = BigInt(c.amount)
  } catch {
    return `${c.amount} ${denom}`.trim()
  }
  const micro = denom.startsWith('u') && denom.length > 1
  if (!micro) return `${amount.toString()} ${denom}`.trim()
  const symbol = denom.slice(1).toUpperCase()
  const whole = amount / 1000000n
  const frac = amount % 1000000n
  if (frac === 0n) return `${whole.toString()} ${symbol}`
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fracStr} ${symbol}`
}

export const formatWhen = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

const assetsOf = (v) => {
  if (!Array.isArray(v)) return []
  return v.map((item) => {
    const x = rec(item)
    const cw = rec(x.cw721 || x.cw721_coin)
    if (cw.address || cw.token_id || cw.tokenId) {
      return { kind: 'cw721', address: str(cw.address) || undefined, tokenId: str(cw.token_id || cw.tokenId) || undefined }
    }
    const coin = asCoin(x.coin || x.native || x)
    if (coin) return { kind: 'coin', coin }
    return { kind: 'unknown' }
  })
}

export const normalizeRaffle = (raw) => {
  if (!raw) return null
  const already = rec(raw.raffle_info)
  const info = Object.keys(already).length ? already : rec(raw.info)
  if (!Object.keys(info).length && raw.raffle_id == null && raw.raffleId == null) return null
  const opts = rec(info.raffle_options || info.options)
  const startIso = nsToIso(opts.raffle_start_timestamp ?? opts.start_timestamp ?? opts.start)
  const durationSec = num(opts.raffle_duration ?? opts.duration)
  let endsAt
  if (startIso && durationSec) {
    endsAt = new Date(Date.parse(startIso) + durationSec * 1000).toISOString()
  }
  const winnersRaw = info.winners
  const winners = Array.isArray(winnersRaw) ? winnersRaw.map((w) => String(w)) : []
  const sold = num(info.number_of_tickets ?? info.ticket_count ?? raw.ticket_count)
  const max = opts.max_ticket_number != null ? num(opts.max_ticket_number) : undefined
  const min = opts.min_ticket_number != null ? num(opts.min_ticket_number) : undefined
  const cap = opts.max_ticket_per_address != null ? num(opts.max_ticket_per_address) : undefined
  return {
    raffleId: num(raw.raffle_id ?? raw.raffleId),
    state: str(raw.raffle_state || raw.state, 'unknown'),
    owner: str(info.owner) || undefined,
    ticketsSold: sold,
    maxTickets: max || undefined,
    minTickets: min || undefined,
    maxPerAddress: cap || undefined,
    ticketPrice: asCoin(info.raffle_ticket_price ?? info.ticket_price),
    startsAt: startIso,
    endsAt,
    comment: str(opts.comment) || undefined,
    winners,
    assets: assetsOf(info.assets),
    cancelled: Boolean(info.is_cancelled) || str(raw.raffle_state || raw.state) === 'cancelled',
  }
}

export const rafflePhase = (r, nowMs = Date.now()) => {
  if (r.cancelled || r.state === 'cancelled') return { key: 'cancelled', label: 'Cancelled' }
  if (r.state === 'created') return { key: 'soon', label: 'Opens soon' }
  if (r.state === 'started') {
    if (r.endsAt && Date.parse(r.endsAt) <= nowMs) return { key: 'closed', label: 'Closed. Waiting for the draw.' }
    return { key: 'live', label: 'Open' }
  }
  if (r.state === 'closed') return { key: 'closed', label: 'Closed. Waiting for the draw.' }
  if (r.state === 'finished') return { key: 'drawn', label: 'Drawn' }
  if (r.state === 'claimed') return { key: 'sent', label: 'Prize sent' }
  return { key: 'unknown', label: r.state || 'Unknown' }
}
