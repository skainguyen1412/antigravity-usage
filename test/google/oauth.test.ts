/**
 * Tests for OAuth helper functions
 */

import { describe, it, expect } from 'vitest'
import { extractProjectId, pickOnboardTier } from '../../src/google/oauth.js'

describe('extractProjectId', () => {
  it('should return string value when input is non-empty string', () => {
    expect(extractProjectId('project-123')).toBe('project-123')
  })

  it('should return undefined for empty string', () => {
    expect(extractProjectId('')).toBeUndefined()
  })

  it('should extract id from object with id property', () => {
    expect(extractProjectId({ id: 'project-456' })).toBe('project-456')
  })

  it('should return undefined when object has empty id', () => {
    expect(extractProjectId({ id: '' })).toBeUndefined()
  })

  it('should return undefined when object has no id property', () => {
    expect(extractProjectId({ name: 'test' })).toBeUndefined()
  })

  it('should return undefined for null', () => {
    expect(extractProjectId(null)).toBeUndefined()
  })

  it('should return undefined for undefined', () => {
    expect(extractProjectId(undefined)).toBeUndefined()
  })

  it('should return undefined for number', () => {
    expect(extractProjectId(123)).toBeUndefined()
  })
})

describe('pickOnboardTier', () => {
  it('should return fallback when allowedTiers is undefined', () => {
    expect(pickOnboardTier(undefined, 'fallback-tier')).toBe('fallback-tier')
  })

  it('should return fallback when allowedTiers is empty', () => {
    expect(pickOnboardTier([], 'fallback-tier')).toBe('fallback-tier')
  })

  it('should return default tier when available', () => {
    const tiers = [
      { id: 'tier-1', isDefault: false },
      { id: 'tier-2', isDefault: true },
      { id: 'tier-3', isDefault: false }
    ]
    expect(pickOnboardTier(tiers, 'fallback')).toBe('tier-2')
  })

  it('should return first tier with valid id when no default', () => {
    const tiers = [
      { id: 'tier-1', isDefault: false },
      { id: 'tier-2', isDefault: false }
    ]
    expect(pickOnboardTier(tiers, 'fallback')).toBe('tier-1')
  })

  it('should skip tiers with empty id', () => {
    const tiers = [
      { id: '', isDefault: false },
      { id: 'tier-valid', isDefault: false }
    ]
    expect(pickOnboardTier(tiers, 'fallback')).toBe('tier-valid')
  })

  it('should return LEGACY when tiers exist but have no valid ids', () => {
    const tiers = [
      { id: '', isDefault: false },
      { isDefault: false }
    ]
    expect(pickOnboardTier(tiers, 'fallback')).toBe('LEGACY')
  })

  it('should prefer default tier over first tier', () => {
    const tiers = [
      { id: 'tier-1', isDefault: false },
      { id: 'tier-default', isDefault: true }
    ]
    expect(pickOnboardTier(tiers, 'fallback')).toBe('tier-default')
  })

  it('should return undefined when no fallback and empty tiers', () => {
    expect(pickOnboardTier([], undefined)).toBeUndefined()
  })
})
