/**
 * In-process lab cast submit surface (V-UI-4).
 *
 * Models CosmWasm cast_shielded_vote accept rules for FE integration tests:
 * - reject privacy-leaking bodies
 * - require enc_share + nullifier
 * - fail-closed on spent nullifier (per round)
 * - optional lab mock proof verify when proof_mode is lab_mock_prove_v1
 * - store ciphertext for G-e2e query
 *
 * Not a full CosmWasm runtime — route-parity for stable lab usage.
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http'

import { findPrivacyLeaksInBody } from './castPayload'
import { bytesToHex, hexToBytes, isHexString } from './hex'
import { LAB_PROOF_MODE, verifyLabMockProof } from './labProveCast'
import { CAST_PI_WIRE_SIZE } from './publicInputs'
import { CIPHERTEXT_SIZE } from './types'

export type StoredCast = {
  roundId: string
  proposalId: number
  nullifierHex: string
  ciphertextHex: string
  proofMode?: string
  acceptedAt: number
}

export type LabCastServer = {
  baseUrl: string
  port: number
  contract: string
  close: () => Promise<void>
  /** roundId → nullifierHex → cast */
  spent: Map<string, Map<string, StoredCast>>
  casts: StoredCast[]
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(body))
}

function b64ToHex(b64: string): string {
  const buf =
    typeof Buffer !== 'undefined'
      ? Buffer.from(b64, 'base64')
      : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return bytesToHex(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
}

export async function startLabCastServer(opts?: {
  port?: number
  contract?: string
  /** When true, require valid lab mock proof. */
  requireLabProof?: boolean
}): Promise<LabCastServer> {
  const contract = opts?.contract ?? 'lab-cast-contract'
  const requireLabProof = opts?.requireLabProof ?? true
  const spent = new Map<string, Map<string, StoredCast>>()
  const casts: StoredCast[] = []

  const server: Server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      send(res, 204, {})
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    // Health
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, contract })
      return
    }

    // Query casts for round
    if (req.method === 'GET' && url.pathname.startsWith('/cast/')) {
      const roundId = decodeURIComponent(url.pathname.slice('/cast/'.length))
      const list = casts.filter((c) => c.roundId === roundId)
      send(res, 200, {
        roundId,
        count: list.length,
        casts: list.map((c) => ({
          nullifierHex: c.nullifierHex,
          ciphertextHex: c.ciphertextHex,
          proposalId: c.proposalId,
          proofMode: c.proofMode,
          // never plaintext
        })),
      })
      return
    }

    // Nullifier spent check
    if (req.method === 'GET' && url.pathname.startsWith('/nullifier/')) {
      // /nullifier/{roundId}/{nfHex}
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 3) {
        send(res, 400, { error: 'path /nullifier/{roundId}/{nfHex}' })
        return
      }
      const roundId = decodeURIComponent(parts[1]!)
      const nf = parts[2]!.toLowerCase()
      const isSpent = spent.get(roundId)?.has(nf) ?? false
      send(res, 200, { roundId, nullifierHex: nf, spent: isSpent })
      return
    }

    // Execute cast
    if (req.method === 'POST' && url.pathname === '/execute') {
      let raw: unknown
      try {
        raw = JSON.parse((await readBody(req)).toString('utf8'))
      } catch {
        send(res, 400, { error: 'invalid json' })
        return
      }

      const leaks = findPrivacyLeaksInBody(raw)
      if (leaks.length > 0) {
        send(res, 400, {
          error: 'privacy_leak',
          leaks,
          ok: false,
        })
        return
      }

      const cast =
        raw &&
        typeof raw === 'object' &&
        'cast_shielded_vote' in raw
          ? (raw as { cast_shielded_vote: Record<string, unknown> })
              .cast_shielded_vote
          : null
      if (!cast || typeof cast !== 'object') {
        send(res, 400, { error: 'missing cast_shielded_vote', ok: false })
        return
      }

      const roundId = String(cast.round_id ?? '').trim()
      if (!roundId) {
        send(res, 400, { error: 'round_id required', ok: false })
        return
      }

      let ciphertextHex: string
      let nullifierHex: string
      try {
        ciphertextHex = b64ToHex(String(cast.enc_share ?? ''))
        nullifierHex = b64ToHex(String(cast.van_nullifier ?? '')).toLowerCase()
      } catch {
        send(res, 400, { error: 'bad base64 fields', ok: false })
        return
      }

      if (!isHexString(ciphertextHex, CIPHERTEXT_SIZE)) {
        send(res, 400, { error: 'enc_share must be 64 bytes', ok: false })
        return
      }
      if (!isHexString(nullifierHex, 32)) {
        send(res, 400, { error: 'van_nullifier must be 32 bytes', ok: false })
        return
      }

      // Nullifier fail-closed
      if (!spent.has(roundId)) spent.set(roundId, new Map())
      const roundSpent = spent.get(roundId)!
      if (roundSpent.has(nullifierHex)) {
        send(res, 409, {
          ok: false,
          error: 'nullifier_already_spent',
          roundId,
          nullifierHex,
        })
        return
      }

      const proofMode =
        typeof cast.proof_mode === 'string' ? cast.proof_mode : undefined
      const publicInputsHex =
        typeof cast.public_inputs_hex === 'string'
          ? cast.public_inputs_hex
          : undefined

      if (requireLabProof && proofMode === LAB_PROOF_MODE) {
        if (!publicInputsHex || !isHexString(publicInputsHex, CAST_PI_WIRE_SIZE)) {
          send(res, 400, {
            ok: false,
            error: 'lab proof requires public_inputs_hex 288B',
          })
          return
        }
        let proofHex: string
        try {
          proofHex = b64ToHex(String(cast.proof ?? ''))
        } catch {
          send(res, 400, { ok: false, error: 'bad proof base64' })
          return
        }
        const v = await verifyLabMockProof({
          proofHex,
          publicInputsHex,
          ciphertextHex,
          nullifierHex,
        })
        if (!v.ok) {
          send(res, 400, { ok: false, error: 'proof_invalid', reason: v.reason })
          return
        }
      } else if (requireLabProof && !cast.proof) {
        send(res, 400, { ok: false, error: 'proof required' })
        return
      }

      const proposalId = Number(cast.proposal_id ?? 0) || 0
      const entry: StoredCast = {
        roundId,
        proposalId,
        nullifierHex,
        ciphertextHex: ciphertextHex.toLowerCase(),
        proofMode,
        acceptedAt: Date.now(),
      }
      roundSpent.set(nullifierHex, entry)
      casts.push(entry)

      send(res, 200, {
        ok: true,
        contract,
        roundId,
        nullifierHex,
        ciphertextHex: entry.ciphertextHex,
        status: 'accepted',
      })
      return
    }

    send(res, 404, { error: 'not found' })
  })

  const port = opts?.port ?? 0
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to bind lab cast server')
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    contract,
    spent,
    casts,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
