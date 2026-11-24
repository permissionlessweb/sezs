/**
 * Artist collections → prepared escrow authorizations. Read-only.
 *
 * Nothing here signs or broadcasts. Type detection is a read (Terp REST smart
 * query, or EVM eth_call supportsInterface when an RPC is configured); when it
 * cannot run, the artist picks the type and the row says so.
 * Escrow addresses come only from env. Unset ⇒ "escrow not created yet" and the
 * sign button stays disabled. Spec: grok-bot/sezs/GALLERY-ESCROW-SPEC-2026-10-12.md §2.2.
 */
import { FormEvent, useEffect, useState } from 'react'

import { CHAIN } from '../auth/chainConfig'

export type ChainId = 'terp' | 'ethereum' | 'base'
export type Kind = 'cw721' | 'erc721' | 'erc1155'
export type Adapter = 'custody' | 'minter'

const ESCROW: Record<ChainId, string> = {
  terp: process.env.NEXT_PUBLIC_SEZS_ESCROW_TERP || '',
  ethereum: process.env.NEXT_PUBLIC_SEZS_ESCROW_ETH || '',
  base: process.env.NEXT_PUBLIC_SEZS_ESCROW_BASE || '',
}
const EVM_RPC: Record<'ethereum' | 'base', string> = {
  ethereum: process.env.NEXT_PUBLIC_SEZS_ETH_RPC || '',
  base: process.env.NEXT_PUBLIC_SEZS_BASE_RPC || '',
}
const CHAIN_LABEL: Record<ChainId, string> = { terp: 'Terp', ethereum: 'Ethereum', base: 'Base' }

type Detect = { kind?: Kind; how: 'detected' | 'chosen' | 'failed'; note: string }
export type Row = { chain: ChainId; addr: string; kind: Kind; adapter: Adapter; detect: Detect }

export const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)
export const isTerpContract = (a: string) => /^terp1[02-9ac-hj-np-z]{58}$/.test(a)

const b64json = (o: unknown) => btoa(JSON.stringify(o))

async function detectTerp(addr: string): Promise<Detect> {
  try {
    const r = await fetch(
      `${CHAIN.rest}/cosmwasm/wasm/v1/contract/${addr}/smart/${b64json({ num_tokens: {} })}`,
      { credentials: 'omit' }
    )
    if (r.ok) return { kind: 'cw721', how: 'detected', note: `Answers cw721 num_tokens on ${CHAIN.rest}.` }
    return { how: 'failed', note: `Not a cw721 at ${CHAIN.rest} (HTTP ${r.status}). Check the address.` }
  } catch {
    return { how: 'failed', note: `Could not reach ${CHAIN.rest}. Type not checked.` }
  }
}

async function supports(rpc: string, addr: string, iface: string): Promise<boolean> {
  const data = '0x01ffc9a7' + iface.replace(/^0x/, '').padEnd(64, '0')
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addr, data }, 'latest'] }),
  })
  const j = await r.json()
  return typeof j.result === 'string' && /1$/.test(j.result)
}

async function detectEvm(chain: 'ethereum' | 'base', addr: string): Promise<Detect> {
  const rpc = EVM_RPC[chain]
  if (!rpc) return { how: 'chosen', note: `No ${CHAIN_LABEL[chain]} RPC configured. Type not checked; pick it.` }
  try {
    if (await supports(rpc, addr, '0x80ac58cd')) return { kind: 'erc721', how: 'detected', note: 'ERC-165 says ERC-721.' }
    if (await supports(rpc, addr, '0xd9b67a26')) return { kind: 'erc1155', how: 'detected', note: 'ERC-165 says ERC-1155.' }
    return { how: 'failed', note: 'Contract does not report ERC-721 or ERC-1155. Pick the type if you know it.' }
  } catch {
    return { how: 'chosen', note: `${CHAIN_LABEL[chain]} RPC did not answer. Type not checked; pick it.` }
  }
}

const pad32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

/** Exactly what the artist would sign. */
export function authorization(r: Row): { action: string; grants: string; payload: string } {
  const to = ESCROW[r.chain] || '(escrow address, once created)'
  if (r.kind === 'cw721') {
    if (r.adapter === 'minter')
      return {
        action: 'Hand minting to the escrow',
        grants: `The escrow (${to}) becomes this collection's minter. It mints a new token to the buyer when you release a sale. You stop being the minter until it hands the role back.`,
        payload: JSON.stringify({ contract: r.addr, msg: { update_minter_ownership: { transfer_ownership: { new_owner: to, expiry: null } } } }, null, 1),
      }
    return {
      action: 'Let the escrow move your tokens in this collection',
      grants: `The escrow (${to}) may transfer any token you own in this collection, only to complete a sale you released or to return it to you. You keep ownership until then. You can revoke it.`,
      payload: JSON.stringify({ contract: r.addr, msg: { approve_all: { operator: to, expires: null } } }, null, 1),
    }
  }
  if (r.adapter === 'minter')
    return {
      action: 'Grant the escrow a minter role',
      grants: `The escrow (${to}) may mint in this collection. The exact call depends on the contract (for OpenZeppelin AccessControl: grantRole(MINTER_ROLE, escrow)). We confirm the function with you before you sign.`,
      payload: `${r.addr}\ngrantRole(bytes32 role, address account)  // role and function confirmed per contract`,
    }
  const calldata = ESCROW[r.chain] ? '0xa22cb465' + pad32(ESCROW[r.chain]) + pad32('1') : '(available once the escrow exists)'
  return {
    action: 'Let the escrow move your tokens in this collection',
    grants: `setApprovalForAll: the escrow (${to}) may transfer any ${r.kind === 'erc1155' ? 'token or edition' : 'token'} you own in this collection, only to complete a sale you released or to return it to you. You can revoke it with setApprovalForAll(escrow, false).`,
    payload: `to: ${r.addr}\nsetApprovalForAll(address operator, bool approved) = (${to}, true)\ncalldata: ${calldata}`,
  }
}

export function CollectionsPrep({
  seed,
  onChange,
}: {
  seed?: Array<Pick<Row, 'chain' | 'addr' | 'kind' | 'adapter'>>
  onChange?: (rows: Row[]) => void
} = {}) {
  const [chain, setChain] = useState<ChainId>('terp')
  const [addr, setAddr] = useState('')
  const [manual, setManual] = useState<Kind>('erc721')
  const [rows, setRows] = useState<Row[]>(() =>
    (seed || []).map((r) => ({
      ...r,
      detect: { how: 'chosen' as const, note: 'Loaded from the showcase draft. Type not re-checked.' },
    }))
  )
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const put = (next: Row[]) => {
    setRows(next)
    onChange?.(next)
  }

  useEffect(() => {
    onChange?.(rows)
    // seed → parent once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    const a = addr.trim()
    if (chain === 'terp' ? !isTerpContract(a) : !isEvm(a)) {
      setErr(chain === 'terp' ? 'A Terp contract address starts with terp1 and is 63 characters.' : 'An EVM address is 0x plus 40 hex characters.')
      return
    }
    if (rows.some((r) => r.chain === chain && r.addr.toLowerCase() === a.toLowerCase())) {
      setErr('That collection is already on the list.')
      return
    }
    setBusy(true)
    const detect = chain === 'terp' ? await detectTerp(a) : await detectEvm(chain, a)
    setBusy(false)
    const kind: Kind = detect.kind || (chain === 'terp' ? 'cw721' : manual)
    if (!detect.kind && detect.how === 'chosen') detect.note += ` Using: ${kind.toUpperCase()}.`
    put([...rows, { chain, addr: a, kind, adapter: 'custody', detect }])
    setAddr('')
  }

  const set = (i: number, p: Partial<Row>) => put(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const anyEscrow = rows.some((r) => !!ESCROW[r.chain])

  return (
    <div className="gx-panel" style={{ marginTop: '1rem' }}>
      <h2>Your collections</h2>
      <p className="gx-note">
        Add the collections you sell from. For each one we prepare a single authorization for the gallery escrow. Nothing is signed or sent from this page.
      </p>
      <form onSubmit={add} style={{ display: 'grid', gap: '.5rem', marginTop: '.75rem' }}>
        <label>
          Chain{' '}
          <select className="field" value={chain} onChange={(e) => setChain(e.target.value as ChainId)}>
            <option value="terp">Terp (cw721)</option>
            <option value="ethereum">Ethereum (ERC-721 / ERC-1155)</option>
            <option value="base">Base (ERC-721 / ERC-1155)</option>
          </select>
        </label>
        <label>
          Contract address{' '}
          <input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={chain === 'terp' ? 'terp1…' : '0x…'} spellCheck={false} autoComplete="off" />
        </label>
        {chain !== 'terp' && !EVM_RPC[chain] ? (
          <label>
            Type (not auto-detected: no {CHAIN_LABEL[chain]} RPC configured){' '}
            <select className="field" value={manual} onChange={(e) => setManual(e.target.value as Kind)}>
              <option value="erc721">ERC-721</option>
              <option value="erc1155">ERC-1155</option>
            </select>
          </label>
        ) : null}
        <button className="btn btn-sm" type="submit" disabled={busy || !addr.trim()}>{busy ? 'Checking…' : 'Add collection'}</button>
        {err ? <p className="gx-note" role="alert">{err}</p> : null}
      </form>

      {rows.length ? (
        <ol style={{ marginTop: '1rem', paddingLeft: '1.2rem' }}>
          {rows.map((r, i) => {
            const z = authorization(r)
            return (
              <li key={r.chain + r.addr} style={{ marginBottom: '1rem' }}>
                <strong>{CHAIN_LABEL[r.chain]} · {r.kind.toUpperCase()}</strong>{' '}
                <span className="gx-tag">{r.detect.how === 'detected' ? 'type detected' : r.detect.how === 'failed' ? 'type not confirmed' : 'type chosen by you'}</span>
                <div className="gx-note" style={{ wordBreak: 'break-all' }}>{r.addr}</div>
                <div className="gx-note">{r.detect.note}</div>
                <label className="gx-note">
                  How the escrow gets the work{' '}
                  <select className="field" value={r.adapter} onChange={(e) => set(i, { adapter: e.target.value as Adapter })}>
                    <option value="custody">Move existing tokens (approval)</option>
                    <option value="minter">Mint new tokens (minter role)</option>
                  </select>
                </label>
                <p style={{ margin: '.4rem 0 .2rem' }}><b>{z.action}</b></p>
                <p className="gx-note">{z.grants}</p>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '.75rem', opacity: 0.85 }}>{z.payload}</pre>
                <button className="btn ghost btn-sm" type="button" onClick={() => put(rows.filter((_, j) => j !== i))}>Remove</button>
              </li>
            )
          })}
        </ol>
      ) : null}

      <button className="btn" type="button" disabled style={{ marginTop: '.5rem' }}>
        Sign authorizations
      </button>
      <p className="gx-note" style={{ marginTop: '.5rem' }}>
        {anyEscrow ? 'Signing opens after your registration is confirmed.' : 'Signing opens once the gallery escrow is created. Your list is kept on this page only.'}
      </p>
    </div>
  )
}
