/**
 * Broadcast an already-signed tx on the loopback LCD only.
 * Never signs. Used for Zafu-signed ConsumeTicket (and similar) executes.
 */
const isLoopback = (url) => {
  try {
    const u = new URL(url)
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1"
  } catch {
    return false
  }
}

const toB64 = (value) => {
  if (!value) return ""
  if (typeof value === "string") {
    const s = value.trim()
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length > 64) {
      return Buffer.from(s, "hex").toString("base64")
    }
    return s
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString("base64")
  if (value.tx_bytes) return toB64(value.tx_bytes)
  if (value.txBytes) return toB64(value.txBytes)
  return ""
}

export const broadcastSignedTx = async ({ lcd, node, terpd, tx }) => {
  const rest = lcd || "http://127.0.0.1:1317"
  if (!isLoopback(rest)) return { ok: false, error: "lcd_refused" }
  const txBytes = toB64(tx)
  if (!txBytes) return { ok: false, error: "missing_signed_tx" }
  const res = await fetch(`${rest.replace(/\/$/, "")}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: txBytes, mode: "BROADCAST_MODE_SYNC" }),
  })
  const data = await res.json().catch(() => ({}))
  const resp = data.tx_response || data
  const txhash = String(resp.txhash || resp.tx_hash || "")
  const code = Number(resp.code || 0)
  if (!txhash) return { ok: false, error: resp.raw_log || data.message || "broadcast_failed" }
  if (code) return { ok: false, error: resp.raw_log || `code_${code}`, txhash }
  let height
  if (terpd && node && isLoopback(String(node).replace("tcp://", "http://"))) {
    const { spawnSync } = await import("node:child_process")
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 250))
      const q = spawnSync(terpd, ["q", "tx", txhash, "--node", node, "-o", "json"], { encoding: "utf8" })
      if (q.status === 0) {
        try {
          const body = JSON.parse(q.stdout || "{}")
          height = Number(body.height || body.tx_response?.height)
          const qCode = Number(body.code || body.tx_response?.code || 0)
          if (qCode) return { ok: false, error: body.raw_log || `code_${qCode}`, txhash, height }
          break
        } catch {}
      }
    }
  }
  return { ok: true, txhash, height }
}
