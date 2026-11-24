import { CollabOpsPlaneId } from './types'

/** Plane tabs for Public | Private (ops). */
export const COLLAB_OPS_PLANES: {
  id: CollabOpsPlaneId
  label: string
  /** Short plane role for a11y / teaching copy. */
  role: 'public' | 'member-gated'
}[] = [
  { id: 'public', label: 'Public', role: 'public' },
  { id: 'private', label: 'Private', role: 'member-gated' },
]

/** Minimum height for plane embed slots. */
export const COLLAB_OPS_SLOT_MIN_HEIGHT = 480
