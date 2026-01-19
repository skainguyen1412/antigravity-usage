/**
 * Tests for account resolver module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveAccounts,
  hasValidAccounts,
  getAccountResolutionStatus
} from '../../src/wakeup/account-resolver.js'

// Mock the account manager
vi.mock('../../src/accounts/manager.js', () => {
  const mockAccounts = new Map<string, { status: string }>()
  let activeEmail: string | null = null
  
  return {
    getAccountManager: () => ({
      hasAccount: (email: string) => mockAccounts.has(email),
      getAccountStatus: (email: string) => mockAccounts.get(email)?.status || 'invalid',
      getActiveEmail: () => activeEmail,
      getAccountEmails: () => Array.from(mockAccounts.keys()),
      
      // Test helpers
      _setActiveEmail: (email: string | null) => { activeEmail = email },
      _addAccount: (email: string, status: string) => { mockAccounts.set(email, { status }) },
      _clear: () => { mockAccounts.clear(); activeEmail = null }
    })
  }
})

import { getAccountManager } from '../../src/accounts/manager.js'

describe('Account Resolver', () => {
  let mockManager: ReturnType<typeof getAccountManager> & {
    _setActiveEmail: (email: string | null) => void
    _addAccount: (email: string, status: string) => void
    _clear: () => void
  }
  
  beforeEach(() => {
    mockManager = getAccountManager() as any
    mockManager._clear()
  })
  
  describe('resolveAccounts', () => {
    describe('with explicit selection', () => {
      it('should return empty array for empty explicit selection', () => {
        mockManager._addAccount('user@example.com', 'valid')
        
        const result = resolveAccounts([])
        expect(result).toEqual([])
      })
      
      it('should filter to only valid accounts', () => {
        mockManager._addAccount('valid@example.com', 'valid')
        mockManager._addAccount('expired@example.com', 'expired')
        mockManager._addAccount('invalid@example.com', 'invalid')
        
        const result = resolveAccounts([
          'valid@example.com',
          'expired@example.com',
          'invalid@example.com'
        ])
        
        // Valid and expired should be included (expired can be refreshed)
        expect(result).toContain('valid@example.com')
        expect(result).toContain('expired@example.com')
        expect(result).not.toContain('invalid@example.com')
      })
      
      it('should exclude non-existent accounts', () => {
        mockManager._addAccount('exists@example.com', 'valid')
        
        const result = resolveAccounts([
          'exists@example.com',
          'nonexistent@example.com'
        ])
        
        expect(result).toEqual(['exists@example.com'])
      })
    })
    
    describe('with fallback (undefined selection)', () => {
      it('should use active account if valid', () => {
        mockManager._addAccount('active@example.com', 'valid')
        mockManager._addAccount('other@example.com', 'valid')
        mockManager._setActiveEmail('active@example.com')
        
        const result = resolveAccounts(undefined)
        
        expect(result).toEqual(['active@example.com'])
      })
      
      it('should use active account if expired (can be refreshed)', () => {
        mockManager._addAccount('active@example.com', 'expired')
        mockManager._setActiveEmail('active@example.com')
        
        const result = resolveAccounts(undefined)
        
        expect(result).toEqual(['active@example.com'])
      })
      
      it('should fall back to first valid account if active is invalid', () => {
        mockManager._addAccount('active@example.com', 'invalid')
        mockManager._addAccount('fallback@example.com', 'valid')
        mockManager._setActiveEmail('active@example.com')
        
        const result = resolveAccounts(undefined)
        
        expect(result).toEqual(['fallback@example.com'])
      })
      
      it('should return empty array if no valid accounts', () => {
        mockManager._addAccount('invalid1@example.com', 'invalid')
        mockManager._addAccount('invalid2@example.com', 'invalid')
        
        const result = resolveAccounts(undefined)
        
        expect(result).toEqual([])
      })
      
      it('should return empty array if no accounts at all', () => {
        const result = resolveAccounts(undefined)
        expect(result).toEqual([])
      })
    })
  })
  
  describe('hasValidAccounts', () => {
    it('should return true if accounts can be resolved', () => {
      mockManager._addAccount('user@example.com', 'valid')
      mockManager._setActiveEmail('user@example.com')
      
      expect(hasValidAccounts(undefined)).toBe(true)
    })
    
    it('should return false if no accounts can be resolved', () => {
      expect(hasValidAccounts(undefined)).toBe(false)
    })
    
    it('should return false for empty explicit selection', () => {
      mockManager._addAccount('user@example.com', 'valid')
      
      expect(hasValidAccounts([])).toBe(false)
    })
  })
  
  describe('getAccountResolutionStatus', () => {
    it('should describe single account', () => {
      mockManager._addAccount('user@example.com', 'valid')
      mockManager._setActiveEmail('user@example.com')
      
      const status = getAccountResolutionStatus(undefined)
      expect(status).toContain('user@example.com')
    })
    
    it('should describe multiple accounts', () => {
      mockManager._addAccount('user1@example.com', 'valid')
      mockManager._addAccount('user2@example.com', 'valid')
      
      const status = getAccountResolutionStatus(['user1@example.com', 'user2@example.com'])
      expect(status).toContain('2 accounts')
    })
    
    it('should describe no valid accounts', () => {
      const status = getAccountResolutionStatus(undefined)
      expect(status).toContain('No valid accounts')
    })
    
    it('should describe invalid selection', () => {
      mockManager._addAccount('user@example.com', 'invalid')
      
      const status = getAccountResolutionStatus(['user@example.com'])
      expect(status).toContain('invalid')
    })
  })
})
