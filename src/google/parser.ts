/**
 * Parser for Cloud Code API responses
 */

import { debug } from '../core/logger.js'
import type { QuotaSnapshot, ModelQuotaInfo, PromptCreditsInfo } from '../quota/types.js'
import type { LoadCodeAssistResponse, FetchAvailableModelsResponse, ModelInfo } from './cloudcode.js'

/**
 * Parse reset time string to milliseconds until reset
 */
function parseResetTime(resetTime?: string): number | undefined {
  if (!resetTime) return undefined

  try {
    const resetDate = new Date(resetTime)
    const now = Date.now()
    const diff = resetDate.getTime() - now
    return diff > 0 ? diff : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse model info into ModelQuotaInfo
 */
function parseModelInfo(modelId: string, model: ModelInfo): ModelQuotaInfo {
  const quotaInfo = model.quotaInfo

  return {
    label: model.displayName || model.label || modelId,
    modelId: modelId,
    remainingPercentage: quotaInfo?.remainingFraction,
    isExhausted: quotaInfo?.isExhausted ?? (quotaInfo?.remainingFraction === 0),
    resetTime: quotaInfo?.resetTime,
    timeUntilResetMs: parseResetTime(quotaInfo?.resetTime),
    isAutocompleteOnly: modelId.includes('gemini-2.5') || (model.displayName || '').includes('Gemini 2.5')
  }
}

/**
 * Parse prompt credits from loadCodeAssist response
 */
function parsePromptCredits(response: LoadCodeAssistResponse): PromptCreditsInfo | undefined {
  const monthly = response.planInfo?.monthlyPromptCredits
  const available = response.availablePromptCredits

  if (monthly === undefined || available === undefined) {
    return undefined
  }

  const used = monthly - available
  const usedPercentage = monthly > 0 ? used / monthly : 0
  const remainingPercentage = monthly > 0 ? available / monthly : 0

  return {
    available,
    monthly,
    usedPercentage,
    remainingPercentage
  }
}

/**
 * Check if a model should be shown in quota display
 * Filter out internal models and only show recommended ones
 */
function shouldShowModel(modelId: string, model: ModelInfo): boolean {
  // Skip internal models
  if (modelId.startsWith('chat_') || modelId.startsWith('tab_')) {
    return false
  }
  // Skip image generation models
  if (modelId.includes('image')) {
    return false
  }
  // Skip internal/experimental models
  if (modelId.startsWith('rev')) {
    return false
  }
  // Skip lite models that are just for specific features
  if (modelId.includes('mquery') || modelId.includes('lite')) {
    return false
  }
  // Only show models with quota info
  if (!model.quotaInfo) {
    return false
  }
  return true
}

/**
 * Parse API responses into a QuotaSnapshot
 */
export function parseQuotaSnapshot(
  codeAssistResponse: LoadCodeAssistResponse,
  modelsResponse: FetchAvailableModelsResponse,
  email?: string
): QuotaSnapshot {
  debug('parser', 'Parsing quota snapshot')

  const promptCredits = parsePromptCredits(codeAssistResponse)
  const planType = codeAssistResponse.planInfo?.planType

  // Models is now an object keyed by model ID
  const modelsMap = modelsResponse.models || {}
  const models: ModelQuotaInfo[] = []

  for (const [modelId, modelInfo] of Object.entries(modelsMap)) {
    if (shouldShowModel(modelId, modelInfo)) {
      models.push(parseModelInfo(modelId, modelInfo))
    }
  }

  // Sort by displayName
  models.sort((a, b) => a.label.localeCompare(b.label))

  debug('parser', `Parsed ${models.length} models`)

  return {
    timestamp: new Date().toISOString(),
    method: 'google',
    email,
    planType,
    promptCredits,
    models
  }
}
