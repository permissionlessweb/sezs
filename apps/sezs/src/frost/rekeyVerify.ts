/** Local Zcash node only. Never a public or mainnet RPC. */
export const LOCAL_ZEC_RPC = 'http://127.0.0.1:18232'

export function loopbackHttp(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:') return false
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}

export async function verifyRekeyTx(
  txid: string,
  rpc = LOCAL_ZEC_RPC,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; confirmations: number } | { ok: false; error: string }> {
  const t = txid.trim().toLowerCase()
  if (t.length !== 64 || ![...t].every((c) => '0123456789abcdef'.includes(c))) {
    return { ok: false, error: 'fixture_txid' }
  }
  if (t === 'a'.repeat(64) || t === '0'.repeat(64)) return { ok: false, error: 'fixture_txid' }
  if (!loopbackHttp(rpc)) return { ok: false, error: 'not_loopback' }
  let data: { error?: { message?: string }; result?: { confirmations?: number } }
  try {
    const res = await fetchImpl(rpc, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sezs-frost': '1',
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: '1',
        method: 'getrawtransaction',
        params: [t, 1],
      }),
    })
    data = (await res.json()) as typeof data
  } catch {
    return { ok: false, error: 'node_unreachable' }
  }
  if (data.error) return { ok: false, error: 'fixture_txid' }
  const conf = data.result?.confirmations ?? 0
  if (conf < 1) return { ok: false, error: 'rekey_unconfirmed' }
  return { ok: true, confirmations: conf }
}
