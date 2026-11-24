export type Coin = { denom: string; amount: string }

export type RaffleAsset = {
  kind: 'cw721' | 'coin' | 'unknown'
  address?: string
  tokenId?: string
  coin?: Coin
}

export type ChainRaffle = {
  raffleId: number
  state: string
  owner?: string
  ticketsSold: number
  maxTickets?: number
  minTickets?: number
  maxPerAddress?: number
  ticketPrice?: Coin
  startsAt?: string
  endsAt?: string
  comment?: string
  winners: string[]
  assets: RaffleAsset[]
  cancelled: boolean
}

export type RafflePhase = {
  key: 'soon' | 'live' | 'closed' | 'drawn' | 'sent' | 'cancelled' | 'unknown'
  label: string
}
