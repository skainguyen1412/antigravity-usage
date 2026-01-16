/**
 * Google Cloud Code API client
 */

import { debug } from '../core/logger.js'
import { APIError, AuthenticationError, NetworkError, RateLimitError } from '../core/errors.js'
import type { TokenManager } from './token-manager.js'

const BASE_URL = 'https://cloudcode-pa.googleapis.com'
const USER_AGENT = 'antigravity'

// Standard metadata for Cloud Code API calls
const METADATA = {
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI'
}

/**
 * Raw API response types (based on extension code patterns)
 */
export interface LoadCodeAssistResponse {
  codeAssistEnabled?: boolean
  planInfo?: {
    monthlyPromptCredits?: number
    planType?: string
  }
  availablePromptCredits?: number
  cloudaicompanionProject?: string | { id?: string }
  currentTier?: {
    id?: string
    name?: string
    description?: string
  }
  paidTier?: {
    id?: string
  }
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

/**
 * Model info in the response - keyed by model ID
 */
export interface ModelInfo {
  displayName?: string
  model?: string
  label?: string
  quotaInfo?: {
    remainingFraction?: number
    resetTime?: string
    isExhausted?: boolean
  }
  maxTokens?: number
  recommended?: boolean
  supportsImages?: boolean
  supportsThinking?: boolean
  modelProvider?: string
}

/**
 * The actual response structure - models is an object, not an array
 */
export interface FetchAvailableModelsResponse {
  models?: Record<string, ModelInfo>
  defaultAgentModelId?: string
}

/**
 * Cloud Code API client
 */
export class CloudCodeClient {
  private projectId?: string
  
  constructor(private tokenManager: TokenManager) {}
  
  /**
   * Make an authenticated API request
   */
  private async request<T>(endpoint: string, body?: unknown): Promise<T> {
    const token = await this.tokenManager.getValidAccessToken()
    const url = `${BASE_URL}${endpoint}`
    
    debug('cloudcode', `Calling ${endpoint}`)
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: body ? JSON.stringify(body) : undefined
      })
      
      debug('cloudcode', `Response status: ${response.status}`)
      
      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.text()
        debug('cloudcode', `Auth error body: ${errorBody}`)
        throw new AuthenticationError('Authentication failed. Please run: antigravity-usage login')
      }
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : undefined
        throw new RateLimitError('Rate limited by Google API', retryMs)
      }
      
      if (response.status >= 500) {
        throw new APIError(`Server error: ${response.status}`, response.status)
      }
      
      if (!response.ok) {
        const errorText = await response.text()
        debug('cloudcode', 'API error response', errorText)
        throw new APIError(`API request failed: ${response.status}`, response.status)
      }
      
      const data = await response.json() as T
      debug('cloudcode', 'API call successful')
      return data
    } catch (err) {
      if (err instanceof AuthenticationError || 
          err instanceof RateLimitError || 
          err instanceof APIError) {
        throw err
      }
      
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new NetworkError('Network error. Please check your connection.')
      }
      
      throw err
    }
  }
  
  /**
   * Load code assist status and plan info
   * Also extracts project ID for subsequent calls
   */
  async loadCodeAssist(): Promise<LoadCodeAssistResponse> {
    const response = await this.request<LoadCodeAssistResponse>('/v1internal:loadCodeAssist', {
      metadata: METADATA
    })
    
    // Store project ID for fetchAvailableModels
    // Handle both string and object formats
    if (response.cloudaicompanionProject) {
      if (typeof response.cloudaicompanionProject === 'string') {
        this.projectId = response.cloudaicompanionProject
      } else if (response.cloudaicompanionProject.id) {
        this.projectId = response.cloudaicompanionProject.id
      }
      debug('cloudcode', `Project ID: ${this.projectId}`)
    }
    
    return response
  }
  
  /**
   * Fetch available models with quota info
   * Requires project ID from loadCodeAssist
   */
  async fetchAvailableModels(): Promise<FetchAvailableModelsResponse> {
    const body = this.projectId ? { project: this.projectId } : {}
    return this.request<FetchAvailableModelsResponse>('/v1internal:fetchAvailableModels', body)
  }
}
