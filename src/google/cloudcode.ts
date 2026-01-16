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
  
  constructor(private tokenManager: TokenManager) {
    // Initialize project ID from cached tokens (stored during login/quota fetch)
    this.projectId = tokenManager.getProjectId()
  }
  
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
    // Use complete metadata as per working implementation
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
   * Extract project ID from loadCodeAssist response
   */
  private extractProjectId(response: LoadCodeAssistResponse): void {
    // Try multiple possible field names
    const projectId = response.cloudaicompanionProject 
      || (response as any).project 
      || (response as any).projectId
      || (response as any).cloudProject
    
    if (projectId && typeof projectId === 'string' && projectId.length > 0) {
      this.projectId = projectId
      debug('cloudcode', `Project ID extracted: ${this.projectId}`)
    } else {
      debug('cloudcode', 'No project ID found in response')
    }
  }
  
  /**
   * Resolve project ID with onboarding retry if needed
   * This is the recommended way to get projectId reliably
   */
  async resolveProjectId(maxRetries: number = 5, retryDelayMs: number = 2000): Promise<string | undefined> {
    // If already have projectId, return it
    if (this.projectId) {
      debug('cloudcode', `Using cached project ID: ${this.projectId}`)
      return this.projectId
    }
    
    // Try loading first
    const loadResponse = await this.loadCodeAssist()
    if (this.projectId) {
      return this.projectId
    }
    
    // Project ID not found - may need onboarding
    debug('cloudcode', 'Project ID not found, attempting onboarding...')
    
    // Pick onboarding tier from allowedTiers
    const tiers = loadResponse.allowedTiers || []
    let tierId: string | undefined
    
    // Prefer default tier, then paidTier, then first available
    const defaultTier = tiers.find((t: any) => t.isDefault)
    if (defaultTier) {
      tierId = defaultTier.id
    } else if (loadResponse.paidTier?.id) {
      tierId = loadResponse.paidTier.id
    } else if ((loadResponse as any).currentTier?.id) {
      tierId = (loadResponse as any).currentTier.id
    } else if (tiers.length > 0) {
      tierId = tiers[0].id
    }
    
    if (!tierId) {
      debug('cloudcode', 'No tier available for onboarding')
      return undefined
    }
    
    debug('cloudcode', `Onboarding with tier: ${tierId}`)
    
    // Try onboarding (call to select/confirm tier)
    try {
      await this.request('/v1internal:onboardUser', {
        tierId,
        metadata: { 
          ideType: 'ANTIGRAVITY',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI'
        }
      })
    } catch (err) {
      debug('cloudcode', 'Onboarding call failed (may be expected):', err)
      // Continue with retry loop anyway
    }
    
    // Retry loop to get project ID
    for (let i = 0; i < maxRetries; i++) {
      debug('cloudcode', `Retry ${i + 1}/${maxRetries} for project ID...`)
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      
      // Try loading again
      await this.loadCodeAssist()
      
      if (this.projectId) {
        debug('cloudcode', `Project ID resolved after ${i + 1} retries: ${this.projectId}`)
        return this.projectId
      }
    }
    
    debug('cloudcode', 'Failed to resolve project ID after all retries')
    return undefined
  }
  
  /**
   * Fetch available models with quota info
   * Requires project ID from loadCodeAssist
   */
  async fetchAvailableModels(): Promise<FetchAvailableModelsResponse> {
    const body = this.projectId ? { project: this.projectId } : {}
    return this.request<FetchAvailableModelsResponse>('/v1internal:fetchAvailableModels', body)
  }
  
  /**
   * Generate content using a specific model (Agent Request Format)
   * Used for wake-up triggers to warm up models
   * 
   * Per docs/trigger.md, must use the agent request format with:
   * - project: Cloud Code project ID
   * - requestId: unique ID
   * - model: model ID
   * - userAgent: "antigravity"
   * - requestType: "agent"
   * - request: contains contents, session_id, systemInstruction, generationConfig
   * 
   * @param modelId Model ID to use
   * @param prompt User prompt to send
   * @param maxOutputTokens Maximum tokens to generate (0 = no limit)
   * @returns Generated text and optional token usage
   */
  async generateContent(
    modelId: string, 
    prompt: string, 
    maxOutputTokens?: number
  ): Promise<{ text: string; tokensUsed?: { prompt: number; completion: number; total: number } }> {
    debug('cloudcode', `Generating content with model: ${modelId}`)
    debug('cloudcode', `Current projectId: ${this.projectId}`)
    
    // If no cached project ID, try to get from loadCodeAssist
    if (!this.projectId) {
      debug('cloudcode', 'No cached project ID, trying loadCodeAssist...')
      try {
        await this.loadCodeAssist()
        debug('cloudcode', `After loadCodeAssist, projectId: ${this.projectId}`)
      } catch (err) {
        debug('cloudcode', 'loadCodeAssist failed:', err)
      }
    }
    
    // Generate unique IDs
    const requestId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    
    // System instruction (minimal for wake-up)
    const systemInstruction = {
      parts: [{ text: 'You are a helpful assistant.' }]
    }
    
    // Generation config
    const generationConfig: Record<string, unknown> = {
      temperature: 0
    }
    if (maxOutputTokens && maxOutputTokens > 0) {
      generationConfig.maxOutputTokens = maxOutputTokens
    }
    
    // Build agent request body per docs/trigger.md
    // Project may be optional if the API can infer it from the token
    const body: Record<string, unknown> = {
      requestId,
      model: modelId,
      userAgent: 'antigravity',
      requestType: 'agent',
      request: {
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        session_id: sessionId,
        systemInstruction,
        generationConfig
      }
    }
    
    // Add project only if we have one
    if (this.projectId) {
      body.project = this.projectId
      debug('cloudcode', `Using project ID: ${this.projectId}`)
    } else {
      debug('cloudcode', 'Sending request WITHOUT project ID')
    }
    
    debug('cloudcode', `Request body:`, JSON.stringify(body, null, 2))
    
    // Note: Project ID may not be available if API doesn't return it
    // We'll try sending without it - API might infer from OAuth token
    if (!this.projectId) {
      debug('cloudcode', 'WARNING: No project ID available. Trying without it...')
    }
    
    try {
      // Use the SSE streaming endpoint
      const token = await this.tokenManager.getValidAccessToken()
      const url = `${BASE_URL}/v1internal:streamGenerateContent?alt=sse`
      
      debug('cloudcode', `Calling SSE endpoint: ${url}`)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/1.11.3 Darwin/arm64'
        },
        body: JSON.stringify(body)
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        debug('cloudcode', `SSE request failed: ${response.status}`, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText}`)
      }
      
      // Parse SSE response
      const sseText = await response.text()
      debug('cloudcode', `SSE response:`, sseText.substring(0, 500))
      
      // SSE format: lines starting with "data: " contain JSON
      let fullText = ''
      let tokensUsed: { prompt: number; completion: number; total: number } | undefined
      
      for (const line of sseText.split('\n')) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6) // Remove "data: " prefix
          if (jsonStr.trim() === '[DONE]') continue
          
          try {
            const data = JSON.parse(jsonStr)
            
            // Extract text from candidates
            const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text
            if (candidateText) {
              fullText += candidateText
            }
            
            // Extract usage metadata
            if (data.usageMetadata) {
              tokensUsed = {
                prompt: data.usageMetadata.promptTokenCount || 0,
                completion: data.usageMetadata.candidatesTokenCount || 0,
                total: data.usageMetadata.totalTokenCount || 0
              }
            }
          } catch (parseErr) {
            debug('cloudcode', `Failed to parse SSE line: ${jsonStr}`)
          }
        }
      }
      
      debug('cloudcode', `Generated ${fullText.length} chars, tokens: ${tokensUsed?.total || 'unknown'}`)
      
      return { text: fullText, tokensUsed }
    } catch (err) {
      debug('cloudcode', `Generate content failed for ${modelId}:`, err)
      throw err
    }
  }
}
