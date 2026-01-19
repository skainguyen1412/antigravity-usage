/**
 * Token manager with automatic refresh
 * 
 * Updated for multi-account support - can manage tokens for specific accounts
 * or default to the active account.
 */

import { loadTokens, saveTokens, hasTokens } from './storage.js'
import { refreshAccessToken } from './oauth.js'
import { debug } from '../core/logger.js'
import { NotLoggedInError, TokenRefreshError } from '../core/errors.js'
import { 
  getActiveAccountEmail,
  loadAccountTokens,
  saveAccountTokens,
  accountExists,
  updateLastUsed
} from '../accounts/index.js'
import type { StoredTokens } from '../quota/types.js'

// Refresh token 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

/**
 * Token manager class for handling authentication
 * Can work with active account or a specific account email
 */
export class TokenManager {
  private tokens: StoredTokens | null = null
  private accountEmail: string | null = null
  
  constructor(email?: string) {
    if (email) {
      // Specific account requested
      this.accountEmail = email
      this.tokens = loadAccountTokens(email)
    } else {
      // Use active account
      this.accountEmail = getActiveAccountEmail()
      
      // If we have an active account email, use account-specific storage
      // Otherwise fall back to legacy default storage
      if (this.accountEmail) {
        this.tokens = loadAccountTokens(this.accountEmail)
      } else {
        this.tokens = loadTokens()
      }
    }
  }
  
  /**
   * Get the email this manager is for
   */
  getAccountEmail(): string | null {
    return this.accountEmail || this.tokens?.email || null
  }
  
  /**
   * Check if user is logged in (has tokens)
   */
  isLoggedIn(): boolean {
    if (this.accountEmail) {
      return accountExists(this.accountEmail) && this.tokens !== null
    }
    return hasTokens() && this.tokens !== null
  }
  
  /**
   * Get the stored email
   */
  getEmail(): string | undefined {
    return this.tokens?.email
  }
  
  /**
   * Get token expiry time
   */
  getExpiresAt(): Date | undefined {
    if (!this.tokens) return undefined
    return new Date(this.tokens.expiresAt)
  }
  
  /**
   * Get stored project ID
   */
  getProjectId(): string | undefined {
    return this.tokens?.projectId
  }
  
  /**
   * Set and persist project ID
   */
  setProjectId(projectId: string): void {
    if (!this.tokens) return
    
    this.tokens.projectId = projectId
    
    // Save to disk
    if (this.accountEmail) {
      saveAccountTokens(this.accountEmail, this.tokens)
    } else {
      saveTokens(this.tokens)
    }
    
    debug('token-manager', `Project ID saved: ${projectId}`)
  }
  
  /**
   * Check if token is expired or about to expire
   */
  isTokenExpired(): boolean {
    if (!this.tokens) return true
    return Date.now() >= this.tokens.expiresAt - EXPIRY_BUFFER_MS
  }
  
  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new NotLoggedInError()
    }
    
    debug('token-manager', 'Checking token validity')
    
    // Check if token needs refresh
    if (this.isTokenExpired()) {
      debug('token-manager', 'Token expired or expiring soon, refreshing...')
      await this.refreshToken()
    }
    
    return this.tokens.accessToken
  }
  
  /**
   * Refresh the access token with retry logic
   * Retries on transient network errors, fails immediately on permanent errors (invalid_grant)
   */
  async refreshToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new NotLoggedInError('No refresh token available. Please login again.')
    }
    
    const MAX_RETRIES = 3
    const BASE_DELAY_MS = 1000  // 1s, 2s, 4s exponential backoff
    
    let lastError: Error | undefined
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        debug('token-manager', `Refreshing token (attempt ${attempt}/${MAX_RETRIES})...`)
        const response = await refreshAccessToken(this.tokens.refreshToken)
        
        // Update tokens
        this.tokens = {
          accessToken: response.access_token,
          refreshToken: response.refresh_token || this.tokens.refreshToken,
          expiresAt: Date.now() + response.expires_in * 1000,
          email: this.tokens.email,
          projectId: this.tokens.projectId
        }
        
        // Save to disk
        if (this.accountEmail) {
          saveAccountTokens(this.accountEmail, this.tokens)
          updateLastUsed(this.accountEmail)
        } else {
          saveTokens(this.tokens)
        }
        
        debug('token-manager', 'Token refreshed successfully')
        return  // Success!
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        
        // Check if this is a permanent error (don't retry)
        const errorMessage = lastError.message.toLowerCase()
        const isPermanentError = 
          errorMessage.includes('invalid_grant') ||
          errorMessage.includes('400') ||
          errorMessage.includes('401') ||
          errorMessage.includes('invalid_token') ||
          errorMessage.includes('token has been revoked')
        
        if (isPermanentError) {
          debug('token-manager', `Token refresh failed permanently: ${lastError.message}`)
          throw new TokenRefreshError(
            `Refresh token invalid or expired. Please login again.`,
            { cause: lastError, isRetryable: false }
          )
        }
        
        // Transient error - retry with exponential backoff
        if (attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
          debug('token-manager', `Token refresh attempt ${attempt} failed: ${lastError.message}. Retrying in ${delayMs}ms...`)
          await this.sleep(delayMs)
        } else {
          debug('token-manager', `Token refresh failed after ${MAX_RETRIES} attempts: ${lastError.message}`)
        }
      }
    }
    
    // All retries exhausted
    throw new TokenRefreshError(
      `Failed to refresh token after ${MAX_RETRIES} attempts`,
      { cause: lastError, isRetryable: true }
    )
  }
  
  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  /**
   * Reload tokens from disk
   */
  reload(): void {
    if (this.accountEmail) {
      this.tokens = loadAccountTokens(this.accountEmail)
    } else {
      this.tokens = loadTokens()
    }
  }
}

// Singleton instance for default (active account) manager
let tokenManagerInstance: TokenManager | null = null

/**
 * Get the token manager instance for active account
 */
export function getTokenManager(): TokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager()
  }
  return tokenManagerInstance
}

/**
 * Get token manager for a specific account
 */
export function getTokenManagerForAccount(email: string): TokenManager {
  return new TokenManager(email)
}

/**
 * Reset the token manager (for testing or after account changes)
 */
export function resetTokenManager(): void {
  tokenManagerInstance = null
}
