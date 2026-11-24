/**
 * frostd-shaped client that talks to the *bouncer*, never the production relay.
 * Login and Noise_K share one X25519 identity (XEdDSA + FrostRelayCipher).
 */
import { assertLocalRelay } from '../zafu/relay-guard.mjs'
import { generateCipherIdentity, signRelayChallenge } from './zafu-cipher.mjs'

export const generateRelayIdentity = () => generateCipherIdentity()

export const signChallenge = (identity, challenge) => signRelayChallenge(identity, challenge)

export const createRelayClient = ({ host }) => {
  assertLocalRelay(host)
  let accessToken = null

  const post = async (path, body, { auth = true } = {}) => {
    const headers = { 'content-type': 'application/json' }
    if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`
    const res = await fetch(`${host}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`frostd ${path} failed: ${res.status} ${text}`.trim())
    return text ? JSON.parse(text) : {}
  }

  return {
    host,
    publicKeyOf: (identity) => identity.publicKey,
    async login(identity) {
      const { challenge } = await post('/challenge', {}, { auth: false })
      const signature = await signChallenge(identity, challenge)
      const { access_token } = await post(
        '/login',
        { challenge, pubkey: identity.publicKey, signature },
        { auth: false },
      )
      accessToken = access_token
      return access_token
    },
    async createSession(pubkeys, messageCount = 0) {
      const { session_id } = await post('/create_new_session', { pubkeys, message_count: messageCount })
      return session_id
    },
    async send(sessionId, recipients, msg) {
      await post('/send', { session_id: sessionId, recipients, msg })
    },
    async receive(sessionId) {
      const { msgs } = await post('/receive', { session_id: sessionId })
      return msgs || []
    },
    async closeSession(sessionId) {
      await post('/close_session', { session_id: sessionId })
    },
  }
}
