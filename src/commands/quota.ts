/**
 * Quota command - fetch and display quota information
 */

import { fetchQuota, type QuotaMethod } from '../quota/service.js'
import { printQuotaTable, printQuotaJson } from '../quota/format.js'
import { getTokenManager, getTokenManagerForAccount, resetTokenManager } from '../google/token-manager.js'
import { getAccountManager, saveCache, isCacheValid, loadCache, getCacheAge } from '../accounts/index.js'
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
  refresh?: boolean
  allModels?: boolean
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
      debug('quota', `Fetching quota via ${method} method...`)
      const snapshot = await fetchQuota(method)

      // Cache the result if we have an account email
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
 * Fetch quota for all accounts
 */
async function fetchAllAccountsQuota(options: QuotaOptions): Promise<void> {
  const manager = getAccountManager()
  const emails = manager.getAccountEmails()
  const activeEmail = manager.getActiveEmail()

  if (emails.length === 0) {
    logError('No accounts found. Run: antigravity-usage login')
    process.exit(1)
  }

  if (options.refresh) {
    info('🔄 Refreshing quota data for all accounts...\n')
  }


  // IMPORTANT: Fetch sequentially, NOT in parallel
  // Parallel fetching causes race conditions with account switching
  const results: AllAccountsQuotaResult[] = []

  for (const email of emails) {
    const isActive = email === activeEmail

    try {
      // Check cache first (unless refresh requested)
      if (!options.refresh && isCacheValid(email)) {
        const cached = loadCache(email)
        if (cached) {
          debug('quota', `Using cached data for ${email}`)
          results.push({
            email,
            isActive,
            status: 'cached',
            snapshot: cached,
            cacheAge: getCacheAge(email) || 0
          })
          continue
        }
      }

      // Fetch fresh data
      debug('quota', `Fetching fresh data for ${email}`)

      const snapshot = await fetchQuotaForAccount(email, options.method || 'auto')

      // Cache the result
      saveCache(email, snapshot)

      results.push({
        email,
        isActive,
        status: 'success',
        snapshot
      })
    } catch (err) {
      debug('quota', `Error fetching quota for ${email}:`, err)

      // Try to use cached data on error
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

  // CRITICAL: Local method always returns IDE's logged-in account data
  // We CANNOT use local method for non-IDE accounts in multi-account mode
  // Force Google API method to ensure we get the correct account's data
  let effectiveMethod = method

  if (method === 'auto' || method === 'local') {
    // Always use Google API for multi-account to avoid cache pollution
    effectiveMethod = 'google'
    debug('quota', `Forcing Google API for multi-account fetch (email: ${email})`)
  }

  // Temporarily switch to target account
  let accountSwitched = false
  if (email !== originalActiveEmail) {
    debug('quota', `Switching to ${email} for fetch`)
    manager.setActiveAccount(email)
    // CRITICAL: Reset TokenManager singleton so it loads the new account's tokens
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
      // Reset TokenManager again to pick up original account's tokens
      resetTokenManager()
    }
  }
}

/**
 * Handle quota errors
 */
function handleQuotaError(err: unknown): never {
  // Auto mode: both methods unavailable
  if (err instanceof NoAuthMethodAvailableError) {
    logError(err.message)
    process.exit(1)
  }

  // Local method specific errors
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

  // Google method specific errors
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

  // Unknown error
  logError(`Failed to fetch quota: ${err instanceof Error ? err.message : 'Unknown error'}`)
  debug('quota', 'Error details', err)
  process.exit(1)
}

export async function quotaCommand(options: QuotaOptions): Promise<void> {
  if (options.all) {
    await fetchAllAccountsQuota(options)
  } else {
    await fetchSingleAccountQuota(options)
  }
}
