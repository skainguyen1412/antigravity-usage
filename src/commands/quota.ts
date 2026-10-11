/**
 * Quota command - fetch and display quota information
 */

import { fetchQuota, type QuotaMethod } from '../quota/service.js'
import { printQuotaTable, printQuotaJson } from '../quota/format.js'
import { getTokenManager, getTokenManagerForAccount, resetTokenManager } from '../google/token-manager.js'
import { CloudCodeClient } from '../google/cloudcode.js'
import { getAccountManager, saveCache, loadCache, getCacheAge } from '../accounts/index.js'
import { renderAllQuotaTable, type AllAccountsQuotaResult } from '../render/index.js'
import { error as logError, debug, info } from '../core/logger.js'
import {
  NotLoggedInError,
  AuthenticationError,
  NetworkError,
  RateLimitError,
  APIError,
  AntigravityNotRunningError,
  LocalConnectionError,
  PortDetectionError,
  NoAuthMethodAvailableError
} from '../core/errors.js'

interface QuotaOptions {
  json?: boolean
  method?: QuotaMethod
  all?: boolean
  account?: string
  active?: boolean
  refresh?: boolean
  allModels?: boolean
  weekly?: boolean
}

/**
 * Probe weekly limit status for an account using a lightweight test request
 */
async function probeWeeklyLimit(email: string, modelId: string): Promise<{ ok: boolean; status: string; detail?: string }> {
  try {
    const tokenManager = getTokenManagerForAccount(email)
    const client = new CloudCodeClient(tokenManager)
    await client.generateContent(modelId, 'hi', 1)
    return { ok: true, status: '✅ Verified' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429')) {
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource_exhausted')) {
        return { ok: false, status: '❌ Exceeded', detail: msg }
      }
      return { ok: false, status: '⚠️ 5h Limit', detail: msg }
    }
    return { ok: false, status: '❓ Probe Err', detail: msg }
  }
}

/**
 * Fetch quota for a single account
 */
async function fetchSingleAccountQuota(options: QuotaOptions): Promise<void> {
  // Determine which account to use
  const manager = getAccountManager()
  const accountEmail = options.account || manager.getActiveEmail()
  const originalActiveEmail = manager.getActiveEmail()

  // Force google method when --account is specified
  // (local method always uses IDE's logged-in account)
  let method = options.method || 'auto'
  if (options.account && method !== 'google') {
    debug('quota', `Account specified, forcing google method (local uses IDE account)`)
    method = 'google'
  }

  // Only check login for google method
  if (method === 'google') {
    const tokenManager = options.account
      ? getTokenManagerForAccount(options.account)
      : getTokenManager()

    if (!tokenManager.isLoggedIn()) {
      logError('Not logged in. Run: antigravity-usage login')
      process.exit(1)
    }
  }

  try {
    // Temporarily switch to the target account if needed
    let accountSwitched = false

    if (options.account && options.account !== originalActiveEmail) {
      debug('quota', `Temporarily switching to account ${options.account} for fetch`)
      manager.setActiveAccount(options.account)
      accountSwitched = true
    }

    try {
      debug('quota', `Fetching fresh live quota via ${method} method...`)
      const snapshot = await fetchQuota(method)

      // If weekly probe requested, run live verification
      if (options.weekly && accountEmail) {
        info('🔍 Probing weekly limit status via live request...')
        const geminiProbe = await probeWeeklyLimit(accountEmail, 'gemini-3-flash')
        for (const m of snapshot.models) {
          if (m.modelId.toLowerCase().includes('gemini') || m.label.toLowerCase().includes('gemini')) {
            m.weeklyLimitStatus = geminiProbe.status
          }
        }

        const hasClaude = snapshot.models.some(m => m.modelId.toLowerCase().includes('claude'))
        if (hasClaude) {
          const claudeProbe = await probeWeeklyLimit(accountEmail, 'claude-sonnet-4-6')
          for (const m of snapshot.models) {
            if (m.modelId.toLowerCase().includes('claude') || m.label.toLowerCase().includes('claude')) {
              m.weeklyLimitStatus = claudeProbe.status
            }
          }
        }
      }

      // Cache the result if we have an account email (used for offline fallback)
      if (accountEmail) {
        saveCache(accountEmail, snapshot)
      }

      if (options.json) {
        printQuotaJson(snapshot)
      } else {
        printQuotaTable(snapshot, { allModels: options.allModels })
      }
    } finally {
      // Always restore original active account
      if (accountSwitched && originalActiveEmail) {
        debug('quota', `Restoring active account to ${originalActiveEmail}`)
        manager.setActiveAccount(originalActiveEmail)
      }
    }
  } catch (err) {
    handleQuotaError(err)
  }
}

/**
 * Fetch quota for all accounts (always fetches fresh live data on every run)
 */
async function fetchAllAccountsQuota(options: QuotaOptions): Promise<void> {
  const manager = getAccountManager()
  const emails = manager.getAccountEmails()
  const activeEmail = manager.getActiveEmail()

  if (emails.length === 0) {
    logError('No accounts found. Run: antigravity-usage login')
    process.exit(1)
  }

  const results: AllAccountsQuotaResult[] = []

  for (const email of emails) {
    const isActive = email === activeEmail

    try {
      // Fetch live data directly on each use (no stale cache by default)
      debug('quota', `Fetching live fresh quota for ${email}`)

      const snapshot = await fetchQuotaForAccount(email, options.method || 'auto')

      if (options.weekly) {
        info(`🔍 Probing weekly limit status for ${email}...`)
        const probe = await probeWeeklyLimit(email, 'gemini-3-flash')
        for (const m of snapshot.models) {
          if (m.modelId.toLowerCase().includes('gemini') || m.label.toLowerCase().includes('gemini')) {
            m.weeklyLimitStatus = probe.status
          }
        }
      }

      // Cache the fresh result (used for offline fallback)
      saveCache(email, snapshot)

      results.push({
        email,
        isActive,
        status: 'success',
        snapshot
      })
    } catch (err) {
      debug('quota', `Error fetching live quota for ${email}:`, err)

      // Fallback to cached data on network/API error
      const cached = loadCache(email)
      if (cached) {
        results.push({
          email,
          isActive,
          status: 'cached',
          snapshot: cached,
          cacheAge: getCacheAge(email) || 0
        })
      } else {
        results.push({
          email,
          isActive,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    renderAllQuotaTable(results, { allModels: options.allModels })
  }
}

/**
 * Fetch quota for a specific account
 */
async function fetchQuotaForAccount(email: string, method: QuotaMethod): Promise<any> {
  const manager = getAccountManager()
  const originalActiveEmail = manager.getActiveEmail()

  let effectiveMethod = method
  if (method === 'auto' || method === 'local') {
    effectiveMethod = 'google'
    debug('quota', `Forcing Google API for multi-account fetch (email: ${email})`)
  }

  // Temporarily switch to target account
  let accountSwitched = false
  if (email !== originalActiveEmail) {
    debug('quota', `Switching to ${email} for fetch`)
    manager.setActiveAccount(email)
    resetTokenManager()
    accountSwitched = true
  }

  try {
    const snapshot = await fetchQuota(effectiveMethod)
    return snapshot
  } finally {
    // Always restore original active account
    if (accountSwitched && originalActiveEmail) {
      debug('quota', `Restoring active account to ${originalActiveEmail}`)
      manager.setActiveAccount(originalActiveEmail)
      resetTokenManager()
    }
  }
}

/**
 * Handle quota errors
 */
function handleQuotaError(err: unknown): never {
  if (err instanceof NoAuthMethodAvailableError) {
    logError(err.message)
    process.exit(1)
  }

  if (err instanceof AntigravityNotRunningError) {
    logError(err.message)
    console.log('\nTip: Make sure Antigravity is running in your IDE (VSCode, etc.)')
    process.exit(1)
  }

  if (err instanceof LocalConnectionError) {
    logError(err.message)
    console.log('\nTip: Try restarting your IDE or the Antigravity extension.')
    process.exit(1)
  }

  if (err instanceof PortDetectionError) {
    logError(err.message)
    console.log('\nTip: This may happen if the Antigravity language server is still starting up.')
    process.exit(1)
  }

  if (err instanceof NotLoggedInError) {
    logError(err.message)
    process.exit(1)
  }

  if (err instanceof AuthenticationError) {
    logError(err.message)
    process.exit(1)
  }

  if (err instanceof NetworkError) {
    logError(err.message)
    process.exit(1)
  }

  if (err instanceof RateLimitError) {
    logError(err.message)
    if (err.retryAfterMs) {
      const seconds = Math.ceil(err.retryAfterMs / 1000)
      console.log(`Retry after ${seconds} seconds.`)
    }
    process.exit(1)
  }

  if (err instanceof APIError) {
    logError(err.message)
    process.exit(1)
  }

  logError(`Failed to fetch quota: ${err instanceof Error ? err.message : 'Unknown error'}`)
  debug('quota', 'Error details', err)
  process.exit(1)
}

export async function quotaCommand(options: QuotaOptions): Promise<void> {
  const manager = getAccountManager()
  const emails = manager.getAccountEmails()

  // If a specific account is requested via -a/--account
  if (options.account) {
    await fetchSingleAccountQuota(options)
    return
  }

  // If user explicitly asks for active account only
  if (options.active) {
    await fetchSingleAccountQuota(options)
    return
  }

  // If there are multiple accounts, or user explicitly passed --all, show all accounts automatically!
  if (options.all || emails.length > 1) {
    await fetchAllAccountsQuota(options)
  } else {
    await fetchSingleAccountQuota(options)
  }
}
