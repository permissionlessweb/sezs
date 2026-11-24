import { Rail } from '../auth/types'
import { Instruct, PollResult } from './types'

/** Guest poll is honest. Does not fetch loopback. Paid is never a browser write. */
export async function pollDreggWatch(
  _issued: Instruct,
  _rail: Rail = 'zec'
): Promise<PollResult> {
  return {
    status: 'not_live',
    message: 'Checkout opens soon. Not paid.',
  }
}
