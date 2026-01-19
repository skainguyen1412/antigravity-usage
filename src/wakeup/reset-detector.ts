/**
 * Reset detector for auto wake-up
 * 
 * Smart trigger logic:
 * - Triggers ALL available models from quota snapshot
 * - Triggers for ALL valid accounts
 * - Only triggers when model is "unused": 100% remaining AND ~5h until reset
 */

import { debug } from '../core/logger.js'
import type { QuotaSnapshot, ModelQuotaInfo } from '../quota/types.js'
import { 
  loadWakeupConfig, 
  loadResetState, 
  updateResetState
} from './storage.js'
import { getAccountManager } from '../accounts/manager.js'
import { executeTrigger } from './trigger-service.js'
import type { DetectionResult } from './types.js'

// Smart trigger thresholds
const FULL_QUOTA_THRESHOLD = 99        // Consider "full" if >= 99%
const RESET_TIME_MIN_HOURS = 4.5       // At least 4.5 hours until reset
const RESET_TIME_MAX_HOURS = 5.5       // At most 5.5 hours until reset (catches the ~5h window)
const RESET_TIME_MIN_MS = RESET_TIME_MIN_HOURS * 60 * 60 * 1000
const RESET_TIME_MAX_MS = RESET_TIME_MAX_HOURS * 60 * 60 * 1000

// Cooldown between triggers for same model
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour (since we're looking at ~5h window)

/**
 * Check if a model is "unused" and should be triggered
 * 
 * Unused = 100% quota remaining AND reset time is approximately 5 hours
 * (meaning the model hasn't been used this quota cycle)
 */
export function isModelUnused(model: ModelQuotaInfo): boolean {
  // Must have remaining percentage data
  if (model.remainingPercentage === undefined) {
    debug('reset-detector', `${model.modelId}: No remaining percentage data`)
    return false
  }
  
  // Check if quota is full (100% or very close)
  if (model.remainingPercentage < FULL_QUOTA_THRESHOLD) {
    debug('reset-detector', `${model.modelId}: Not full (${model.remainingPercentage}%)`)
    return false
  }
  
  // Must have time until reset data
  if (model.timeUntilResetMs === undefined) {
    debug('reset-detector', `${model.modelId}: No reset time data`)
    return false
  }
  
  // Check if reset time is in the ~5h window (4.5h to 5.5h)
  // This means it just reset and hasn't been used
  if (model.timeUntilResetMs < RESET_TIME_MIN_MS || model.timeUntilResetMs > RESET_TIME_MAX_MS) {
    const hoursUntilReset = (model.timeUntilResetMs / (60 * 60 * 1000)).toFixed(1)
    debug('reset-detector', `${model.modelId}: Reset time ${hoursUntilReset}h not in 4.5-5.5h window`)
    return false
  }
  
  debug('reset-detector', `${model.modelId}: UNUSED - 100% remaining, ~5h until reset`)
  return true
}

/**
 * Get all valid account emails
 */
function getAllValidAccounts(): string[] {
  const accountManager = getAccountManager()
  const allEmails = accountManager.getAccountEmails()
  
  return allEmails.filter(email => {
    const status = accountManager.getAccountStatus(email)
    return status === 'valid' || status === 'expired' // Expired can be refreshed
  })
}

/**
 * Detect unused models and trigger wake-up for all accounts
 * 
 * New smart logic:
 * 1. Check ALL models in the quota snapshot
 * 2. Find models that are "unused" (100% + ~5h reset)
 * 3. Trigger for ALL valid accounts
 */
export async function detectResetAndTrigger(snapshot: QuotaSnapshot): Promise<DetectionResult> {
  debug('reset-detector', 'Checking for unused models (smart trigger)')
  
  // Load config
  const config = loadWakeupConfig()
  
  // Must be enabled
  if (!config || !config.enabled) {
    debug('reset-detector', 'Wakeup is not enabled')
    return { triggered: false, triggeredModels: [] }
  }
  
  // Get ALL valid accounts
  const accounts = getAllValidAccounts()
  if (accounts.length === 0) {
    debug('reset-detector', 'No valid accounts available')
    return { triggered: false, triggeredModels: [] }
  }
  
  debug('reset-detector', `Found ${accounts.length} valid accounts`)
  
  // Load reset state for cooldown
  const resetState = loadResetState()
  const now = Date.now()
  
  // Find ALL unused models (check every model in snapshot)
  const modelsToTrigger: string[] = []
  
  for (const model of snapshot.models) {
    // Check if model is unused
    if (!isModelUnused(model)) {
      continue
    }
    
    // Check cooldown (don't trigger same model too frequently)
    const previousState = resetState[model.modelId]
    if (previousState) {
      const lastTriggered = new Date(previousState.lastTriggeredTime).getTime()
      const cooldownRemaining = DEFAULT_COOLDOWN_MS - (now - lastTriggered)
      if (cooldownRemaining > 0) {
        debug('reset-detector', `${model.modelId}: In cooldown (${Math.round(cooldownRemaining / 60000)}min remaining)`)
        continue
      }
    }
    
    modelsToTrigger.push(model.modelId)
    
    // Update state to prevent re-triggering
    updateResetState(model.modelId, model.resetTime || new Date().toISOString())
  }
  
  if (modelsToTrigger.length === 0) {
    debug('reset-detector', 'No unused models to trigger')
    return { triggered: false, triggeredModels: [] }
  }
  
  console.log(`\n🔄 Found ${modelsToTrigger.length} unused model(s): ${modelsToTrigger.join(', ')}`)
  console.log(`   Triggering for ${accounts.length} account(s)...`)
  
  // Trigger for ALL accounts
  let successCount = 0
  for (const accountEmail of accounts) {
    try {
      const result = await executeTrigger({
        models: modelsToTrigger,
        accountEmail,
        triggerType: 'auto',
        triggerSource: 'quota_reset',
        customPrompt: config.customPrompt,
        maxOutputTokens: config.maxOutputTokens
      })
      
      const modelSuccess = result.results.filter(r => r.success).length
      console.log(`   ✅ ${accountEmail}: ${modelSuccess}/${modelsToTrigger.length} succeeded`)
      if (modelSuccess > 0) successCount++
    } catch (err) {
      console.log(`   ❌ ${accountEmail}: ${err instanceof Error ? err.message : err}`)
      debug('reset-detector', `Trigger failed for ${accountEmail}:`, err)
    }
  }
  
  console.log(`\n📊 Wake-up complete: ${successCount}/${accounts.length} accounts triggered\n`)
  
  return { 
    triggered: true, 
    triggeredModels: modelsToTrigger 
  }
}

/**
 * Get list of unused models for display/testing
 */
export function findUnusedModels(snapshot: QuotaSnapshot): ModelQuotaInfo[] {
  return snapshot.models.filter(isModelUnused)
}

/**
 * Check if any models need triggering (for status display)
 */
export function hasUnusedModels(snapshot: QuotaSnapshot): boolean {
  return snapshot.models.some(isModelUnused)
}
