/**
 * Quota output formatting
 */

import Table from 'cli-table3'
import type { QuotaSnapshot, ModelQuotaInfo } from './types.js'

/**
 * Options for quota formatting
 */
export interface FormatOptions {
  allModels?: boolean
}

/**
 * Check if a model is part of the Gemini family
 */
export function isGeminiModel(model: ModelQuotaInfo): boolean {
  const id = model.modelId.toLowerCase()
  const label = model.label.toLowerCase()
  return id.includes('gemini') || label.includes('gemini')
}

/**
 * Format milliseconds to human readable time
 */
export function formatTimeUntilReset(ms?: number): string {
  if (ms === undefined || ms <= 0) return 'N/A'

  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Format remaining percentage for display
 */
export function formatRemaining(model: ModelQuotaInfo): string {
  if (model.isExhausted) {
    return '❌ EXHAUSTED'
  }
  if (model.remainingPercentage === undefined) {
    return 'N/A'
  }

  const pct = Math.round(model.remainingPercentage * 100)
  if (pct >= 75) return `🟢 ${pct}%`
  if (pct >= 50) return `🟡 ${pct}%`
  if (pct >= 25) return `🟠 ${pct}%`
  return `🔴 ${pct}%`
}

/**
 * Format weekly limit status
 */
export function formatWeeklyStatus(model: ModelQuotaInfo): string {
  if (model.weeklyLimitStatus) {
    return model.weeklyLimitStatus
  }

  // If reset time is longer than 5.5 hours, the model has exceeded the weekly quota limit
  if (model.timeUntilResetMs && model.timeUntilResetMs > 5.5 * 3600 * 1000) {
    return `❌ Exceeded (${formatTimeUntilReset(model.timeUntilResetMs)})`
  }

  if (model.isExhausted) {
    return '⚠️ 5h Limit'
  }

  return '🟢 Normal'
}

/**
 * Group models for display (consolidates all Gemini models into a single pool by default)
 */
export function groupModelsForDisplay(models: ModelQuotaInfo[], options: FormatOptions = {}): ModelQuotaInfo[] {
  const visible = options.allModels
    ? models
    : models.filter(m => !m.isAutocompleteOnly)

  if (options.allModels) {
    return visible
  }

  const geminiModels = visible.filter(isGeminiModel)
  const nonGeminiModels = visible.filter(m => !isGeminiModel(m))

  if (geminiModels.length === 0) {
    return visible
  }

  // Consolidate Gemini models: use minimum percentage across models
  const percentages = geminiModels
    .filter(m => m.remainingPercentage !== undefined)
    .map(m => m.remainingPercentage!)

  const minPercentage = percentages.length > 0 ? Math.min(...percentages) : undefined
  const isExhausted = geminiModels.some(m => m.isExhausted)
  const resetTime = geminiModels.find(m => m.resetTime)?.resetTime
  const timeUntilResetMs = geminiModels.find(m => m.timeUntilResetMs !== undefined)?.timeUntilResetMs
  const weeklyLimitStatus = geminiModels.find(m => m.weeklyLimitStatus)?.weeklyLimitStatus

  const geminiGroup: ModelQuotaInfo = {
    label: 'Gemini (All Models)',
    modelId: 'gemini-all',
    remainingPercentage: minPercentage,
    isExhausted,
    resetTime,
    timeUntilResetMs,
    weeklyLimitStatus,
    isAutocompleteOnly: false
  }

  const result = [...nonGeminiModels, geminiGroup]
  result.sort((a, b) => a.label.localeCompare(b.label))
  return result
}

/**
 * Print quota as a formatted table
 */
export function printQuotaTable(snapshot: QuotaSnapshot, options: FormatOptions = {}): void {
  const timestamp = new Date(snapshot.timestamp).toLocaleString()

  console.log()
  console.log(`📊 Antigravity Quota Status (via ${snapshot.method.toUpperCase()})`)
  console.log(`   Retrieved: ${timestamp}`)

  // Display user info
  if (snapshot.email || snapshot.planType) {
    const userParts: string[] = []
    if (snapshot.email) {
      userParts.push(`👤 ${snapshot.email}`)
    }
    if (snapshot.planType) {
      userParts.push(`📋 Plan: ${snapshot.planType}`)
    }
    console.log(`   ${userParts.join(' | ')}`)
  }

  const displayModels = groupModelsForDisplay(snapshot.models, options)

  if (displayModels.length > 0) {
    const table = new Table({
      head: ['Model / Pool', 'Quota Remaining', 'Resets In', 'Status'],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    })

    for (const model of displayModels) {
      table.push([
        model.label,
        formatRemaining(model),
        formatTimeUntilReset(model.timeUntilResetMs),
        formatWeeklyStatus(model)
      ])
    }

    console.log(table.toString())
    console.log('ℹ️  Quota % reflects remaining capacity in the active rolling window (5-hour reset cycle).')
    console.log('ℹ️  Google enforces an unmetered weekly safety ceiling; if exceeded, status changes to Weekly Limit.')
    if (!options.allModels) {
      console.log('💡 Tip: Gemini models share the same quota pool. Use --all-models to see individual model breakdown.')
    }
  } else {
    console.log('No model quota information available.')
    if (!options.allModels && snapshot.models.some(m => m.isAutocompleteOnly)) {
      console.log('Tip: Use --all-models to see autocomplete models.')
    }
  }

  console.log()
}

/**
 * Print quota as JSON
 */
export function printQuotaJson(snapshot: QuotaSnapshot): void {
  console.log(JSON.stringify(snapshot, null, 2))
}
