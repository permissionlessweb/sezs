import { AuthSession, Rail } from '../auth/types'

export type Quote = {
  label: string
  price: string
  discount: string
  live: boolean
  note: string
}

export type Instruct =
  | { kind: 'not_live'; text: string }
  | { kind: 'need_binding'; text: string }
  | { kind: 'payRef'; text: string; payRef: string; orderId: string }
  | {
      kind: 'uri'
      text: string
      recipient?: string
      memoCommit?: string
    }
  | {
      kind: 'dest'
      text: string
      dest: string
      recipient?: string
      memoCommit?: string
    }

export type PollResult =
  | { status: 'waiting' | 'not_live' | 'quoted'; message: string }
  | { status: 'paid'; recordId: string; message: string }

export type RailAdapter = {
  id: Rail
  quote: () => Quote
  /** Primary button label. Empty when the rail cannot instruct. */
  primary: string
  /** Shown only while waiting on evidence. */
  secondary?: string
  instruct: (
    session: AuthSession,
    extra?: { terp?: string }
  ) => Promise<Instruct>
  poll: (session: AuthSession, issued: Instruct) => Promise<PollResult>
}

export const instructIsWaiting = (issued: Instruct | null): boolean =>
  !!issued &&
  (issued.kind === 'uri' || issued.kind === 'dest' || issued.kind === 'payRef')
