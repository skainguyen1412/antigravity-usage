/**
 * Trigger service for auto wake-up
 * Executes actual AI requests to warm up models
 */

import { debug } from '../core/logger.js'
import { getTokenManagerForAccount } from '../google/token-manager.js'
import { CloudCodeClient } from '../google/cloudcode.js'
import { addTriggerRecord } from './storage.js'
import type { 
  TriggerOptions, 
  TriggerResult, 
  ModelTriggerResult,
  TriggerRecord,
  TokenUsage
} from './types.js'

// Constants
const DEFAULT_PROMPT = 'hi'
const REQUEST_TIMEOUT_MS = 30000  // 30 seconds
const MAX_CONCURRENT_REQUESTS = 4

/**
 * Execute trigger for specified models and account
 * @param options Trigger options including models, account, and prompt
 * @returns Trigger result with success status and per-model results
 */
export async function executeTrigger(options: TriggerOptions): Promise<TriggerResult> {
  const { 
    models, 
    accountEmail, 
    triggerType, 
    triggerSource, 
    customPrompt,
    maxOutputTokens 
  } = options
  
  debug('trigger-service', `Executing trigger for ${models.length} models with account ${accountEmail}`)
  
  if (models.length === 0) {
    debug('trigger-service', 'No models to trigger')
    return { success: true, results: [] }
  }
  
  // Get or create token manager for this account
  let tokenManager
  try {
    tokenManager = getTokenManagerForAccount(accountEmail)
  } catch (err) {
    debug('trigger-service', `Failed to get token manager for ${accountEmail}:`, err)
    
    // Record failure for all models
    const results: ModelTriggerResult[] = models.map(modelId => ({
      modelId,
      success: false,
      durationMs: 0,
      error: `Failed to get credentials for ${accountEmail}`
    }))
    
    recordResults(results, options)
    return { success: false, results }
  }
  
  // Ensure we have valid tokens (trigger refresh if needed)
  try {
    await tokenManager.getValidAccessToken()
  } catch (err) {
    // Extract detailed error message for better diagnostics
    let errorMessage = `Authentication failed for ${accountEmail}`
    
    if (err && typeof err === 'object' && 'getDetailedMessage' in err) {
      // TokenRefreshError with detailed message
      errorMessage = (err as { getDetailedMessage: () => string }).getDetailedMessage()
    } else if (err instanceof Error) {
      errorMessage = `Token refresh failed: ${err.message}`
    }
    
    debug('trigger-service', `Failed to refresh token for ${accountEmail}:`, err)
    
    const results: ModelTriggerResult[] = models.map(modelId => ({
      modelId,
      success: false,
      durationMs: 0,
      error: errorMessage
    }))
    
    recordResults(results, options)
    return { success: false, results }
  }
  
  // Create CloudCode client
  const client = new CloudCodeClient(tokenManager)
  
  // Debug: check if projectId was loaded from cache
  debug('trigger-service', `Account ${accountEmail} projectId from tokenManager: ${tokenManager.getProjectId()}`)
  
  // Resolve project ID (may require onboarding if first time)
  try {
    const projectId = await client.resolveProjectId()
    if (projectId) {
      debug('trigger-service', `Project ID resolved: ${projectId}`)
      // Save for future use
      tokenManager.setProjectId(projectId)
    } else {
      debug('trigger-service', 'WARNING: Could not resolve project ID')
    }
  } catch (err) {
    debug('trigger-service', 'Failed to resolve project ID:', err)
  }
  
  // Prepare prompt
  const userPrompt = customPrompt || DEFAULT_PROMPT
  
  // Trigger models with concurrency limit
  const results: ModelTriggerResult[] = []
  
  // Process in batches of MAX_CONCURRENT_REQUESTS
  for (let i = 0; i < models.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = models.slice(i, i + MAX_CONCURRENT_REQUESTS)
    
    debug('trigger-service', `Processing batch ${i / MAX_CONCURRENT_REQUESTS + 1}: ${batch.join(', ')}`)
    
    const batchResults = await Promise.all(
      batch.map(modelId => triggerSingleModel(client, modelId, userPrompt, maxOutputTokens))
    )
    
    results.push(...batchResults)
  }
  
  // Record results in history
  recordResults(results, options)
  
  const allSuccess = results.every(r => r.success)
  const successCount = results.filter(r => r.success).length
  
  debug('trigger-service', `Trigger complete: ${successCount}/${results.length} succeeded`)
  
  return { success: allSuccess, results }
}

/**
 * Trigger a single model
 */
async function triggerSingleModel(
  client: CloudCodeClient,
  modelId: string,
  prompt: string,
  maxTokens?: number
): Promise<ModelTriggerResult> {
  const startTime = Date.now()
  
  debug('trigger-service', `Triggering model: ${modelId}`)
  
  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), REQUEST_TIMEOUT_MS)
    })
    
    // Race between actual request and timeout
    const response = await Promise.race([
      client.generateContent(modelId, prompt, maxTokens),
      timeoutPromise
    ])
    
    const durationMs = Date.now() - startTime
    
    debug('trigger-service', `Model ${modelId} responded in ${durationMs}ms`)
    
    return {
      modelId,
      success: true,
      durationMs,
      response: response.text.substring(0, 500), // Truncate to 500 chars
      tokensUsed: response.tokensUsed
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : String(err)
    
    debug('trigger-service', `Model ${modelId} failed after ${durationMs}ms: ${errorMessage}`)
    
    return {
      modelId,
      success: false,
      durationMs,
      error: errorMessage
    }
  }
}

/**
 * Record trigger results in history
 */
function recordResults(results: ModelTriggerResult[], options: TriggerOptions): void {
  const { triggerType, triggerSource, accountEmail, customPrompt } = options
  const prompt = customPrompt || DEFAULT_PROMPT
  
  // Create a record for each model result
  for (const result of results) {
    const record: TriggerRecord = {
      timestamp: new Date().toISOString(),
      success: result.success,
      triggerType,
      triggerSource,
      models: [result.modelId],
      accountEmail,
      durationMs: result.durationMs,
      prompt,
      response: result.response,
      error: result.error,
      tokensUsed: result.tokensUsed
    }
    
    addTriggerRecord(record)
  }
}

/**
 * Execute a quick test trigger (for manual testing)
 * @param modelId Model to test
 * @param accountEmail Account to use
 * @param prompt Optional custom prompt
 */
export async function testTrigger(
  modelId: string,
  accountEmail: string,
  prompt?: string
): Promise<ModelTriggerResult> {
  const result = await executeTrigger({
    models: [modelId],
    accountEmail,
    triggerType: 'manual',
    triggerSource: 'manual',
    customPrompt: prompt
  })
  
  return result.results[0] || {
    modelId,
    success: false,
    durationMs: 0,
    error: 'No result returned'
  }
}
