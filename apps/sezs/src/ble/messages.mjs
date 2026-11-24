/**
 * Canonical SEZS usher-device messages and domain-separation tags.
 *
 * Three texts, all UTF-8, LF line endings, no trailing spaces, no trailing
 * newline after the last field. The first line is the domain tag.
 *
 *   SEZS-DEVICE-GRANT-V1     admin ADR-36 (signArbitrary) over the text
 *   SEZS-TICKET-FRAME-V1     device ed25519 over the raw text bytes
 *   SEZS-CONSUME-V3-DEVICE   usher or admin ADR-36 over the text
 *                            (or the lab typ secp256k1-sha256)
 *
 * Existing SEZS-CONSUME-V3 (usher-auth.mjs) is unchanged for the on-page
 * camera path. The device path uses SEZS-CONSUME-V3-DEVICE so a consume
 * that arrived over BLE must bind the grant and the frame signature.
 */
import { sha256 } from '@noble/hashes/sha256'
import { ed25519 } from '@noble/curves/ed25519'

export const GRANT_DOMAIN = 'SEZS-DEVICE-GRANT-V1'
export const FRAME_DOMAIN = 'SEZS-TICKET-FRAME-V1'
export const CONSUME_DEVICE_DOMAIN = 'SEZS-CONSUME-V3-DEVICE'
export const CAP_SCAN_TICKET = 'scan-ticket'

export const utf8 = (s) => new TextEncoder().encode(s)
export const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
export const unhex = (s) => {
  const t = String(s || '').trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]*$/.test(t) || t.length % 2) throw new Error('bad hex')
  return Uint8Array.from(t.match(/.{2}/g) || [], (h) => parseInt(h, 16))
}
export const sha256Hex = (bytes) => hex(sha256(bytes instanceof Uint8Array ? bytes : utf8(String(bytes))))

const isHex = (s, n) => new RegExp(`^[0-9a-f]{${n}}$`, 'i').test(String(s || ''))
export const isTerpAddr = (s) => /^terp1[0-9a-z]{38,}$/i.test(String(s || ''))
export const isUnifiedAddr = (s) => /^u1[a-z0-9]{50,}$/i.test(String(s || ''))
export const isRoleAddr = (s) => isTerpAddr(s) || isUnifiedAddr(s)
const isAddr = isTerpAddr
const isContract = (s) => s === '-' || s === '' || isTerpAddr(s)
const normHex = (s) => String(s || '').trim().toLowerCase()
const isCapList = (s) => String(s || '').split(',').map((x) => x.trim()).includes(CAP_SCAN_TICKET)

/** First 8 bytes of sha256(event id), 16 hex chars. Matches guest-qr event tags. */
export const eventTagHex = (eventId) => sha256Hex(utf8(String(eventId))).slice(0, 16)

const field = (lines, prefix) => {
  const line = lines.find((l) => l.startsWith(prefix))
  if (!line) throw new Error(`missing ${prefix}`)
  return line.slice(prefix.length).trim()
}

const join = (lines) => lines.join('\n')

export const encodeGrant = ({
  deviceSignPubkey,
  deviceNoiseStatic,
  usher,
  eventId,
  contract = '-',
  capabilities = CAP_SCAN_TICKET,
  expiry,
  nonce,
}) => {
  const sign = normHex(deviceSignPubkey)
  const noise = normHex(deviceNoiseStatic)
  const caps = String(capabilities || CAP_SCAN_TICKET).trim()
  const n = normHex(nonce)
  const exp = Number(expiry)
  const ctr = contract && String(contract).trim() ? String(contract).trim() : '-'
  if (!isHex(sign, 64)) throw new Error('device_sign_pubkey must be 32-byte hex')
  if (!isHex(noise, 64)) throw new Error('device_noise_static must be 32-byte hex')
  if (!isAddr(usher)) throw new Error('bad usher address')
  if (!eventId) throw new Error('event required')
  if (!isContract(ctr)) throw new Error('bad contract')
  if (!isCapList(caps)) throw new Error('capabilities must include scan-ticket')
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('expiry required')
  if (!isHex(n, 64)) throw new Error('nonce must be 32-byte hex')
  const text = join([
    GRANT_DOMAIN,
    `device_sign_pubkey: ${sign}`,
    `device_noise_static: ${noise}`,
    `usher: ${usher}`,
    `event: ${eventId}`,
    `contract: ${ctr}`,
    `capabilities: ${caps}`,
    `expiry: ${Math.floor(exp)}`,
    `nonce: ${n}`,
  ])
  return { text, bytes: utf8(text), hash: sha256Hex(utf8(text)) }
}

export const decodeGrant = (bytesOrText) => {
  const text = typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder().decode(bytesOrText)
  const lines = text.split('\n')
  if (lines[0] !== GRANT_DOMAIN) throw new Error('bad grant domain')
  const body = {
    deviceSignPubkey: field(lines, 'device_sign_pubkey: '),
    deviceNoiseStatic: field(lines, 'device_noise_static: '),
    usher: field(lines, 'usher: '),
    eventId: field(lines, 'event: '),
    contract: field(lines, 'contract: '),
    capabilities: field(lines, 'capabilities: '),
    expiry: Number(field(lines, 'expiry: ')),
    nonce: field(lines, 'nonce: '),
  }
  // Round-trip through encode so typo'd or reordered texts are rejected.
  const again = encodeGrant(body)
  if (again.text !== text) throw new Error('grant not canonical')
  return { ...body, text, bytes: again.bytes, hash: again.hash }
}

export const encodeFrame = ({
  grantHash,
  deviceSignPubkey,
  eventId,
  eventTag,
  seq,
  ts,
  payload,
}) => {
  const gh = normHex(grantHash)
  const pk = normHex(deviceSignPubkey)
  const tag = eventTag != null ? normHex(eventTag) : eventTagHex(eventId)
  const s = Number(seq)
  const t = Number(ts)
  const body = String(payload || '').trim()
  if (!isHex(gh, 64)) throw new Error('grant_hash must be 32-byte hex')
  if (!isHex(pk, 64)) throw new Error('device_sign_pubkey must be 32-byte hex')
  if (!eventId) throw new Error('event required')
  if (!isHex(tag, 16)) throw new Error('event_tag must be 8-byte hex')
  if (!Number.isInteger(s) || s < 1) throw new Error('seq must be a positive integer')
  if (!Number.isFinite(t) || t <= 0) throw new Error('ts required')
  if (!/^sezs3[0-9a-z]+$/i.test(body)) throw new Error('payload must be a sezs3 code')
  const text = join([
    FRAME_DOMAIN,
    `grant_hash: ${gh}`,
    `device_sign_pubkey: ${pk}`,
    `event: ${eventId}`,
    `event_tag: ${tag}`,
    `seq: ${s}`,
    `ts: ${Math.floor(t)}`,
    `payload: ${body}`,
  ])
  return { text, bytes: utf8(text), hash: sha256Hex(utf8(text)) }
}

export const decodeFrame = (bytesOrText) => {
  const text = typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder().decode(bytesOrText)
  const lines = text.split('\n')
  if (lines[0] !== FRAME_DOMAIN) throw new Error('bad frame domain')
  const body = {
    grantHash: field(lines, 'grant_hash: '),
    deviceSignPubkey: field(lines, 'device_sign_pubkey: '),
    eventId: field(lines, 'event: '),
    eventTag: field(lines, 'event_tag: '),
    seq: Number(field(lines, 'seq: ')),
    ts: Number(field(lines, 'ts: ')),
    payload: field(lines, 'payload: '),
  }
  const again = encodeFrame(body)
  if (again.text !== text) throw new Error('frame not canonical')
  return { ...body, text, bytes: again.bytes, hash: again.hash }
}

export const encodeConsumeDevice = ({
  usher,
  eventId,
  nullifier,
  root,
  proofHash,
  expiry,
  grantHash,
  frameHash,
  frameSig,
  frameSeq,
}) => {
  if (!isAddr(usher)) throw new Error('bad usher address')
  if (!eventId) throw new Error('event required')
  if (!isHex(nullifier, 64) || !isHex(root, 64) || !isHex(proofHash, 64)) {
    throw new Error('nullifier, root, and proof_hash must be 32-byte hex')
  }
  const exp = Number(expiry)
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('expiry required')
  if (!isHex(grantHash, 64) || !isHex(frameHash, 64)) throw new Error('grant_hash and frame_hash must be 32-byte hex')
  if (!isHex(frameSig, 128)) throw new Error('frame_sig must be 64-byte hex')
  const seq = Number(frameSeq)
  if (!Number.isInteger(seq) || seq < 1) throw new Error('frame_seq must be a positive integer')
  const text = join([
    CONSUME_DEVICE_DOMAIN,
    `usher: ${usher}`,
    `event: ${eventId}`,
    `nullifier: ${normHex(nullifier)}`,
    `root: ${normHex(root)}`,
    `proof_hash: ${normHex(proofHash)}`,
    `expiry: ${Math.floor(exp)}`,
    `grant_hash: ${normHex(grantHash)}`,
    `frame_hash: ${normHex(frameHash)}`,
    `frame_sig: ${normHex(frameSig)}`,
    `frame_seq: ${seq}`,
  ])
  return { text, bytes: utf8(text), hash: sha256Hex(utf8(text)) }
}

export const decodeConsumeDevice = (bytesOrText) => {
  const text = typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder().decode(bytesOrText)
  const lines = text.split('\n')
  if (lines[0] !== CONSUME_DEVICE_DOMAIN) throw new Error('bad consume domain')
  const body = {
    usher: field(lines, 'usher: '),
    eventId: field(lines, 'event: '),
    nullifier: field(lines, 'nullifier: '),
    root: field(lines, 'root: '),
    proofHash: field(lines, 'proof_hash: '),
    expiry: Number(field(lines, 'expiry: ')),
    grantHash: field(lines, 'grant_hash: '),
    frameHash: field(lines, 'frame_hash: '),
    frameSig: field(lines, 'frame_sig: '),
    frameSeq: Number(field(lines, 'frame_seq: ')),
  }
  const again = encodeConsumeDevice(body)
  if (again.text !== text) throw new Error('consume not canonical')
  return { ...body, text, bytes: again.bytes, hash: again.hash }
}

export const newDeviceKey = () => {
  const secret = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(secret)
  return { secret, publicKey, publicHex: hex(publicKey) }
}

/** Pure Ed25519 over the canonical frame bytes (domain tag included). */
export const signFrame = (frameBytes, secret) => hex(ed25519.sign(frameBytes, secret))

export const verifyFrameSig = (frameBytes, sigHex, publicHex) => {
  try {
    return ed25519.verify(unhex(sigHex), frameBytes, unhex(publicHex))
  } catch {
    return false
  }
}

export const newNonce = () => hex(crypto.getRandomValues(new Uint8Array(32)))

export const USHER_REG_DOMAIN = 'SEZS-USHER-REG-V1'
export const USHER_ID_DOMAIN = 'SEZS-USHER-ID-V1'

export const encodeUsherReg = ({ eventId, usher, terp = '-', zid = '-', expiry, nonce }) => {
  if (!eventId) throw new Error('event required')
  if (!isTerpAddr(usher)) throw new Error('bad usher address')
  const taddr = !terp || terp === '-' ? '-' : String(terp).trim()
  const z = !zid || zid === '-' ? '-' : String(zid).trim().toLowerCase()
  if (taddr !== '-' && !isTerpAddr(taddr)) throw new Error('bad terp address')
  if (z !== '-' && !/^[0-9a-f]{64}$/i.test(z)) throw new Error('bad zid')
  const exp = Number(expiry)
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('expiry required')
  const n = String(nonce || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(n)) throw new Error('nonce must be 32-byte hex')
  const text = [
    USHER_REG_DOMAIN,
    `event: ${eventId}`,
    `usher: ${usher}`,
    `terp: ${taddr}`,
    `zid: ${z}`,
    `expiry: ${Math.floor(exp)}`,
    `nonce: ${n}`,
  ].join('\n')
  return { text, bytes: utf8(text), hash: sha256Hex(utf8(text)) }
}

export const decodeUsherReg = (bytesOrText) => {
  const text = typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder().decode(bytesOrText)
  const lines = text.split('\n')
  if (lines[0] !== USHER_REG_DOMAIN) throw new Error('bad usher-reg domain')
  const body = {
    eventId: field(lines, 'event: '),
    usher: field(lines, 'usher: '),
    terp: field(lines, 'terp: '),
    zid: field(lines, 'zid: '),
    expiry: Number(field(lines, 'expiry: ')),
    nonce: field(lines, 'nonce: '),
  }
  const again = encodeUsherReg(body)
  if (again.text !== text) throw new Error('usher-reg not canonical')
  return { ...body, text, bytes: again.bytes, hash: again.hash }
}

/** Parse a pasted or scanned usher identity: a terp1 address, JSON, or SEZS-USHER-ID-V1. */
export const parseUsherPayload = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return { ok: false, error: 'empty' }
  const terpOf = (a, b) => (isTerpAddr(a) ? a : isTerpAddr(b) ? b : '')
  if (isTerpAddr(s)) {
    return { ok: true, usher: s, terp: s, zid: '', label: '' }
  }
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s)
      const terp = terpOf(j.terp || j.terp1 || j.bech32Address || '', j.usher || j.address || '')
      if (!terp) return { ok: false, error: 'bad_usher' }
      return { ok: true, usher: terp, terp, zid: '', label: j.label || '' }
    } catch {
      return { ok: false, error: 'bad_json' }
    }
  }
  const lines = s.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines[0] === USHER_ID_DOMAIN || lines.some((l) => /^usher:|^terp:/i.test(l))) {
    const get = (keys) => {
      for (const line of lines) {
        const lower = line.toLowerCase()
        for (const k of keys) {
          if (lower.startsWith(k)) return line.slice(k.length).trim()
        }
      }
      return ''
    }
    const terp = terpOf(get(['terp: ', 'terp1: ']), get(['usher: ', 'address: ']))
    const label = get(['label: ', 'name: '])
    if (!terp) return { ok: false, error: 'bad_usher' }
    return { ok: true, usher: terp, terp, zid: '', label }
  }
  return { ok: false, error: 'unrecognized' }
}
