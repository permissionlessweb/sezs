import {
  getLcdForChainId,
  ibc,
  maybeGetChainForChainId,
  maybeGetChainForChainName,
} from '@dao-dao/utils'

import { TERP_IBC_CHAIN_NAMES } from './constants'
import { TerpIbcChannelRow } from './types'

const isTerpChainName = (name: string) =>
  TERP_IBC_CHAIN_NAMES.has(name.toLowerCase())

type IbcSide = {
  chain_name: string
  client_id: string
  connection_id: string
  chain_id?: string
}

type IbcChannelSide = {
  channel_id: string
  port_id: string
}

/**
 * List transfer channels involving Terp from the curated chain-registry `ibc`
 * export (patched from terp-state.json).
 */
export const listTerpIbcChannels = (
  terpChainId = 'morocco-1'
): TerpIbcChannelRow[] => {
  const rows: TerpIbcChannelRow[] = []

  for (const info of ibc) {
    const c1IsTerp = isTerpChainName(info.chain_1.chain_name)
    const c2IsTerp = isTerpChainName(info.chain_2.chain_name)
    if (!c1IsTerp && !c2IsTerp) {
      continue
    }

    const terpSide = c1IsTerp ? 1 : 2
    const otherSide = terpSide === 1 ? 2 : 1
    const terpMeta = info[`chain_${terpSide as 1 | 2}`] as IbcSide
    const otherMeta = info[`chain_${otherSide as 1 | 2}`] as IbcSide

    // Prefer morocco-1 when chain_id is present on the entry.
    if (terpMeta.chain_id && terpMeta.chain_id !== terpChainId) {
      continue
    }

    for (const channel of info.channels ?? []) {
      const terpCh = channel[`chain_${terpSide as 1 | 2}`] as IbcChannelSide
      const otherCh = channel[`chain_${otherSide as 1 | 2}`] as IbcChannelSide
      if (!terpCh || !otherCh) {
        continue
      }

      // Prefer ICS20 transfer paths for the dashboard default list.
      const isTransfer =
        terpCh.port_id === 'transfer' &&
        (channel.version === 'ics20-1' || !channel.version)

      if (!isTransfer) {
        continue
      }

      const tags = (
        channel as { tags?: { preferred?: boolean; status?: string } }
      ).tags

      const otherChain =
        maybeGetChainForChainName(otherMeta.chain_name) ||
        (otherMeta.chain_id
          ? maybeGetChainForChainId(otherMeta.chain_id)
          : undefined)

      rows.push({
        counterpartyName: otherMeta.chain_name,
        counterpartyChainId: otherChain?.chainId || otherMeta.chain_id,
        sourceChannel: terpCh.channel_id,
        destinationChannel: otherCh.channel_id,
        sourceClientId: terpMeta.client_id,
        destinationClientId: otherMeta.client_id,
        sourceConnectionId: terpMeta.connection_id,
        version: channel.version || 'ics20-1',
        preferred: !!tags?.preferred,
        status: tags?.status,
        port: terpCh.port_id || 'transfer',
      })
    }
  }

  // Preferred first, then by counterparty name.
  return rows.sort((a, b) => {
    if (a.preferred !== b.preferred) {
      return a.preferred ? -1 : 1
    }
    return a.counterpartyName.localeCompare(b.counterpartyName)
  })
}

/**
 * Fetch live IBC client status from LCD for a single client id.
 */
export const fetchIbcClientStatus = async (
  chainId: string,
  clientId: string
): Promise<string> => {
  const lcd = getLcdForChainId(chainId)
  const url = `${lcd.replace(/\/$/, '')}/ibc/core/client/v1/client_status/${encodeURIComponent(clientId)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`client_status ${res.status}`)
  }
  const json = (await res.json()) as { status?: string }
  return json.status || 'Unknown'
}

/**
 * Enrich channel rows with live Terp-side client status (batched, best-effort).
 */
export const enrichChannelsWithClientStatus = async (
  chainId: string,
  rows: TerpIbcChannelRow[]
): Promise<TerpIbcChannelRow[]> => {
  const uniqueClients = [
    ...new Set(rows.map((r) => r.sourceClientId).filter(Boolean)),
  ]
  const statusByClient = new Map<string, string>()

  await Promise.all(
    uniqueClients.map(async (clientId) => {
      try {
        const status = await fetchIbcClientStatus(chainId, clientId)
        statusByClient.set(clientId, status)
      } catch {
        statusByClient.set(clientId, 'unavailable')
      }
    })
  )

  return rows.map((row) => ({
    ...row,
    clientStatus: statusByClient.get(row.sourceClientId),
  }))
}

export const shortAddress = (addr: string, left = 8, right = 6) => {
  if (!addr || addr.length <= left + right + 3) {
    return addr
  }
  return `${addr.slice(0, left)}…${addr.slice(-right)}`
}
