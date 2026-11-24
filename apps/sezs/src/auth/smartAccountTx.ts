/**
 * x/smart-account register tx — pure encoders, no network, no keys.
 *
 * Mirrors permissionless.money lib/smart-account-tx.js + terp-website
 * lib/account-chain.js, and terp-core x/smart-account:
 *   MsgAddAuthenticator {sender=1, authenticator_type=2, data=3}
 *   AllOf / PartitionedAllOf data = JSON [{"type": t, "config": base64(bytes)}]
 *   CosmwasmAuthenticatorV1 config = JSON {"contract": addr, "params": base64(json)}
 *   SignatureVerification config = 33-byte compressed secp256k1 pubkey
 *
 * We use PartitionedAllOf, not AllOf: AllOf ("Single") hands the SAME signature
 * to every member. A passkey assertion and a secp256k1 signature differ, so the
 * tx signature must be a JSON array [passkeyPayload, browserKeySig] that the
 * partitioned variant splits per member.
 */

export const MSG_ADD_AUTHENTICATOR = '/terp.smartaccount.v1beta1.MsgAddAuthenticator'
export const PARTITIONED_ALL_OF = 'PartitionedAllOf'
export const COSMWASM_AUTH = 'CosmwasmAuthenticatorV1'
export const SIGNATURE_VERIFICATION = 'SignatureVerification'
const SECP_PUBKEY_URL = '/cosmos.crypto.secp256k1.PubKey'
const SIGN_MODE_DIRECT = 1

// ── protobuf primitives ────────────────────────────────────────────────────

const utf8 = (s: string) => new TextEncoder().encode(s)

function varint(n: number | bigint): number[] {
  let v = BigInt(n)
  const out: number[] = []
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80)
    v >>= 7n
  }
  out.push(Number(v))
  return out
}

export function cat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const fBytes = (no: number, bytes: Uint8Array) =>
  Uint8Array.from([...varint((no << 3) | 2), ...varint(bytes.length), ...bytes])
const fStr = (no: number, s: string) => fBytes(no, utf8(s))
const fVarint = (no: number, n: number | bigint) =>
  BigInt(n) === 0n ? new Uint8Array() : Uint8Array.from([...varint(no << 3), ...varint(n)])

export function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const anyOf = (typeUrl: string, value: Uint8Array) => cat([fStr(1, typeUrl), fBytes(2, value)])

// ── authenticator data ─────────────────────────────────────────────────────

/** Public passkey facts. Same shape as terp-passkey PasskeyRegistration (the development machine source). */
export type PasskeyParams = {
  origin: string
  rp_id: string
  /** base64 (std) credential id bytes */
  credential_id: string
  /** base64 SEC1 P-256 pubkey, uncompressed (65 bytes) */
  public_key: string
}

export function cosmwasmAuthConfig(contract: string, params: PasskeyParams): Uint8Array {
  return utf8(JSON.stringify({ contract, params: b64(utf8(JSON.stringify(params))) }))
}

export function partitionedAllOfData(subs: { type: string; config: Uint8Array }[]): Uint8Array {
  if (subs.length < 2) throw new Error('AllOf needs at least two members.')
  return utf8(JSON.stringify(subs.map((s) => ({ type: s.type, config: b64(s.config) }))))
}

export type RegisterPlan = {
  sender: string
  authenticatorType: string
  data: Uint8Array
  /** Human-readable view of what gets signed. Public facts only. */
  preview: {
    '@type': string
    sender: string
    authenticator_type: string
    members: { type: string; config: unknown }[]
  }
}

export function buildRegisterPlan(opts: {
  sender: string
  passkeyContract: string
  passkey: PasskeyParams
  browserPubkey: Uint8Array
}): RegisterPlan {
  if (opts.browserPubkey.length !== 33) throw new Error('Browser key must be a 33-byte secp256k1 pubkey.')
  const data = partitionedAllOfData([
    { type: COSMWASM_AUTH, config: cosmwasmAuthConfig(opts.passkeyContract, opts.passkey) },
    { type: SIGNATURE_VERIFICATION, config: opts.browserPubkey },
  ])
  return {
    sender: opts.sender,
    authenticatorType: PARTITIONED_ALL_OF,
    data,
    preview: {
      '@type': MSG_ADD_AUTHENTICATOR,
      sender: opts.sender,
      authenticator_type: PARTITIONED_ALL_OF,
      members: [
        { type: COSMWASM_AUTH, config: { contract: opts.passkeyContract, params: opts.passkey } },
        { type: SIGNATURE_VERIFICATION, config: b64(opts.browserPubkey) },
      ],
    },
  }
}

// ── tx assembly (SIGN_MODE_DIRECT) ─────────────────────────────────────────

export function encodeMsgAddAuthenticator(p: RegisterPlan): Uint8Array {
  return cat([fStr(1, p.sender), fStr(2, p.authenticatorType), fBytes(3, p.data)])
}

export function encodeTxBody(msgs: { typeUrl: string; value: Uint8Array }[], memo = ''): Uint8Array {
  const parts = msgs.map((m) => fBytes(1, anyOf(m.typeUrl, m.value)))
  if (memo) parts.push(fStr(2, memo))
  return cat(parts)
}

export function encodeAuthInfo(opts: {
  pubkey: Uint8Array
  sequence: number | bigint
  fee: { denom: string; amount: string; gasLimit: number; granter?: string }
}): Uint8Array {
  const pubAny = anyOf(SECP_PUBKEY_URL, fBytes(1, opts.pubkey))
  const modeInfo = fBytes(1, fVarint(1, SIGN_MODE_DIRECT)) // ModeInfo.single{mode}
  const signerInfo = cat([fBytes(1, pubAny), fBytes(2, modeInfo), fVarint(3, opts.sequence)])
  const coin = cat([fStr(1, opts.fee.denom), fStr(2, opts.fee.amount)])
  const fee = cat([
    fBytes(1, coin),
    fVarint(2, opts.fee.gasLimit),
    ...(opts.fee.granter ? [fStr(4, opts.fee.granter)] : []),
  ])
  return cat([fBytes(1, signerInfo), fBytes(2, fee)])
}

export function encodeTxRaw(bodyBytes: Uint8Array, authInfoBytes: Uint8Array, signatures: Uint8Array[]): Uint8Array {
  return cat([fBytes(1, bodyBytes), fBytes(2, authInfoBytes), ...signatures.map((s) => fBytes(3, s))])
}
