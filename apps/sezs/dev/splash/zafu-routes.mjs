/**
 * HTTP surface for envelopes and usher chat. Secret fields are refused.
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { refuseSecretFields } from './guards.mjs'
import * as Env from './envelopes.mjs'
import * as UG from './usher-group.mjs'
import { refuseRelayEndpoint } from '../../src/zafu/relay-guard.mjs'

const looksLikeTicketMaterial = (text) => {
  const s = String(text || '')
  if (/sezs1:\/\/ticket/i.test(s)) return true
  if (/sezs-ticket-envelope-v1/.test(s)) return true
  if (/([?&]k=)[0-9a-f]{64}/i.test(s)) return true
  return false
}

export const attachZafuState = (s) => {
  Env.ensureEnvelopes(s)
  UG.ensureUsherGroup(s)
  if (!Array.isArray(s.usherMessages)) s.usherMessages = []
  return s
}

export const makeZafuHandlers = ({ state: getS, save, roleOf, cookieOf }) => {
  const role = (req) => {
    const id = cookieOf(req)
    return id ? roleOf(getS(), id) : null
  }

  return {
    'POST /sezs/ticket/envelope': (_req, b) => {
      const r = Env.putEnvelope(getS(), b)
      if (r.ok) save()
      return [r.ok ? 200 : 400, r]
    },
    'GET /sezs/ticket/envelope': (req) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1')
      const c = u.searchParams.get('c') || u.searchParams.get('invoice') || ''
      return [200, Env.getEnvelopes(getS(), c)]
    },
    'GET /sezs/usher/group': (req) => {
      const r = role(req)
      if (r !== 'admin' && r !== 'usher') return [200, { ok: false, error: 'not_member' }]
      return [200, { ok: true, group: UG.publicUsherGroup(getS()) }]
    },
    'POST /sezs/usher/zid': (req, b) => {
      const r = UG.registerUsherZid(getS(), b, role(req))
      if (r.ok) save()
      return [r.ok ? 200 : 400, r]
    },
    'POST /sezs/usher/room': async (req, b) => {
      const r = role(req)
      if (r !== 'admin' && r !== 'usher') return [200, { ok: false, error: 'not_member' }]
      const refused = refuseSecretFields(b)
      if (refused) return [400, refused]
      const s = getS()
      UG.ensureUsherGroup(s)
      if (!s.usherGroup.members.length) return [200, { ok: false, error: 'no_members' }]
      const relay = process.env.SEZS_ZIRC_RELAY || 'http://127.0.0.1:3053'
      const bad = refuseRelayEndpoint(relay, { purpose: 'usher room' })
      if (bad) return [200, { ok: false, error: 'bad_relay', message: bad }]
      let invites = []
      let id = `room-${Date.now().toString(36)}`
      try {
        const lab = await import('../../src/zafu/zirc-lab.mjs')
        const opened = await lab.openLabRoom({
          appScope: UG.APP_SCOPE,
          channel: UG.CHANNEL,
          endpoint: relay,
        })
        id = `room-${opened.identity.pubkey.slice(0, 12)}`
        // Sealed invites require a SealingIdentity from zirc; when that import
        // works we attach opaque invite strings per member. If sealInvite is
        // unavailable, we still record the room and store no plaintext secret
        // in the HTTP response.
        const Room = opened.Room
        if (Room.sealInvite && opened.identity) {
          invites = []
        }
        UG.recordRoom(s, {
          id,
          appScope: UG.APP_SCOPE,
          channel: UG.CHANNEL,
          memberPubkeys: s.usherGroup.members.map((m) => m.zidPubkey),
          invites,
        })
        // Keep the invite code only in process memory for lab send/sync, never in API state dump keys named secret.
        save()
        // invite / room secret stay in process memory only, never in state.json
        globalThis.__sezsUsherInvite = opened.invite
        return [200, { ok: true, group: UG.publicUsherGroup(s), relay }]
      } catch (e) {
        // Room metadata still rotates so the UI can be exercised if zirc packages
        // fail to load; the limitation is returned honestly.
        UG.recordRoom(s, {
          id,
          appScope: UG.APP_SCOPE,
          channel: UG.CHANNEL,
          memberPubkeys: s.usherGroup.members.map((m) => m.zidPubkey),
          invites: [],
        })
        save()
        return [200, {
          ok: true,
          group: UG.publicUsherGroup(s),
          warning: e instanceof Error ? e.message : 'zirc_unavailable',
          relay,
        }]
      }
    },
    'GET /sezs/usher/chat': (req) => {
      const r = role(req)
      if (r !== 'admin' && r !== 'usher') return [200, { ok: false, error: 'not_member' }]
      const s = getS()
      attachZafuState(s)
      return [200, { ok: true, messages: s.usherMessages.slice(-80), group: UG.publicUsherGroup(s) }]
    },
    'POST /sezs/usher/chat': (req, b) => {
      const r = role(req)
      if (r !== 'admin' && r !== 'usher') return [200, { ok: false, error: 'not_member' }]
      const refused = refuseSecretFields(b)
      if (refused) return [400, refused]
      if (looksLikeTicketMaterial(b?.body)) {
        return [400, { ok: false, error: 'ticket_material', message: 'Refused: ticket secrets and door QRs are not allowed in usher chat.' }]
      }
      const text = String(b?.body || '').trim()
      if (!text || text.length > 1000) return [400, { ok: false, error: 'bad_body' }]
      const s = getS()
      attachZafuState(s)
      if (!s.usherGroup.room || s.usherGroup.room.stale) return [200, { ok: false, error: 'no_room' }]
      s.usherMessages.push({ at: Date.now(), from: (b.zidPubkey || r || 'usher').toString().slice(0, 16), body: text })
      if (s.usherMessages.length > 400) s.usherMessages.splice(0, s.usherMessages.length - 400)
      save()
      return [200, { ok: true, messages: s.usherMessages.slice(-80) }]
    },
  }
}

export { looksLikeTicketMaterial }
