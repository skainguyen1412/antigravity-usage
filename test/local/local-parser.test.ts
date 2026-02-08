import { describe, it, expect } from 'vitest'
import { parseLocalQuotaSnapshot } from '../../src/local/local-parser.js'
import type { ConnectUserStatus } from '../../src/local/connect-client.js'

describe('local-parser', () => {
  describe('parseLocalQuotaSnapshot', () => {
    it('should parse valid user status', () => {
      const userStatus: ConnectUserStatus = {
        isAuthenticated: true,
        email: 'test@example.com',
        quota: {
          promptCredits: {
            used: 50,
            limit: 500,
            remaining: 450
          },
          models: [
            {
              modelId: 'gemini-2.0',
              label: 'Gemini 2.0',
              quota: {
                remainingPercentage: 0.8,
                remaining: 80,
                limit: 100,
                resetTime: '2026-01-15T12:00:00Z',
                timeUntilResetMs: 3600000
              },
              isExhausted: false
            }
          ]
        }
      }

      const snapshot = parseLocalQuotaSnapshot(userStatus)

      expect(snapshot.method).toBe('local')
      expect(snapshot.promptCredits).toEqual({
        available: 450,
        monthly: 500,
        usedPercentage: 0.1,
        remainingPercentage: 0.9
      })

      expect(snapshot.models).toHaveLength(1)
      expect(snapshot.models[0]).toEqual({
        modelId: 'gemini-2.0',
        label: 'Gemini 2.0',
        remainingPercentage: 0.8,
        isExhausted: false,
        resetTime: '2026-01-15T12:00:00Z',
        timeUntilResetMs: 3600000,
        isAutocompleteOnly: false
      })
    })

    it('should handle missing prompt credits', () => {
      const userStatus: ConnectUserStatus = {
        quota: {
          models: []
        }
      }

      const snapshot = parseLocalQuotaSnapshot(userStatus)
      expect(snapshot.promptCredits).toBeUndefined()
    })

    it('should handle zero limit prompt credits', () => {
      const userStatus: ConnectUserStatus = {
        quota: {
          promptCredits: {
            limit: 0,
            remaining: 0,
            used: 0
          }
        }
      }

      const snapshot = parseLocalQuotaSnapshot(userStatus)
      expect(snapshot.promptCredits).toBeUndefined()
    })

    it('should fall back to alternative field names', () => {
      const userStatus: ConnectUserStatus = {
        quota: {
          models: [
            {
              modelId: 'test-model',
              displayName: 'Display Name', // Fallback for label
              isExhausted: true
            }
          ]
        }
      }

      const snapshot = parseLocalQuotaSnapshot(userStatus)
      expect(snapshot.models[0].label).toBe('Display Name')
      expect(snapshot.models[0].isExhausted).toBe(true)
    })
  })
})
