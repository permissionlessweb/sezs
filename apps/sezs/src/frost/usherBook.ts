/**
 * Usher add/remove. Ushers are not spend holders.
 * They may check guests in at the door, and only that.
 * Removal takes effect as soon as the current holders agree.
 */

const SEAT = /^[a-z][a-z0-9-]{0,31}$/

export type UsherBook = {
  ushers: string[]
  pending: null | {
    action: 'add' | 'remove'
    id: string
    shares: Record<string, string>
  }
  spent: string[]
}

export type UsherResult =
  | { ok: true; book: UsherBook }
  | { ok: false; error: string; book: UsherBook }

export function emptyUsherBook(): UsherBook {
  return { ushers: [], pending: null, spent: [] }
}

function fail(book: UsherBook, error: string): UsherResult {
  return { ok: false, error, book }
}

export function proposeUsher(
  book: UsherBook,
  holders: string[],
  actor: string,
  usherId: string,
  action: 'add' | 'remove'
): UsherResult {
  if (!holders.includes(actor)) return fail(book, 'not_admin')
  if (book.pending) return fail(book, 'already_pending')
  const id = usherId.trim().toLowerCase()
  if (!SEAT.test(id)) return fail(book, 'bad_seat')
  if (holders.includes(id)) return fail(book, 'not_holder')
  if (action === 'add' && book.ushers.includes(id)) return fail(book, 'duplicate_seat')
  if (action === 'remove' && !book.ushers.includes(id)) return fail(book, 'not_holder')
  return {
    ok: true,
    book: { ...book, pending: { action, id, shares: {} } },
  }
}

export function ackUsher(
  book: UsherBook,
  holders: string[],
  actor: string,
  blob: string,
  t: number
): UsherResult {
  const p = book.pending
  if (!p) return fail(book, 'not_pending')
  if (!holders.includes(actor)) return fail(book, 'not_admin')
  if (actor === p.id) return fail(book, 'not_admin')
  const b = blob.trim()
  if (!b || b.toLowerCase().includes('keypackage')) return fail(book, 'keypackage_rejected')
  if (p.shares[actor]) return fail(book, 'duplicate_admin')
  if (book.spent.includes(b)) return fail(book, 'share_replay_epoch')
  const shares = { ...p.shares, [actor]: b }
  if (Object.keys(shares).length < t) {
    return { ok: true, book: { ...book, pending: { ...p, shares } } }
  }
  const ushers =
    p.action === 'add'
      ? [...book.ushers, p.id]
      : book.ushers.filter((u) => u !== p.id)
  return {
    ok: true,
    book: {
      ushers,
      pending: null,
      spent: [...book.spent, ...Object.values(shares)],
    },
  }
}

/** Door check-in only. Admin and guest do not get this from the usher list. */
export function doorCheckIn(
  role: string,
  usherId: string,
  book: UsherBook
): boolean {
  if (role !== 'usher') return false
  return book.ushers.includes(usherId.trim().toLowerCase())
}

export function usherCanAdmin(): boolean {
  return false
}
