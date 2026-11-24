/**
 * Mail delivery provider interface and loopback dev sinks
 * (docs/specs/EMAIL-AUTH-GAP.md §3).
 *
 *   sendEmail({ to, from, subject, text, tokenRef }) → Promise<void>
 *
 * Default From is sezs@permissionless.money (SEZS_EMAIL_FROM overrides).
 *
 * Dev / lab only: messages land in 0600 files under the local state dir,
 * or in an in-memory inbox for tests. Zero SMTP, zero vendor SDKs, zero
 * network egress. Production plugs a single adapter behind this interface.
 */
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_EMAIL_FROM = 'sezs@permissionless.money'

export const resolveEmailFrom = (env = process.env) => {
  const value = String(env.SEZS_EMAIL_FROM || DEFAULT_EMAIL_FROM).trim()
  return value || DEFAULT_EMAIL_FROM
}

const withFrom = (msg, from = DEFAULT_EMAIL_FROM) => ({
  ...msg,
  from: String(msg?.from || from).trim() || from,
})

/** In-memory inbox for deterministic unit tests. Never wired to a network. */
export const makeMemorySink = () => {
  const inbox = []
  return {
    inbox,
    sendEmail: async (msg) => {
      const mail = withFrom(msg)
      inbox.push({ to: mail.to, from: mail.from, subject: mail.subject, text: mail.text, tokenRef: mail.tokenRef, at: Date.now() })
    },
  }
}

/**
 * Atomic 0600 file sink in `dir` (created 0700). Throws on any filesystem
 * failure so the caller maps it to 503 and refuses to store a challenge.
 */
export const makeFileSink = (dir) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  let seq = 0
  return {
    dir,
    sendEmail: async (msg) => {
      const mail = withFrom(msg)
      const ref = String(mail.tokenRef || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'msg'
      const path = join(dir, `${Date.now()}-${process.pid}-${seq++}-${ref}.json`)
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ to: mail.to, from: mail.from, subject: mail.subject, text: mail.text, tokenRef: mail.tokenRef, at: Date.now() }, null, 1), { mode: 0o600 })
      renameSync(tmp, path)
      chmodSync(path, 0o600)
    },
  }
}

/** Fail-closed provider for environments where mail delivery is not configured. */
export const makeUnavailableSink = () => ({
  sendEmail: async () => {
    throw new Error('email_provider_not_configured')
  },
})

export const createEmailProviderFromEnv = ({ env = process.env, fallbackDir } = {}) => {
  const from = resolveEmailFrom(env)
  const wrap = (sink) => ({
    ...sink,
    sendEmail: async (msg) => sink.sendEmail(withFrom(msg, from)),
  })
  const mode = String(env.SEZS_EMAIL_PROVIDER || (env.NODE_ENV === 'production' ? 'none' : 'file')).trim().toLowerCase()
  if (mode === 'file') {
    if (env.NODE_ENV === 'production') return wrap(makeUnavailableSink())
    const dir = env.SEZS_EMAIL_OUTBOX_DIR || fallbackDir
    if (!dir) return wrap(makeUnavailableSink())
    return wrap(makeFileSink(dir))
  }
  return wrap(makeUnavailableSink())
}
