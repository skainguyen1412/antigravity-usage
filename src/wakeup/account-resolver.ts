/**
 * Account resolver for auto wake-up
 * Resolves which accounts to use for triggering based on config and availability
 */

import { debug } from '../core/logger.js'
import { getAccountManager } from '../accounts/manager.js'

/**
 * Resolve which accounts to use for triggering
 * @param selectedAccounts Explicitly selected accounts from config (may be undefined)
 * @returns Array of valid account emails to use for triggering
 */
export function resolveAccounts(selectedAccounts?: string[]): string[] {
  const accountManager = getAccountManager()
  
  // Case 1: Explicit selection (even if empty array)
  if (selectedAccounts !== undefined) {
    debug('account-resolver', `Explicit account selection: ${selectedAccounts.length} accounts`)
    
    // Filter to only valid accounts
    const validAccounts = selectedAccounts.filter(email => {
      if (!accountManager.hasAccount(email)) {
        debug('account-resolver', `Account ${email} not found, skipping`)
        return false
      }
      
      const status = accountManager.getAccountStatus(email)
      if (status === 'invalid') {
        debug('account-resolver', `Account ${email} is invalid, skipping`)
        return false
      }
      
      // 'valid' or 'expired' (expired can be refreshed)
      return true
    })
    
    debug('account-resolver', `Resolved ${validAccounts.length} valid accounts from selection`)
    return validAccounts
  }
  
  // Case 2: No explicit selection - use fallback logic
  debug('account-resolver', 'No explicit selection, using fallback logic')
  
  // Prefer active account if valid
  const activeEmail = accountManager.getActiveEmail()
  if (activeEmail) {
    const status = accountManager.getAccountStatus(activeEmail)
    if (status === 'valid' || status === 'expired') {
      debug('account-resolver', `Using active account: ${activeEmail}`)
      return [activeEmail]
    }
    debug('account-resolver', `Active account ${activeEmail} is ${status}, trying fallback`)
  }
  
  // Fallback: use first available valid account
  const allEmails = accountManager.getAccountEmails()
  for (const email of allEmails) {
    const status = accountManager.getAccountStatus(email)
    if (status === 'valid' || status === 'expired') {
      debug('account-resolver', `Fallback to first valid account: ${email}`)
      return [email]
    }
  }
  
  // No valid accounts
  debug('account-resolver', 'No valid accounts found')
  return []
}

/**
 * Check if any accounts are available for triggering
 */
export function hasValidAccounts(selectedAccounts?: string[]): boolean {
  return resolveAccounts(selectedAccounts).length > 0
}

/**
 * Get a friendly description of account resolution state
 */
export function getAccountResolutionStatus(selectedAccounts?: string[]): string {
  const resolved = resolveAccounts(selectedAccounts)
  
  if (resolved.length === 0) {
    if (selectedAccounts !== undefined && selectedAccounts.length > 0) {
      return 'Selected accounts are invalid or not found'
    }
    return 'No valid accounts available'
  }
  
  if (resolved.length === 1) {
    return `Using account: ${resolved[0]}`
  }
  
  return `Using ${resolved.length} accounts: ${resolved.join(', ')}`
}
