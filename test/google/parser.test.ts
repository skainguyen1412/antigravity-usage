/**
 * Tests for quota parser
 */

import { describe, it, expect } from 'vitest'
import { parseQuotaSnapshot } from '../../src/google/parser.js'
import type { LoadCodeAssistResponse, FetchAvailableModelsResponse } from '../../src/google/cloudcode.js'

describe('parseQuotaSnapshot', () => {
  it('should parse complete responses', () => {
    const codeAssistResponse: LoadCodeAssistResponse = {
      codeAssistEnabled: true,
      planInfo: {
        monthlyPromptCredits: 500,
        planType: 'premium'
      },
      availablePromptCredits: 450
    }

    // Models is now an object keyed by model ID
    const modelsResponse: FetchAvailableModelsResponse = {
      models: {
        'gemini-2.0-flash': {
          displayName: 'Gemini 2.0 Flash',
          model: 'MODEL_GEMINI_2_0_FLASH',
          quotaInfo: {
            remainingFraction: 0.85,
            resetTime: new Date(Date.now() + 3600000).toISOString(),
            isExhausted: false
          }
        },
        'claude-3.5-sonnet': {
          displayName: 'Claude 3.5 Sonnet',
          model: 'MODEL_CLAUDE_3_5_SONNET',
          quotaInfo: {
            remainingFraction: 0,
            isExhausted: true
          }
        }
      }
    }

    const snapshot = parseQuotaSnapshot(codeAssistResponse, modelsResponse)

    expect(snapshot.method).toBe('google')
    expect(snapshot.timestamp).toBeDefined()

    // Prompt credits
    expect(snapshot.promptCredits).toBeDefined()
    expect(snapshot.promptCredits?.available).toBe(450)
    expect(snapshot.promptCredits?.monthly).toBe(500)
    expect(snapshot.promptCredits?.remainingPercentage).toBe(0.9)
    expect(snapshot.promptCredits?.usedPercentage).toBe(0.1)

    // Models - sorted alphabetically
    expect(snapshot.models).toHaveLength(2)

    // Claude comes before Gemini alphabetically
    expect(snapshot.models[0].label).toBe('Claude 3.5 Sonnet')
    expect(snapshot.models[0].modelId).toBe('claude-3.5-sonnet')
    expect(snapshot.models[0].isExhausted).toBe(true)

    expect(snapshot.models[1].label).toBe('Gemini 2.0 Flash')
    expect(snapshot.models[1].modelId).toBe('gemini-2.0-flash')
    expect(snapshot.models[1].remainingPercentage).toBe(0.85)
    expect(snapshot.models[1].isExhausted).toBe(false)
    expect(snapshot.models[1].timeUntilResetMs).toBeGreaterThan(0)
  })

  it('should handle empty responses', () => {
    const codeAssistResponse: LoadCodeAssistResponse = {}
    const modelsResponse: FetchAvailableModelsResponse = {}

    const snapshot = parseQuotaSnapshot(codeAssistResponse, modelsResponse)

    expect(snapshot.method).toBe('google')
    expect(snapshot.promptCredits).toBeUndefined()
    expect(snapshot.models).toHaveLength(0)
  })

  it('should handle models without quota info (filtered out)', () => {
    const codeAssistResponse: LoadCodeAssistResponse = {
      availablePromptCredits: 100
      // Missing planInfo
    }

    // Model without quotaInfo should be filtered out
    const modelsResponse: FetchAvailableModelsResponse = {
      models: {
        'test-model': {
          displayName: 'Test Model'
          // Missing quotaInfo - will be filtered
        }
      }
    }

    const snapshot = parseQuotaSnapshot(codeAssistResponse, modelsResponse)

    expect(snapshot.promptCredits).toBeUndefined()
    // Model without quota info is filtered out
    expect(snapshot.models).toHaveLength(0)
  })

  it('should use model ID as label fallback', () => {
    const modelsResponse: FetchAvailableModelsResponse = {
      models: {
        'some-model-id': {
          // No displayName or label
          quotaInfo: {
            remainingFraction: 1
          }
        }
      }
    }

    const snapshot = parseQuotaSnapshot({}, modelsResponse)

    expect(snapshot.models[0].label).toBe('some-model-id')
  })

  it('should handle past reset times', () => {
    const modelsResponse: FetchAvailableModelsResponse = {
      models: {
        'test-model': {
          displayName: 'Test',
          quotaInfo: {
            remainingFraction: 0.5,
            resetTime: new Date(Date.now() - 1000).toISOString()  // Past time
          }
        }
      }
    }

    const snapshot = parseQuotaSnapshot({}, modelsResponse)

    expect(snapshot.models[0].timeUntilResetMs).toBeUndefined()
  })

  it('should filter out internal models', () => {
    const modelsResponse: FetchAvailableModelsResponse = {
      models: {
        'chat_12345': {
          displayName: 'Internal Chat',
          quotaInfo: { remainingFraction: 1 }
        },
        'tab_flash': {
          displayName: 'Tab Flash',
          quotaInfo: { remainingFraction: 1 }
        },
        'gemini-2.5-pro': {
          displayName: 'Gemini 2.5 Pro',
          quotaInfo: { remainingFraction: 0.8 }
        }
      }
    }

    const snapshot = parseQuotaSnapshot({}, modelsResponse)

    // Only gemini-2.5-pro should be included
    expect(snapshot.models.some(m => m.modelId === 'chat_12345')).toBe(false)
    expect(snapshot.models.some(m => m.modelId === 'tab_flash')).toBe(false)

    const gemini25 = snapshot.models.find(m => m.modelId === 'gemini-2.5-pro')
    expect(gemini25).toBeDefined()
    expect(gemini25?.isAutocompleteOnly).toBe(true)
  })

  it('should parse quotaSummaryResponse with weekly and 5h buckets', () => {
    const quotaSummaryResponse = {
      groups: [
        {
          displayName: 'Gemini Models',
          description: 'Gemini Flash, Gemini Pro',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              resetTime: '2026-09-14T12:00:00Z',
              remainingFraction: 1.0
            },
            {
              bucketId: 'gemini-5h',
              displayName: 'Five Hour Limit Remaining',
              window: '5h',
              resetTime: '2026-09-07T17:00:00Z',
              remainingFraction: 0.9
            }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          description: 'Claude Opus, Claude Sonnet',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              resetTime: '2026-09-12T20:00:00Z',
              remainingFraction: 0.75
            },
            {
              bucketId: '3p-5h',
              displayName: 'Five Hour Limit Remaining',
              window: '5h',
              resetTime: '2026-09-07T17:00:00Z',
              remainingFraction: 1.0
            }
          ]
        }
      ]
    }

    const snapshot = parseQuotaSnapshot({}, {}, 'developer@example.com', quotaSummaryResponse)

    expect(snapshot.email).toBe('developer@example.com')
    expect(snapshot.quotaGroups).toHaveLength(2)

    const geminiGroup = snapshot.quotaGroups?.find(g => g.displayName === 'Gemini Models')
    expect(geminiGroup).toBeDefined()
    expect(geminiGroup?.buckets).toHaveLength(2)
    expect(geminiGroup?.buckets[0].bucketId).toBe('gemini-weekly')
    expect(geminiGroup?.buckets[0].remainingPercentage).toBe(100)
    expect(geminiGroup?.buckets[1].bucketId).toBe('gemini-5h')
    expect(geminiGroup?.buckets[1].remainingPercentage).toBe(90)

    const claudeGroup = snapshot.quotaGroups?.find(g => g.displayName === 'Claude and GPT models')
    expect(claudeGroup).toBeDefined()
    expect(claudeGroup?.buckets[0].bucketId).toBe('3p-weekly')
    expect(claudeGroup?.buckets[0].remainingPercentage).toBe(75)
    expect(claudeGroup?.buckets[1].bucketId).toBe('3p-5h')
    expect(claudeGroup?.buckets[1].remainingPercentage).toBe(100)
  })
})
