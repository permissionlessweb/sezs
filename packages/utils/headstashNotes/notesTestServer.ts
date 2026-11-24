/**
 * In-process notes server implementing the same HTTP routes as hash-market
 * HeadstashStore notes handlers — for G-integration / G-e2e (not a mock that
 * skips PIR). Real XOR PIR + equal-pad + sorted keys + bearer auth.
 *
 * Routes:
 *   GET  /notes/{hs_id}
 *   PUT  /notes/{hs_id}/{addr}
 *   GET  /notes/{hs_id}/{addr}
 *   POST /notes/{hs_id}/pir
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { bytesToHex } from './hex'
import type { NoteEnvelope } from './types'

export type NotesTestServer = {
  baseUrl: string
  port: number
  token: string
  close: () => Promise<void>
  /** Internal store for assertions. */
  store: Map<string, Map<string, string>>
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(
  res: ServerResponse,
  status: number,
  body: string | object,
  contentType = 'application/json'
) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  })
  res.end(data)
}

/** XOR PIR over equal-length blobs (matches hash-market pir::xor_pir). */
export function xorPir(blobs: Uint8Array[], selector: number[]): Uint8Array {
  if (blobs.length !== selector.length) {
    throw new Error(
      `selector length (${selector.length}) != blobs count (${blobs.length})`
    )
  }
  if (blobs.length === 0) return new Uint8Array(0)
  const blobLen = blobs[0]!.length
  const result = new Uint8Array(blobLen)
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i]!
    if (blob.length !== blobLen) {
      throw new Error(`blob ${i} length mismatch`)
    }
    if (selector[i] !== 0) {
      for (let j = 0; j < blobLen; j++) {
        result[j] ^= blob[j]!
      }
    }
  }
  return result
}

function requireAuth(
  req: IncomingMessage,
  token: string
): boolean {
  const h = req.headers.authorization
  if (!h) return false
  const expected = token.toLowerCase().startsWith('bearer ')
    ? token
    : `Bearer ${token}`
  return h === expected || h === `Bearer ${token}`
}

/**
 * Start an in-process notes server. Uses ephemeral port.
 * Auth: Bearer token required on all notes routes (matches production default).
 */
export async function startNotesTestServer(opts?: {
  token?: string
  port?: number
}): Promise<NotesTestServer> {
  const token = opts?.token ?? 'test-token'
  // hs_id → (addr → envelope JSON string)
  const store = new Map<string, Map<string, string>>()

  const server: Server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }

    const url = new URL(req.url || '/', `http://127.0.0.1`)
    const parts = url.pathname.split('/').filter(Boolean)

    // /notes/{hs_id} or /notes/{hs_id}/{addr} or /notes/{hs_id}/pir
    if (parts[0] !== 'notes' || parts.length < 2) {
      send(res, 404, { error: 'not found' })
      return
    }

    if (!requireAuth(req, token)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    const hsId = decodeURIComponent(parts[1]!)
    if (!store.has(hsId)) store.set(hsId, new Map())
    const notes = store.get(hsId)!

    try {
      // GET /notes/{hs}
      if (parts.length === 2 && req.method === 'GET') {
        const keys = [...notes.keys()].sort()
        send(res, 200, { keys })
        return
      }

      // POST /notes/{hs}/pir
      if (parts.length === 3 && parts[2] === 'pir' && req.method === 'POST') {
        const raw = await readBody(req)
        const body = JSON.parse(raw.toString('utf8')) as {
          selector?: number[]
        }
        if (!Array.isArray(body.selector)) {
          send(res, 400, { error: 'selector required' })
          return
        }
        const keys = [...notes.keys()].sort()
        const rawBlobs = keys.map((k) =>
          Buffer.from(notes.get(k)!, 'utf8')
        )
        const maxLen = rawBlobs.reduce((m, b) => Math.max(m, b.length), 0)
        const blobs = rawBlobs.map((b) => {
          const padded = new Uint8Array(maxLen)
          padded.set(b)
          return padded
        })
        const result = xorPir(blobs, body.selector)
        send(res, 200, { result: bytesToHex(result) })
        return
      }

      // GET|PUT /notes/{hs}/{addr}
      if (parts.length === 3 && parts[2] !== 'pir') {
        const addr = decodeURIComponent(parts[2]!)
        if (req.method === 'GET') {
          const json = notes.get(addr)
          if (!json) {
            send(res, 404, { error: 'not found' })
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(json)
          return
        }
        if (req.method === 'PUT') {
          const raw = await readBody(req)
          const env = JSON.parse(raw.toString('utf8')) as NoteEnvelope
          if (
            !env.ciphertext ||
            !env.nonce ||
            !env.scheme ||
            !env.cleartext_layout ||
            typeof env.cleartext_len !== 'number'
          ) {
            send(res, 400, { error: 'invalid envelope' })
            return
          }
          // compact JSON like serde_json::to_vec
          notes.set(addr, JSON.stringify(env))
          send(res, 201, env)
          return
        }
      }

      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts?.port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('no port'))
    })
  })

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    token,
    store,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
