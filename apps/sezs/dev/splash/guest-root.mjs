/**
 * Guest-list root publisher cadence.
 * The backend runtime signs UpdateGuestRoot with the service key (never
 * printed here). Publish at most every 15 minutes, and immediately when
 * doors open or sales close.
 */
import { POSEIDON_SUITE, ROOT_PUBLISH_MS, TREE_DEPTH } from '../../src/ticket/poseidon-suite.mjs'

export const guestRootPolicy = {
  suite: POSEIDON_SUITE,
  depth: TREE_DEPTH,
  intervalMs: ROOT_PUBLISH_MS,
  alsoAt: ['doors-open', 'sales-close'],
}

let lastPub = 0

/** Returns true when a publish should be attempted. Never logs keys. */
export function shouldPublishRoot({ now = Date.now(), reason = 'interval', force = false } = {}) {
  if (force || reason === 'doors-open' || reason === 'sales-close') {
    lastPub = now
    return true
  }
  if (now - lastPub >= ROOT_PUBLISH_MS) {
    lastPub = now
    return true
  }
  return false
}

export function resetPublishClock() {
  lastPub = 0
}
