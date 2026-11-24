/**
 * Lab ZID provider — a stand-in for the Zafu extension in headless tests
 * and local dev when no wallet is injected.
 *
 * It mirrors @zafu/protocol v1 method shapes for zafu_zid_pubkey,
 * zafu_encrypt, and zafu_decrypt. It is not the Zafu extension. The
 * post-quantum X-Wing path is used when a real wallet advertises pq_pubkey;
 * this lab provider uses the classical X25519 → HKDF-SHA256 → AES-256-GCM
 * sealed box described in @zafu/zid (guest.ts / external-encryption), so
 * envelopes it writes are only openable by the same lab identity.
 *
 * Do not put the word "mock" in guest-visible UI; call this the lab ZID
 * provider. Source and docs may say "mock provider".
 *
 * See apps/sezs/docs/ZAFU-ZID-ZIRC-TICKETS.md and BACKEND-ROLE.md.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2) throw new Error('bad_hex')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
const b64 = {
  encode: (u8) => {
    let s = ''
    for (const b of u8) s += String.fromCharCode(b)
    return btoa(s)
  },
  decode: (s) => Uint8Array.from(atob(String(s || '')), (c) => c.charCodeAt(0)),
}

const subtle = () => {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error('no_crypto')
  return c
}

const sha256 = async (bytes) => new Uint8Array(await subtle().subtle.digest('SHA-256', bytes))

const hkdf = async (ikm, salt, info, len) => {
  const key = await subtle().subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await subtle().subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8)
  return new Uint8Array(bits)
}

/**
 * Classical sealed box, matching the Zafu v1 classical path at the
 * algorithmic level: ephemeral X25519 DH → HKDF-SHA256 → AES-256-GCM,
 * 12-byte nonce prefix on the ciphertext. Lab-only identities; not a
 * claim of byte-for-byte interop with a given wallet build until tested
 * against one.
 */
const x25519KeyPair = async () => subtle().subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])

const exportRaw = async (key) => new Uint8Array(await subtle().subtle.exportKey('raw', key))

const importX25519Pub = (raw) =>
  subtle().subtle.importKey('raw', raw, { name: 'X25519' }, true, [])

const ecdh = async (priv, pubRaw) => {
  const pub = await importX25519Pub(pubRaw)
  const bits = await subtle().subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256)
  return new Uint8Array(bits)
}

const BOX_SALT = enc.encode('zafu-zid-box-v1')
const BOX_INFO = enc.encode('zafu-zid-seal')

const aesGcmEncrypt = async (keyBytes, nonce, plaintext) => {
  const key = await subtle().subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const ct = await subtle().subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)
  return new Uint8Array(ct)
}
const aesGcmDecrypt = async (keyBytes, nonce, ciphertext) => {
  const key = await subtle().subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const pt = await subtle().subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext)
  return new Uint8Array(pt)
}

async function sealClassical(recipientPubRaw, plaintext) {
  const eph = await x25519KeyPair()
  const shared = await ecdh(eph.privateKey, recipientPubRaw)
  const aesKey = await hkdf(shared, BOX_SALT, BOX_INFO, 32)
  const nonce = subtle().getRandomValues(new Uint8Array(12))
  const body = await aesGcmEncrypt(aesKey, nonce, plaintext)
  const ciphertext = new Uint8Array(12 + body.length)
  ciphertext.set(nonce, 0)
  ciphertext.set(body, 12)
  const ephemeral = await exportRaw(eph.publicKey)
  return { ciphertext, ephemeral_pubkey: ephemeral }
}

async function openClassical(myPriv, ephemeralPub, ciphertext) {
  if (ciphertext.length < 13) throw new Error('bad_box')
  const nonce = ciphertext.slice(0, 12)
  const body = ciphertext.slice(12)
  const shared = await ecdh(myPriv, ephemeralPub)
  const aesKey = await hkdf(shared, BOX_SALT, BOX_INFO, 32)
  return aesGcmDecrypt(aesKey, nonce, body)
}

const STORE = 'sezs-lab-zid-v1'

const loadOrCreate = async (storage, origin) => {
  const key = `${STORE}:${origin}`
  let raw = null
  try {
    raw = storage?.getItem(key)
  } catch {
    /* */
  }
  if (raw) {
    try {
      const j = JSON.parse(raw)
      if (j?.kind === 'sezs-lab-zid-v1' && j.x25519PrivateJwk && j.pubkey) return j
    } catch {
      /* */
    }
  }
  const pair = await x25519KeyPair()
  const pub = await exportRaw(pair.publicKey)
  const jwk = await subtle().subtle.exportKey('jwk', pair.privateKey)
  const rec = {
    kind: 'sezs-lab-zid-v1',
    origin,
    pubkey: toHex(pub),
    x25519PrivateJwk: jwk,
    pq_epoch: 0,
    createdAt: Date.now(),
  }
  try {
    storage?.setItem(key, JSON.stringify(rec))
  } catch {
    /* ephemeral */
  }
  return rec
}

const importMyPriv = (jwk) =>
  subtle().subtle.importKey('jwk', jwk, { name: 'X25519' }, false, ['deriveBits'])

/**
 * @param {object} [opts]
 * @param {string} [opts.origin]
 * @param {Storage} [opts.storage]
 * @param {'lab'} [opts.label]
 */
export const createLabZidProvider = async (opts = {}) => {
  const origin = opts.origin || 'http://127.0.0.1:3051' // contract domain; override via opts.origin / eventOrigin()
  const storage = opts.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  const rec = await loadOrCreate(storage, origin)
  const priv = await importMyPriv(rec.x25519PrivateJwk)

  const methods = {
    ping: async () => ({ zafu: true, lab: true, version: 'lab-v1' }),
    zafu_zid_pubkey: async () => ({
      pubkey: rec.pubkey,
      origin,
      pq_epoch: 0,
      // No pq_pubkey: classical path only. A real wallet may advertise X-Wing.
    }),
    zafu_encrypt: async (req) => {
      const recipient = fromHex(req.recipient)
      const plaintext = b64.decode(req.plaintext)
      // If recipient_pq is set we still cannot do X-Wing here; refuse rather
      // than silently downgrade when the caller required PQ. Callers that
      // want classical omit recipient_pq.
      if (req.recipient_pq) {
        return { success: false, error: { code: 'not_available', message: 'lab provider has no X-Wing path' } }
      }
      const box = await sealClassical(recipient, plaintext)
      return { ciphertext: b64.encode(box.ciphertext), ephemeral_pubkey: toHex(box.ephemeral_pubkey) }
    },
    zafu_decrypt: async (req) => {
      if (req.ephemeral_pubkey === '' || req.pq_epoch) {
        return { success: false, error: { code: 'not_available', message: 'lab provider cannot open an X-Wing box' } }
      }
      const pt = await openClassical(priv, fromHex(req.ephemeral_pubkey), b64.decode(req.ciphertext))
      return { plaintext: b64.encode(pt) }
    },
  }

  const request = async (method, params = {}) => {
    const fn = methods[method]
    if (!fn) throw new Error(`lab_zid: unknown method ${method}`)
    const resp = await fn({ type: method, ...params })
    if (resp && resp.error) {
      const e = new Error(resp.error.message || resp.error.code || 'lab_zid')
      e.code = resp.error.code
      throw e
    }
    return resp
  }

  return {
    kind: 'lab',
    label: 'Lab ZID provider',
    origin,
    pubkey: rec.pubkey,
    request,
    /** same shape @zafu/zid detect() looks for after a ping */
    isLab: true,
  }
}

/** Detect a real Zafu wallet (Penumbra provider with zafu:true). */
/** @param {{ allowLab?: boolean, origin?: string, storage?: Storage }} [opts] */
export const detectZafuOrLab = async ({ allowLab = true, origin, storage } = {}) => {
  const inject = globalThis[Symbol.for('penumbra')]
  // A real wallet is preferred when it answers ping.
  if (inject && typeof inject === 'object') {
    try {
      // leave actual transport to @zafu/zid when the app has it; here we only detect
      if (inject.zafu === true) return { kind: 'zafu', handle: inject, isLab: false }
    } catch {
      /* */
    }
  }
  if (globalThis.zafuLabProvider?.request) {
    return { kind: 'lab', handle: globalThis.zafuLabProvider, isLab: true }
  }
  if (!allowLab) return null
  const lab = await createLabZidProvider({ origin, storage })
  return { kind: 'lab', handle: lab, isLab: true }
}

export const labZidPubkey = async (handle) => handle.request('zafu_zid_pubkey', { type: 'zafu_zid_pubkey' })

/**
 * @param {*} handle
 * @param {{ pubkey?: string }|string} recipient
 * @param {Uint8Array|string} plaintext
 * @param {{ requirePq?: boolean }} [opts]
 * @returns {Promise<{ ciphertext: string, ephemeral_pubkey?: string, postQuantum: boolean, pq_epoch?: number, pq_suite?: string|null }>}
 */
export const labEncryptFor = async (handle, recipient, plaintext, opts = {}) => {
  const pt = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext
  if (opts.requirePq) throw new Error('lab provider cannot satisfy requirePq')
  const resp = await handle.request('zafu_encrypt', {
    type: 'zafu_encrypt',
    recipient: recipient.pubkey || recipient,
    plaintext: b64.encode(pt),
  })
  return {
    ciphertext: resp.ciphertext,
    ephemeral_pubkey: resp.ephemeral_pubkey,
    postQuantum: resp.ephemeral_pubkey === '',
    pq_epoch: resp.pq_epoch,
    pq_suite: resp.pq_suite ?? null,
  }
}

export const labDecryptFrom = async (handle, sealed) => {
  const resp = await handle.request('zafu_decrypt', {
    type: 'zafu_decrypt',
    ciphertext: sealed.ciphertext,
    ephemeral_pubkey: sealed.ephemeral_pubkey,
    ...(sealed.pq_epoch !== undefined ? { pq_epoch: sealed.pq_epoch } : {}),
  })
  return b64.decode(resp.plaintext)
}

export const bytesToUtf8 = (u8) => dec.decode(u8)
export const utf8ToBytes = (s) => enc.encode(s)
export { toHex as labToHex, fromHex as labFromHex, b64 as labB64 }
