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
 * Format milliseconds to human readable time
 */
function formatTimeUntilReset(ms?: number): string {
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
function formatRemaining(model: ModelQuotaInfo): string {
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

  const visibleModels = options.allModels
    ? snapshot.models
    : snapshot.models.filter(m => !m.isAutocompleteOnly)

  if (visibleModels.length > 0) {
    const table = new Table({
      head: ['Model', 'Remaining', 'Resets In'],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    })

    for (const model of visibleModels) {
      table.push([
        model.label,
        formatRemaining(model),
        formatTimeUntilReset(model.timeUntilResetMs)
      ])
    }

    console.log(table.toString())
  } else {
    console.log('No model quota information available.')
    if (!options.allModels && snapshot.models.some(m => m.isAutocompleteOnly)) {
      console.log('Tip: Use --all-models to see autocomplete models.')
    }
  }

  // Display Quota Groups (Weekly & 5-Hour limits) if present
  if (snapshot.quotaGroups && snapshot.quotaGroups.length > 0) {
    console.log('\n📈 Quota Group Limits (Weekly & 5-Hour Windows):')
    const groupTable = new Table({
      head: ['Group', 'Window', 'Remaining', 'Reset Time'],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    })

    for (const group of snapshot.quotaGroups) {
      for (const bucket of group.buckets) {
        const pct = bucket.remainingPercentage
        const statusIcon = pct >= 75 ? `🟢 ${pct}%` : pct >= 50 ? `🟡 ${pct}%` : pct >= 25 ? `🟠 ${pct}%` : `🔴 ${pct}%`
        groupTable.push([
          group.displayName,
          bucket.displayName,
          statusIcon,
          bucket.resetTime ? new Date(bucket.resetTime).toLocaleString() : 'N/A'
        ])
      }
    }
    console.log(groupTable.toString())
  }

  console.log()
}

/**
 * Print quota as JSON
 */
export function printQuotaJson(snapshot: QuotaSnapshot): void {
  console.log(JSON.stringify(snapshot, null, 2))
}
