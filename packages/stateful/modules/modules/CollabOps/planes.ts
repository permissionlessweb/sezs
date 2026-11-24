/**
 * Pure helpers for CollabOps public/private plane gating.
 * No React, no host invention — unit-testable.
 */

import type { CollabOpsPlaneId, CollabOpsPrivateVisibility } from './types'

export type PrivatePlaneAccess = {
  isMember: boolean
  isAdmin: boolean
  privateVisibility: CollabOpsPrivateVisibility
}

/**
 * Whether the private (Hermes) plane content may mount for this viewer.
 * Fail-closed: hidden never shows; admins requires isAdmin; only-members needs member or admin.
 */
export const canShowPrivatePlane = ({
  isMember,
  isAdmin,
  privateVisibility,
}: PrivatePlaneAccess): boolean => {
  switch (privateVisibility) {
    case 'hidden':
      return false
    case 'admins':
      return !!isAdmin
    case 'only-members':
    default:
      return !!isMember || !!isAdmin
  }
}

/**
 * Resolve the active plane without ever forcing private content into public view.
 * If private was requested but access is denied, fall back to public.
 */
export const resolveActivePlane = (
  requested: CollabOpsPlaneId,
  canPrivate: boolean
): CollabOpsPlaneId => {
  if (requested === 'private' && !canPrivate) {
    return 'public'
  }
  return requested
}

export type PlaneLegendState =
  | 'available'
  | 'gated-connect'
  | 'gated-member'
  | 'hidden'

/**
 * Teaching copy state for the private plane chip / legend.
 */
export const privatePlaneLegendState = ({
  isWalletConnected,
  isMember,
  isAdmin,
  privateVisibility,
}: PrivatePlaneAccess & {
  isWalletConnected: boolean
}): PlaneLegendState => {
  if (privateVisibility === 'hidden') {
    return 'hidden'
  }
  if (canShowPrivatePlane({ isMember, isAdmin, privateVisibility })) {
    return 'available'
  }
  if (!isWalletConnected) {
    return 'gated-connect'
  }
  return 'gated-member'
}

/**
 * Plane tabs visible in the segmented control.
 * Private tab is shown when not hidden (so users learn it exists), but content stays gated.
 */
export const visiblePlaneTabs = (
  privateVisibility: CollabOpsPrivateVisibility
): CollabOpsPlaneId[] => {
  if (privateVisibility === 'hidden') {
    return ['public']
  }
  return ['public', 'private']
}
