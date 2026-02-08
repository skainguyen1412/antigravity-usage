/**
 * Local parser - converts Connect API response to QuotaSnapshot format
 */

import type { QuotaSnapshot, ModelQuotaInfo, PromptCreditsInfo } from '../quota/types.js'
import type { ConnectUserStatus } from './connect-client.js'
import { debug } from '../core/logger.js'

/**
 * Parse Connect API user status into QuotaSnapshot format
 */
export function parseLocalQuotaSnapshot(userStatus: ConnectUserStatus): QuotaSnapshot {
  debug('local-parser', 'Parsing local user status into QuotaSnapshot')

  const snapshot: QuotaSnapshot = {
    timestamp: new Date().toISOString(),
    method: 'local',
    email: userStatus.email,
    models: []
  }

  // Parse prompt credits
  if (userStatus.quota?.promptCredits) {
    snapshot.promptCredits = parsePromptCredits(userStatus.quota.promptCredits)
  }

  // Parse models
  if (userStatus.quota?.models) {
    snapshot.models = userStatus.quota.models.map(parseModelQuota)
  }

  debug('local-parser', `Parsed ${snapshot.models.length} models`)
  return snapshot
}

/**
 * Parse prompt credits from Connect API format
 */
function parsePromptCredits(credits: NonNullable<ConnectUserStatus['quota']>['promptCredits']): PromptCreditsInfo | undefined {
  if (!credits) {
    return undefined
  }

  const limit = credits.limit ?? 0
  const remaining = credits.remaining ?? limit
  const used = credits.used ?? (limit - remaining)

  if (limit === 0) {
    return undefined
  }

  const usedPercentage = limit > 0 ? used / limit : 0
  const remainingPercentage = limit > 0 ? remaining / limit : 1

  return {
    available: remaining,
    monthly: limit,
    usedPercentage,
    remainingPercentage
  }
}

/**
 * Parse a single model quota from Connect API format
 */
function parseModelQuota(model: NonNullable<NonNullable<ConnectUserStatus['quota']>['models']>[number]): ModelQuotaInfo {
  const quota = model.quota

  return {
    label: model.label || model.displayName || model.modelId,
    modelId: model.modelId,
    remainingPercentage: quota?.remainingPercentage,
    isExhausted: model.isExhausted ?? (quota?.remainingPercentage === 0),
    resetTime: quota?.resetTime,
    timeUntilResetMs: quota?.timeUntilResetMs,
    isAutocompleteOnly: model.modelId.includes('gemini-2.5') ||
      (model.label || '').includes('Gemini 2.5') ||
      (model.displayName || '').includes('Gemini 2.5')
  }
}
