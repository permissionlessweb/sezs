import { describe, expect, test } from 'vitest'

import {
  canShowPrivatePlane,
  privatePlaneLegendState,
  resolveActivePlane,
  visiblePlaneTabs,
} from './planes'

describe('CollabOps planes', () => {
  describe('canShowPrivatePlane', () => {
    test('allows members when only-members', () => {
      expect(
        canShowPrivatePlane({
          isMember: true,
          isAdmin: false,
          privateVisibility: 'only-members',
        })
      ).toBe(true)
    })

    test('allows admins when only-members even if not voting member flag', () => {
      expect(
        canShowPrivatePlane({
          isMember: false,
          isAdmin: true,
          privateVisibility: 'only-members',
        })
      ).toBe(true)
    })

    test('denies non-members', () => {
      expect(
        canShowPrivatePlane({
          isMember: false,
          isAdmin: false,
          privateVisibility: 'only-members',
        })
      ).toBe(false)
    })

    test('admins-only denies plain members', () => {
      expect(
        canShowPrivatePlane({
          isMember: true,
          isAdmin: false,
          privateVisibility: 'admins',
        })
      ).toBe(false)
      expect(
        canShowPrivatePlane({
          isMember: false,
          isAdmin: true,
          privateVisibility: 'admins',
        })
      ).toBe(true)
    })

    test('hidden never shows', () => {
      expect(
        canShowPrivatePlane({
          isMember: true,
          isAdmin: true,
          privateVisibility: 'hidden',
        })
      ).toBe(false)
    })
  })

  describe('resolveActivePlane', () => {
    test('keeps public always', () => {
      expect(resolveActivePlane('public', false)).toBe('public')
      expect(resolveActivePlane('public', true)).toBe('public')
    })

    test('does not force private into public viewers', () => {
      expect(resolveActivePlane('private', false)).toBe('public')
      expect(resolveActivePlane('private', true)).toBe('private')
    })
  })

  describe('privatePlaneLegendState', () => {
    test('reports available for members', () => {
      expect(
        privatePlaneLegendState({
          isWalletConnected: true,
          isMember: true,
          isAdmin: false,
          privateVisibility: 'only-members',
        })
      ).toBe('available')
    })

    test('asks to connect when wallet off', () => {
      expect(
        privatePlaneLegendState({
          isWalletConnected: false,
          isMember: false,
          isAdmin: false,
          privateVisibility: 'only-members',
        })
      ).toBe('gated-connect')
    })

    test('asks for membership when connected non-member', () => {
      expect(
        privatePlaneLegendState({
          isWalletConnected: true,
          isMember: false,
          isAdmin: false,
          privateVisibility: 'only-members',
        })
      ).toBe('gated-member')
    })

    test('hidden when policy says so', () => {
      expect(
        privatePlaneLegendState({
          isWalletConnected: true,
          isMember: true,
          isAdmin: true,
          privateVisibility: 'hidden',
        })
      ).toBe('hidden')
    })
  })

  describe('visiblePlaneTabs', () => {
    test('hides private tab when policy is hidden', () => {
      expect(visiblePlaneTabs('hidden')).toEqual(['public'])
    })

    test('shows both tabs otherwise (content still gated)', () => {
      expect(visiblePlaneTabs('only-members')).toEqual(['public', 'private'])
      expect(visiblePlaneTabs('admins')).toEqual(['public', 'private'])
    })
  })
})
