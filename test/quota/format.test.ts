/**
 * Tests for quota formatting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  printQuotaTable,
  printQuotaJson,
  groupModelsForDisplay,
  formatWeeklyStatus,
  isGeminiModel
} from '../../src/quota/format.js'
import type { QuotaSnapshot, ModelQuotaInfo } from '../../src/quota/types.js'

describe('printQuotaJson', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('should output valid JSON', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      models: []
    }

    printQuotaJson(snapshot)

    expect(consoleSpy).toHaveBeenCalledOnce()
    const output = consoleSpy.mock.calls[0][0]
    const parsed = JSON.parse(output as string)
    expect(parsed.method).toBe('google')
  })
})

describe('isGeminiModel', () => {
  it('identifies gemini models correctly', () => {
    expect(isGeminiModel({ label: 'Gemini 3 Flash', modelId: 'gemini-3-flash', isExhausted: false })).toBe(true)
    expect(isGeminiModel({ label: 'Custom', modelId: 'gemini-3.1-pro', isExhausted: false })).toBe(true)
    expect(isGeminiModel({ label: 'Claude Opus', modelId: 'claude-opus-4-6', isExhausted: false })).toBe(false)
  })
})

describe('formatWeeklyStatus', () => {
  it('returns Normal for active models under 5.5 hours', () => {
    const model: ModelQuotaInfo = {
      label: 'Gemini',
      modelId: 'gemini',
      isExhausted: false,
      timeUntilResetMs: 18000000 // 5 hours
    }
    expect(formatWeeklyStatus(model)).toBe('🟢 Normal')
  })

  it('returns Exceeded for reset durations longer than 5.5 hours', () => {
    const model: ModelQuotaInfo = {
      label: 'Gemini',
      modelId: 'gemini',
      isExhausted: true,
      timeUntilResetMs: 86400000 // 24 hours
    }
    expect(formatWeeklyStatus(model)).toContain('❌ Exceeded')
  })

  it('uses custom weeklyLimitStatus if provided', () => {
    const model: ModelQuotaInfo = {
      label: 'Gemini',
      modelId: 'gemini',
      isExhausted: false,
      weeklyLimitStatus: '✅ Verified'
    }
    expect(formatWeeklyStatus(model)).toBe('✅ Verified')
  })
})

describe('groupModelsForDisplay', () => {
  it('consolidates multiple Gemini models into a single entry by default', () => {
    const models: ModelQuotaInfo[] = [
      { label: 'Claude Sonnet', modelId: 'claude-sonnet', isExhausted: false, remainingPercentage: 1 },
      { label: 'Gemini 3 Flash', modelId: 'gemini-3-flash', isExhausted: false, remainingPercentage: 0.95, timeUntilResetMs: 17000000 },
      { label: 'Gemini 3.1 Pro', modelId: 'gemini-3.1-pro', isExhausted: false, remainingPercentage: 0.95, timeUntilResetMs: 17000000 }
    ]

    const grouped = groupModelsForDisplay(models)
    expect(grouped.length).toBe(2)

    const gemini = grouped.find(m => m.label.includes('Gemini'))
    expect(gemini).toBeDefined()
    expect(gemini?.label).toBe('Gemini (All Models)')
    expect(gemini?.remainingPercentage).toBe(0.95)

    const claude = grouped.find(m => m.label.includes('Claude'))
    expect(claude).toBeDefined()
  })

  it('leaves models unbundled when allModels is true', () => {
    const models: ModelQuotaInfo[] = [
      { label: 'Gemini 3 Flash', modelId: 'gemini-3-flash', isExhausted: false, remainingPercentage: 0.95 },
      { label: 'Gemini 3.1 Pro', modelId: 'gemini-3.1-pro', isExhausted: false, remainingPercentage: 0.95 }
    ]

    const result = groupModelsForDisplay(models, { allModels: true })
    expect(result.length).toBe(2)
  })
})

describe('printQuotaTable', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('should output table format', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      promptCredits: {
        available: 450,
        monthly: 500,
        usedPercentage: 0.1,
        remainingPercentage: 0.9
      },
      models: [
        {
          label: 'Test Model',
          modelId: 'test-model',
          remainingPercentage: 0.85,
          isExhausted: false,
          timeUntilResetMs: 3600000
        }
      ]
    }

    printQuotaTable(snapshot)

    expect(consoleSpy.mock.calls.length).toBeGreaterThan(2)
    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('Antigravity')
    expect(allOutput).toContain('Test Model')
    expect(allOutput).toContain('85%')
  })

  it('should handle exhausted models', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      models: [
        {
          label: 'Exhausted Model',
          modelId: 'exhausted',
          isExhausted: true
        }
      ]
    }

    printQuotaTable(snapshot)

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('EXHAUSTED')
  })

  it('should filter autocomplete models by default', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      models: [
        {
          label: 'Coding Model',
          modelId: 'coding',
          isExhausted: false,
          isAutocompleteOnly: false
        },
        {
          label: 'Autocomplete Model',
          modelId: 'gemini-2.5-flash',
          isExhausted: false,
          isAutocompleteOnly: true
        }
      ]
    }

    printQuotaTable(snapshot)

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('Coding Model')
    expect(allOutput).not.toContain('Autocomplete Model')
  })

  it('should show autocomplete models when allModels option is true', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      models: [
        {
          label: 'Autocomplete Model',
          modelId: 'gemini-2.5-flash',
          isExhausted: false,
          isAutocompleteOnly: true
        }
      ]
    }

    printQuotaTable(snapshot, { allModels: true })

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('Autocomplete Model')
  })

  it('should consolidate Gemini models in table output by default', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: '2026-01-14T12:00:00.000Z',
      method: 'google',
      models: [
        {
          label: 'Gemini 3 Flash',
          modelId: 'gemini-3-flash',
          isExhausted: false,
          remainingPercentage: 0.98,
          timeUntilResetMs: 17800000
        },
        {
          label: 'Gemini 3.1 Pro',
          modelId: 'gemini-3.1-pro',
          isExhausted: false,
          remainingPercentage: 0.98,
          timeUntilResetMs: 17800000
        }
      ]
    }

    printQuotaTable(snapshot)

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(allOutput).toContain('Gemini (All Models)')
    expect(allOutput).toContain('98%')
    expect(allOutput).not.toContain('Gemini 3 Flash')
    expect(allOutput).not.toContain('Gemini 3.1 Pro')
  })
})
