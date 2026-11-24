/**
 * Lab stand-in for the cw420 coordinator / usher member set, plus sealed
 * zirc room metadata. Ticket secrets must never be written into this channel.
 * See apps/sezs/docs/BACKEND-ROLE.md and ZAFU-ZID-ZIRC-TICKETS.md.
 */
import { refuseSecretFields } from './guards.mjs'

const ZID_PUB = /^[0-9a-f]{64}$/i

export const ensureUsherGroup = (s) => {
  if (!s.usherGroup || typeof s.usherGroup !== 'object') {
    s.usherGroup = { members: [], room: null, rooms: [] }
  }
  if (!Array.isArray(s.usherGroup.members)) s.usherGroup.members = []
  if (!Array.isArray(s.usherGroup.rooms)) s.usherGroup.rooms = []
  if (!Array.isArray(s.log)) s.log = []
  return s
}

const log = (s, kind, msg) => {
  s.log.push({ t: Date.now(), kind, msg: String(msg).slice(0, 240) })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}

const fingerprint = (hex) => String(hex || '').toLowerCase().slice(0, 8)

/**
 * Register or update a member's site-scoped ZID on the lab cw420 usher set.
 * Does not talk to a live chain in this phase.
 */
export const registerUsherZid = (s, body, actorRole) => {
  const refused = refuseSecretFields(body)
  if (refused) return refused
  if (actorRole !== 'admin' && actorRole !== 'usher') {
    return { ok: false, error: 'not_member', message: 'Refused: only a coordinator or usher may register a ZID.' }
  }
  ensureUsherGroup(s)
  const seat = String(body?.seat || body?.id || '').trim().toLowerCase()
  const zidPubkey = String(body?.zidPubkey || body?.pubkey || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(seat)) return { ok: false, error: 'bad_seat' }
  if (!ZID_PUB.test(zidPubkey)) return { ok: false, error: 'bad_zid' }
  const member = {
    seat,
    zidPubkey,
    pq_pubkey: body.pq_pubkey || null,
    pq_epoch: body.pq_epoch ?? 0,
    pq_suite: body.pq_suite || null,
    origin: body.origin || null,
    registeredAt: Date.now(),
  }
  const prev = s.usherGroup.members.find((m) => m.seat === seat)
  const changed = !prev || prev.zidPubkey !== zidPubkey
  s.usherGroup.members = s.usherGroup.members.filter((m) => m.seat !== seat).concat(member)
  if (changed && s.usherGroup.room) {
    s.usherGroup.room.stale = true
    log(s, 'usher', `member set changed (${seat} · zid ${fingerprint(zidPubkey)}…). Current room is stale; rotate to a new room.`)
  } else {
    log(s, 'usher', `registered usher ZID for ${seat} · ${fingerprint(zidPubkey)}…`)
  }
  return { ok: true, member: publicMember(member), memberSetChanged: changed, roomStale: !!s.usherGroup.room?.stale }
}

const publicMember = (m) => ({
  seat: m.seat,
  zidPubkey: m.zidPubkey,
  pq_pubkey: m.pq_pubkey || null,
  pq_epoch: m.pq_epoch ?? 0,
  origin: m.origin || null,
})

export const publicUsherGroup = (s) => {
  ensureUsherGroup(s)
  const room = s.usherGroup.room
  return {
    members: s.usherGroup.members.map(publicMember),
    room: room
      ? {
          id: room.id,
          appScope: room.appScope,
          channel: room.channel,
          stale: !!room.stale,
          createdAt: room.createdAt,
          memberFingerprints: (room.memberPubkeys || []).map(fingerprint),
          inviteCount: (room.invites || []).length,
        }
      : null,
  }
}

/**
 * Record a newly created sealed room. The room secret stays on the event
 * server (and, once opened, on a dapp page that accepted an invite — that
 * limitation is documented in the UI). Invites are sealed blobs, not plaintext
 * zroom2 tokens, in the API response to a member.
 */
export const recordRoom = (s, { id, appScope, channel, memberPubkeys, invites }) => {
  ensureUsherGroup(s)
  const room = {
    id,
    appScope,
    channel,
    stale: false,
    createdAt: Date.now(),
    memberPubkeys: memberPubkeys || s.usherGroup.members.map((m) => m.zidPubkey),
    invites: invites || [],
  }
  s.usherGroup.room = room
  s.usherGroup.rooms.push({ id, createdAt: room.createdAt, replaced: false })
  log(s, 'usher', `opened sealed usher room ${id} for ${room.memberPubkeys.length} member(s)`)
  return { ok: true, group: publicUsherGroup(s) }
}

export const sealedInviteFor = (s, zidPubkey) => {
  ensureUsherGroup(s)
  const room = s.usherGroup.room
  if (!room || room.stale) return { ok: false, error: 'no_room' }
  const pub = String(zidPubkey || '').toLowerCase()
  const invite = (room.invites || []).find((i) => i.zidPubkey === pub)
  if (!invite) return { ok: false, error: 'not_invited' }
  return {
    ok: true,
    roomId: room.id,
    appScope: room.appScope,
    channel: room.channel,
    sealed: {
      ciphertext: invite.ciphertext,
      ephemeral_pubkey: invite.ephemeral_pubkey,
      pq_epoch: invite.pq_epoch,
      postQuantum: invite.postQuantum,
    },
  }
}

export const APP_SCOPE = 'sezs-usher-v1'
export const CHANNEL = '#ushers'
