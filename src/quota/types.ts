/**
 * Quota data types
 */

export interface QuotaSnapshot {
  timestamp: string
  method: 'google' | 'local'
  email?: string
  planType?: string
  promptCredits?: PromptCreditsInfo
  models: ModelQuotaInfo[]
}

export interface ModelQuotaInfo {
  label: string
  modelId: string
  remainingPercentage?: number
  isExhausted: boolean
  resetTime?: string
  timeUntilResetMs?: number
  isAutocompleteOnly?: boolean
}

export interface PromptCreditsInfo {
  available: number
  monthly: number
  usedPercentage: number
  remainingPercentage: number
}

/**
 * Stored token data
 */
export interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in ms
  email?: string
  projectId?: string
}

/**
 * OAuth response from token endpoint
 */
export interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

/**
 * User info from Google
 */
export interface GoogleUserInfo {
  email: string
  name?: string
  picture?: string
}
