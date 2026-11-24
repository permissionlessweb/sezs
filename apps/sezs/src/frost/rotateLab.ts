/** Build and send rotate_frost_pubkey only to a loopback lab chain. */

const DENY = new Set([
  'morocco-1',
  'cosmoshub-4',
  'osmosis-1',
  'pacific-1',
  'pion-1',
])

export const LOCAL_LCD = 'http://127.0.0.1:1417'

type TxMsg = {
  '@type'?: string
  sender?: string
  contract?: string
  msg?: unknown
}

/** True only when this tx is rotate_frost_pubkey on this contract from this sender. */
export function isCommitteeRotateTx(
  tx: unknown,
  contract: string,
  sender: string
): boolean {
  const root = tx as { tx?: { body?: { messages?: TxMsg[] } } }
  const msgs = root?.tx?.body?.messages
  if (!Array.isArray(msgs)) return false
  return msgs.some((m) => {
    const ty = m['@type'] || ''
    if (!ty.endsWith('MsgExecuteContract')) return false
    if (m.sender !== sender || m.contract !== contract) return false
    const msg = m.msg
    if (msg && typeof msg === 'object' && 'rotate_frost_pubkey' in (msg as object)) return true
    return false
  })
}

export function labChainAllowed(network: string): boolean {
  const n = network.trim()
  if (!n || DENY.has(n)) return false
  return n.includes('local') || n.startsWith('sezs-frost')
}

export function rotateExecuteBody(args: {
  newVkCommit: string
  nextSeats?: string[]
  nextT?: number
  nextN?: number
}) {
  return {
    rotate_frost_pubkey: {
      new_vk_commit: args.newVkCommit,
      hkdf_commit: null,
      next_seats: args.nextSeats ?? null,
      next_t: args.nextT ?? null,
      next_n: args.nextN ?? null,
    },
  }
}

type FetchLike = typeof fetch

export async function findFrostContract(
  lcd = LOCAL_LCD,
  fetchImpl: FetchLike = fetch
): Promise<string | null> {
  if (!lcd.startsWith('http://127.0.0.1') && !lcd.startsWith('http://localhost')) return null
  try {
    const codes = await fetchImpl(`${lcd}/cosmwasm/wasm/v1/code`, {
      headers: { 'x-sezs-frost': '1' },
    })
    const body = (await codes.json()) as {
      code_infos?: { code_id?: string }[]
      codeInfos?: { code_id?: string }[]
    }
    const infos = body.code_infos || body.codeInfos || []
    for (const info of infos) {
      const id = info.code_id
      if (!id) continue
      const cons = await fetchImpl(`${lcd}/cosmwasm/wasm/v1/code/${id}/contracts`, {
        headers: { 'x-sezs-frost': '1' },
      })
      const listed = (await cons.json()) as { contracts?: string[] }
      for (const addr of listed.contracts || []) {
        const c = await fetchImpl(`${lcd}/cosmwasm/wasm/v1/contract/${addr}`, {
          headers: { 'x-sezs-frost': '1' },
        })
        if (!c.ok) continue
        const row = (await c.json()) as {
          contract_info?: { label?: string }
        }
        const label = row.contract_info?.label || ''
        if (label === 'terp-frost' || label === 'sezs-frost' || label === 'sezs-frost-rotate') return addr
      }
    }
  } catch {
    return null
  }
  return null
}

export async function submitRotateToLab(
  args: {
    lcd?: string
    contract: string
    newVkCommit: string
    nextSeats?: string[]
    nextT?: number
    nextN?: number
  },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; txhash: string } | { ok: false; error: string }> {
  const lcd = (args.lcd || LOCAL_LCD).replace(/\/$/, '')
  if (!lcd.startsWith('http://127.0.0.1') && !lcd.startsWith('http://localhost')) {
    return { ok: false, error: 'not_loopback' }
  }
  let network = ''
  try {
    const info = await fetchImpl(
      `${lcd}/cosmos/base/tendermint/v1beta1/node_info`,
      { headers: { 'x-sezs-frost': '1' } }
    )
    const body = (await info.json()) as {
      default_node_info?: { network?: string }
    }
    network = body.default_node_info?.network || ''
  } catch {
    return { ok: false, error: 'node_unreachable' }
  }
  if (!labChainAllowed(network)) return { ok: false, error: 'mainnet_refused' }

  let label = ''
  try {
    const c = await fetchImpl(
      `${lcd}/cosmwasm/wasm/v1/contract/${encodeURIComponent(args.contract)}`,
      { headers: { 'x-sezs-frost': '1' } }
    )
    if (!c.ok) return { ok: false, error: 'lab_contract_missing' }
    const body = (await c.json()) as {
      contract_info?: { label?: string }
      contractInfo?: { label?: string }
    }
    label = body.contract_info?.label || body.contractInfo?.label || ''
  } catch {
    return { ok: false, error: 'lab_contract_missing' }
  }
  if (label !== 'terp-frost' && label !== 'sezs-frost') {
    return { ok: false, error: 'lab_contract_missing' }
  }

  const msg = rotateExecuteBody(args)
  try {
    const res = await fetchImpl(`${lcd}/cosmwasm/wasm/v1/contract/${args.contract}/smart/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sezs-frost': '1',
      },
      body: JSON.stringify(msg),
    })
    const data = (await res.json()) as { txhash?: string; error?: string }
    if (!res.ok || !data.txhash) return { ok: false, error: data.error || 'execute_refused' }
    return { ok: true, txhash: data.txhash }
  } catch {
    return { ok: false, error: 'execute_refused' }
  }
}
