/**
 * Node loader for the ticket v2 wasm (splash backend tree builder, tests).
 * Build first: apps/sezs/scripts/build-ticket-v2-wasm.sh
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wrap } from './index.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const NODE_PKG = process.env.SEZS_TICKET_V2_NODE_PKG || join(APP, '.zk/sezs-ticket-v2/node/sezs_ticket_v2_wasm.js')

let cached = null
export const ticketV2WasmAvailable = () => existsSync(NODE_PKG)
export const loadTicketV2Node = () => {
  if (cached) return cached
  if (!existsSync(NODE_PKG)) throw new Error(`ticket v2 wasm not built: run apps/sezs/scripts/build-ticket-v2-wasm.sh (${NODE_PKG})`)
  cached = wrap(createRequire(import.meta.url)(NODE_PKG))
  return cached
}
