/**
 * Table rendering utilities for multi-account displays
 */

import Table from 'cli-table3'
import type { AccountSummary } from '../accounts/types.js'
import type { QuotaSnapshot } from '../quota/types.js'

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
    console.log('\n📭 No accounts found.')
    console.log('\n💡 Run `antigravity-usage login` to add an account.\n')
    return
  }

  console.log('\n📊 Antigravity Accounts')
  console.log('═'.repeat(60))

  const totalWidth = process.stdout.columns || 80
  const isSmallTerminal = totalWidth < 90

  // Dynamic column widths
  // If small terminal, use tighter packing
  const colWidths = isSmallTerminal
    ? [25, 8, 12, 12] // Tighter widths for < 90 cols
    : [30, 10, 15, 15] // Standard widths

  // Ensure we don't exceed total width with borders (approx 10 chars)
  // If extremely small, let cli-table handle auto-sizing (pass undefined)
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
 * Format quota remaining bar
 */
function formatQuotaRemainingBar(remainingPercentage: number | undefined): string {
  const width = 10
  const filledChar = '█'
  const emptyChar = '░'

  if (remainingPercentage === undefined) {
    return `${emptyChar.repeat(width)} N/A`
  }

  const filled = Math.round((remainingPercentage / 100) * width)
  const empty = width - filled

  return `${filledChar.repeat(filled)}${emptyChar.repeat(empty)} ${Math.round(remainingPercentage)}%`
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
    console.log('\n📭 No accounts found.')
    console.log('\n💡 Run `antigravity-usage login` to add an account.\n')
    return
  }

  // Sort by quota remaining (highest to lowest)
  const sortedResults = [...results].sort((a, b) => {
    // Errors go last
    if (a.status === 'error' && b.status !== 'error') return 1
    if (a.status !== 'error' && b.status === 'error') return -1
    if (a.status === 'error' && b.status === 'error') return 0

    // Get remaining percentage for comparison
    const getRemaining = (result: AllAccountsQuotaResult): number => {
      // Filter out autocomplete models if requested
      const models = options.allModels
        ? result.snapshot?.models
        : result.snapshot?.models?.filter(m => !m.isAutocompleteOnly)

      const firstModel = models?.[0]
      if (!firstModel) return -1
      if (firstModel.isExhausted) return 0
      return firstModel.remainingPercentage ?? -1
    }

    const aRemaining = getRemaining(a)
    const bRemaining = getRemaining(b)

    // Sort descending (highest first)
    return bRemaining - aRemaining
  })

  console.log('\n📊 Quota Overview - All Accounts')
  console.log('═'.repeat(70))

  const totalWidth = process.stdout.columns || 80

  // Calculate responsive widths
  // Standard: [30, 10, 15, 20] = ~75 content + 13 border = 88 chars

  let colWidths: number[] | undefined

  if (totalWidth < 80) {
    // Very small: auto-size or strict truncation
    colWidths = undefined
  } else if (totalWidth < 100) {
    // Compact mode
    colWidths = [25, 8, 12, 18]
  } else {
    // Spacious mode (fill remaining space with email column?)
    // For now keep standard spacious defaults
    colWidths = [30, 10, 15, 20]
  }

  const tableOptions: any = {
    head: ['Account', 'Source', 'Credits', 'Quota Remaining'],
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
        result.error || 'Error'
      ])
      errors.push(`${result.email}: ${result.error}`)
    } else {
      const snapshot = result.snapshot
      const source = result.status === 'cached'
        ? `Cached (${formatCacheAge(result.cacheAge)})`
        : (snapshot?.method.toUpperCase() || '-')

      // Get credits
      let credits = '-'
      if (snapshot?.promptCredits) {
        const pc = snapshot.promptCredits
        credits = `${pc.available} / ${pc.monthly}`
      }

      // Show the MINIMUM remaining percentage across relevant models
      // (This is the most constrained/concerning value for the user)
      let quotaRemaining = '-'
      const models = snapshot?.models || []
      const relevantModels = options.allModels
        ? models
        : models.filter(m => !m.isAutocompleteOnly)

      if (relevantModels.length > 0) {
        // Find minimum remaining percentage among relevant models
        const percentages = relevantModels
          .filter(m => m.remainingPercentage !== undefined)
          .map(m => m.remainingPercentage!)

        if (percentages.length > 0) {
          const minRemaining = Math.min(...percentages)
          quotaRemaining = formatQuotaRemainingBar(minRemaining * 100)
        } else if (relevantModels.some(m => m.isExhausted)) {
          quotaRemaining = '❌ EXHAUSTED'
        } else {
          quotaRemaining = formatQuotaRemainingBar(undefined)
        }
      }

      table.push([
        nameDisplay,
        source,
        credits,
        quotaRemaining
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
  console.log('💡 Use --refresh to fetch latest data\n')
}

function formatCacheAge(seconds: number | undefined): string {
  if (seconds === undefined) return '?'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}
