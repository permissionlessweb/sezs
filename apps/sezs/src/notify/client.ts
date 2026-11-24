/**
 * Lab mail client.
 *
 * Prefer same-origin `/sezs/mail/…` so the existing nginx hop can carry
 * the POST (proposed location in nginx-sezs-mail.snippet.conf — not loaded).
 * next-dev :3051 has no that hop, so it falls back to the loopback gateway.
 * No second proxy.
 */

export const MAIL_PREFIX = '/sezs/mail'

export function mailOrigin(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_MAIL_URL) {
    return String(process.env.NEXT_PUBLIC_SEZS_MAIL_URL).replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined') {
    // Same-origin when a front hop already serves this page (port ≠ 3051).
    if (window.location.port !== '3051') return ''
  }
  return 'http://127.0.0.1:3061'
}

export type MailOk = {
  ok: true
  status: string
  message: string
}

export type MailErr = {
  ok: false
  error: string
}

function mailUrl(path: string): string {
  const p = path.startsWith('/') ? path : '/' + path
  return mailOrigin() + MAIL_PREFIX + p
}

export async function mailPost(
  path: string,
  body: Record<string, string>
): Promise<MailOk | MailErr> {
  const res = await fetch(mailUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as MailOk | MailErr
  return data
}

export async function mailGet(path: string): Promise<MailOk | MailErr> {
  const res = await fetch(mailUrl(path))
  return (await res.json()) as MailOk | MailErr
}
