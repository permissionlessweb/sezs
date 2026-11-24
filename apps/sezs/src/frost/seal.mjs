/**
 * Per-recipient seal used on the loopback path.
 * This is Zafu's FrostRelayCipher (Noise_K) loaded from the zcash-wasm package.
 */
import { createFrostRelayCipher, generateCipherIdentity, loadZafuCipher } from './zafu-cipher.mjs'

export const ensureSeal = () => loadZafuCipher()

export const generateSealIdentity = () => generateCipherIdentity()

/**
 * Build a per-seat cipher once peer FrostRelayCipher public keys are known.
 */
export const bindSeal = (identity, peerPublicKeys) => createFrostRelayCipher(identity, peerPublicKeys)

export const sealTo = (cipher, recipientPubHex, plaintext) => cipher.encrypt(recipientPubHex, plaintext)

export const openSealed = (cipher, senderPubHex, hexMsg) => cipher.decrypt(senderPubHex, hexMsg)
