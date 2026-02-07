/**
 * Login command - authenticate with Google
 * 
 * This is kept for backward compatibility.
 * For multi-account management, use `antigravity-usage accounts add`
 */

import { startOAuthFlow } from '../google/oauth.js'
import { getAccountManager } from '../accounts/index.js'
import { success, error as logError, info } from '../core/logger.js'
import { resetTokenManager } from '../google/token-manager.js'

interface LoginOptions {
  noBrowser?: boolean
  port?: number
  manual?: boolean
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const manager = getAccountManager()
  const existingAccounts = manager.getAccountEmails()
  
  if (existingAccounts.length > 0) {
    info(`You have ${existingAccounts.length} account(s). Adding another account...`)
  }
  
  const result = await startOAuthFlow({
    noBrowser: options.noBrowser,
    port: options.port,
    manual: options.manual
  })
  
  if (result.success) {
    // Reset token manager to pick up new active account
    resetTokenManager()
    
    success(`Logged in successfully${result.email ? ` as ${result.email}` : ''}!`)
    
    const accounts = manager.getAccountEmails()
    if (accounts.length > 1) {
      info(`\nYou now have ${accounts.length} accounts. Use \`antigravity-usage accounts list\` to see all.`)
    }
    
    process.exit(0)
  } else {
    logError(`Login failed: ${result.error}`)
    process.exit(1)
  }
}
