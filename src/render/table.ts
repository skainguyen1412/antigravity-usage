/**
 * Table rendering utilities for multi-account displays
 */

import Table from 'cli-table3'
import type { AccountSummary } from '../accounts/types.js'
import type { QuotaSnapshot, ModelQuotaInfo } from '../quota/types.js'
import { formatRemaining, formatTimeUntilReset, isGeminiModel } from '../quota/format.js'

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return 'Never'

  const date = new Date(isoDate)
  const now = Date.now()
  const diffMs = now - date.getTime()

  const minutes = Math.floor(diffMs / (1000 * 60))
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

/**
 * Format status icon
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'valid': return '✅'
    case 'expired': return '⚠️'
    case 'invalid': return '❌'
    default: return '❓'
  }
}

/**
 * Format credits display
 */
function formatCredits(credits: { used: number; limit: number } | null | undefined): string {
  if (!credits) return '-'
  return `${credits.limit - credits.used} / ${credits.limit}`
}

/**
 * Render accounts list as a table
 */
export function renderAccountsTable(accounts: AccountSummary[]): void {
  if (accounts.length === 0) {
    console.log('\n📫 No accounts found.')
    console.log('\n💡 Run `antigravity-usage login` to add an account.\n')
    return
  }

  console.log('\n📊 Antigravity Accounts')
  console.log('═'.repeat(60))

  const totalWidth = process.stdout.columns || 80
  const isSmallTerminal = totalWidth < 90

  const colWidths = isSmallTerminal
    ? [25, 8, 12, 12]
    : [30, 10, 15, 15]

  const finalColWidths = totalWidth < 60 ? undefined : colWidths

  const tableOptions: any = {
    head: ['Account', 'Status', 'Credits', 'Last Used'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  }

  if (finalColWidths) {
    tableOptions.colWidths = finalColWidths
  }

  const table = new Table(tableOptions)

  for (const account of accounts) {
    const nameDisplay = account.isActive
      ? `${account.email} [*]`
      : account.email

    table.push([
      nameDisplay,
      formatStatus(account.status),
      formatCredits(account.cachedCredits),
      formatRelativeTime(account.lastUsed)
    ])
  }

  console.log(table.toString())
  console.log('\n[*] = active account\n')
}

/**
 * Quota result for all accounts display
 */
export interface AllAccountsQuotaResult {
  email: string
  isActive: boolean
  status: 'success' | 'error' | 'cached'
  error?: string
  snapshot?: QuotaSnapshot
  cacheAge?: number
}

/**
 * Options for quota rendering
 */
export interface RenderOptions {
  allModels?: boolean
}

/**
 * Render quota for all accounts as a table
 */
export function renderAllQuotaTable(results: AllAccountsQuotaResult[], options: RenderOptions = {}): void {
  if (results.length === 0) {
    console.log('\n📫 No accounts found.')
    console.log('\n💡 Run `antigravity-usage login` to add an account.\n')
    return
  }

  // Sort by quota remaining (highest to lowest)
  const sortedResults = [...results].sort((a, b) => {
    // Errors go last
    if (a.status === 'error' && b.status !== 'error') return 1
    if (a.status !== 'error' && b.status === 'error') return -1
    if (a.status === 'error' && b.status === 'error') return 0

    const getRemaining = (result: AllAccountsQuotaResult): number => {
      const models = result.snapshot?.models || []
      const gemini = models.find(isGeminiModel)
      if (gemini?.isExhausted) return 0
      return gemini?.remainingPercentage ?? -1
    }

    return getRemaining(b) - getRemaining(a)
  })

  console.log('\n📊 Quota Overview - All Accounts')
  console.log('═'.repeat(70))

  const totalWidth = process.stdout.columns || 80

  let colWidths: number[] | undefined

  if (totalWidth < 80) {
    colWidths = undefined
  } else if (totalWidth < 100) {
    colWidths = [24, 14, 14, 10, 15]
  } else {
    colWidths = [30, 16, 16, 12, 16]
  }

  const tableOptions: any = {
    head: ['Account', 'Gemini Quota', 'Claude Quota', 'Resets In', 'Status'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  }

  if (colWidths) {
    tableOptions.colWidths = colWidths
  }

  const table = new Table(tableOptions)
  const errors: string[] = []

  for (const result of sortedResults) {
    const nameDisplay = result.isActive
      ? `${result.email} [*]`
      : result.email

    if (result.status === 'error') {
      table.push([
        nameDisplay,
        '-',
        '-',
        '-',
        result.error || 'Error'
      ])
      errors.push(`${result.email}: ${result.error}`)
    } else {
      const snapshot = result.snapshot
      const models = snapshot?.models || []
      const relevantModels = options.allModels
        ? models
        : models.filter(m => !m.isAutocompleteOnly)

      // Gemini models pool
      const geminiModels = relevantModels.filter(isGeminiModel)
      let geminiDisplay = '-'
      let geminiResetMs: number | undefined
      if (geminiModels.length > 0) {
        const geminiPercentages = geminiModels
          .filter(m => m.remainingPercentage !== undefined)
          .map(m => m.remainingPercentage!)
        const minGeminiPct = geminiPercentages.length > 0 ? Math.min(...geminiPercentages) : undefined
        const isExhausted = geminiModels.some(m => m.isExhausted)
        geminiResetMs = geminiModels.find(m => m.timeUntilResetMs !== undefined)?.timeUntilResetMs
        const fakeModel: ModelQuotaInfo = {
          label: 'Gemini',
          modelId: 'gemini-all',
          remainingPercentage: minGeminiPct,
          isExhausted,
          timeUntilResetMs: geminiResetMs
        }
        geminiDisplay = formatRemaining(fakeModel)
      }

      // Claude models pool
      const claudeModels = relevantModels.filter(m => {
        const id = m.modelId.toLowerCase()
        const label = m.label.toLowerCase()
        return id.includes('claude') || label.includes('claude')
      })
      let claudeDisplay = '-'
      let claudeResetMs: number | undefined
      if (claudeModels.length > 0) {
        const claudePercentages = claudeModels
          .filter(m => m.remainingPercentage !== undefined)
          .map(m => m.remainingPercentage!)
        const minClaudePct = claudePercentages.length > 0 ? Math.min(...claudePercentages) : undefined
        const isExhausted = claudeModels.some(m => m.isExhausted)
        claudeResetMs = claudeModels.find(m => m.timeUntilResetMs !== undefined)?.timeUntilResetMs
        const fakeModel: ModelQuotaInfo = {
          label: 'Claude',
          modelId: 'claude-all',
          remainingPercentage: minClaudePct,
          isExhausted,
          timeUntilResetMs: claudeResetMs
        }
        claudeDisplay = formatRemaining(fakeModel)
      }

      // Status
      let statusDisplay = '🟢 Normal'
      if (relevantModels.some(m => m.timeUntilResetMs && m.timeUntilResetMs > 5.5 * 3600 * 1000)) {
        const maxReset = Math.max(...relevantModels.filter(m => m.timeUntilResetMs).map(m => m.timeUntilResetMs!))
        statusDisplay = `❌ Weekly Limit (${formatTimeUntilReset(maxReset)})`
      } else if (relevantModels.some(m => m.weeklyLimitStatus)) {
        statusDisplay = relevantModels.find(m => m.weeklyLimitStatus)!.weeklyLimitStatus!
      } else if (relevantModels.some(m => m.isExhausted)) {
        statusDisplay = '⚠️ 5h Limit'
      }

      // Reset time
      const resetMs = geminiResetMs ?? claudeResetMs ?? relevantModels.find(m => m.timeUntilResetMs !== undefined)?.timeUntilResetMs
      const resetDisplay = formatTimeUntilReset(resetMs)

      table.push([
        nameDisplay,
        geminiDisplay,
        claudeDisplay,
        resetDisplay,
        statusDisplay
      ])
    }
  }

  console.log(table.toString())

  // Show errors if any
  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} account(s) had errors:`)
    for (const err of errors) {
      console.log(`   - ${err}`)
    }
  }

  console.log('\n[*] = active account')
  console.log('ℹ️  Quota % reflects remaining capacity in the active rolling window (5-hour reset cycle).')
  console.log('ℹ️  Google enforces an unmetered weekly safety ceiling; if exceeded, status changes to Weekly Limit.')
  console.log('💡 Run `antigravity-usage -a <email>` for single account details | Use -w to test weekly limits\n')
}

export function formatCacheAge(seconds: number | undefined): string {
  if (seconds === undefined) return '?'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}
