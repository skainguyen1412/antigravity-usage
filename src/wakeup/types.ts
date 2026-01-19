/**
 * Auto Wake-up types
 * Types for schedule configuration, trigger history, and reset state
 */

// ============================================================================
// Schedule Configuration
// ============================================================================

/**
 * Main wake-up configuration
 */
export interface WakeupConfig {
  // Global settings
  enabled: boolean
  selectedModels: string[]           // Model IDs to trigger
  selectedAccounts?: string[]        // Account emails (undefined = use active)
  customPrompt?: string              // Optional custom wake-up prompt
  maxOutputTokens: number            // 0 = no limit
  
  // Schedule-based mode
  scheduleMode: ScheduleMode
  intervalHours?: number             // For interval mode (e.g., 6 = every 6 hours)
  dailyTimes?: string[]              // For daily mode: ["09:00", "17:00"]
  weeklySchedule?: WeeklySchedule    // For weekly mode
  cronExpression?: string            // For custom mode (advanced users)
  
  // Quota-reset mode
  wakeOnReset: boolean               // Enable quota-reset-based triggering
  resetCooldownMinutes: number       // Cooldown between reset triggers (default: 10)
}

/**
 * Weekly schedule - maps day number to array of times
 * Day numbers: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
export interface WeeklySchedule {
  [day: number]: string[]
}

/**
 * Schedule mode types
 */
export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'custom'

/**
 * Default configuration
 * 
 * Default models trigger both Claude and Gemini families:
 * - claude-sonnet-4-5: Wakes up Claude family
 * - gemini-3-flash: Wakes up Gemini family
 */
export function getDefaultConfig(): WakeupConfig {
  return {
    enabled: false,
    selectedModels: ['claude-sonnet-4-5', 'gemini-3-flash'],
    selectedAccounts: undefined,
    customPrompt: undefined,
    maxOutputTokens: 1,               // Minimal tokens to save quota
    scheduleMode: 'interval',
    intervalHours: 6,
    dailyTimes: ['09:00'],
    weeklySchedule: {},
    cronExpression: undefined,
    wakeOnReset: false,
    resetCooldownMinutes: 10
  }
}

// ============================================================================
// Trigger History
// ============================================================================

/**
 * Trigger type - manual (user initiated) or auto (scheduled/reset-based)
 */
export type TriggerType = 'manual' | 'auto'

/**
 * Trigger source - how the trigger was initiated
 */
export type TriggerSource = 'manual' | 'scheduled' | 'quota_reset'

/**
 * Token usage information from API response
 */
export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

/**
 * Single trigger history record
 */
export interface TriggerRecord {
  timestamp: string                  // ISO timestamp
  success: boolean
  triggerType: TriggerType
  triggerSource: TriggerSource
  models: string[]                   // Model IDs triggered
  accountEmail: string
  durationMs: number
  prompt: string                     // Actual prompt used
  response?: string                  // AI response (truncated to 500 chars)
  error?: string                     // Error message if failed
  tokensUsed?: TokenUsage
}

// ============================================================================
// Reset Detection State
// ============================================================================

/**
 * State for a single model's reset tracking
 */
export interface ModelResetState {
  lastResetAt: string                // Last resetAt timestamp we triggered for
  lastTriggeredTime: string          // When we last triggered (ISO timestamp)
}

/**
 * Reset deduplication state - keyed by model reset key
 * Key is modelConstant if available, otherwise modelId
 */
export interface ResetState {
  [modelResetKey: string]: ModelResetState
}

// ============================================================================
// Model Mapping
// ============================================================================

/**
 * Mapping from model ID to model constant
 * Used for quota reset deduplication
 */
export interface ModelMapping {
  [modelId: string]: string
}

// ============================================================================
// Trigger Service Types
// ============================================================================

/**
 * Options for executing a trigger
 */
export interface TriggerOptions {
  models: string[]                   // Model IDs to trigger
  accountEmail: string               // Which account to use
  triggerType: TriggerType
  triggerSource: TriggerSource
  customPrompt?: string
  maxOutputTokens?: number           // 0 = no limit
}

/**
 * Result from triggering a single model
 */
export interface ModelTriggerResult {
  modelId: string
  success: boolean
  durationMs: number
  response?: string
  error?: string
  tokensUsed?: TokenUsage
}

/**
 * Overall trigger execution result
 */
export interface TriggerResult {
  success: boolean                   // True if all models succeeded
  results: ModelTriggerResult[]
}

// ============================================================================
// Cron Installer Types
// ============================================================================

/**
 * Result from cron installation attempt
 */
export interface CronInstallResult {
  success: boolean
  cronExpression?: string
  manualInstructions?: string        // Fallback instructions if auto-install fails
  error?: string
}

/**
 * Status of cron installation
 */
export interface CronStatus {
  installed: boolean
  cronExpression?: string
  nextRun?: string                   // Human-readable next run time
}

// ============================================================================
// Reset Detection Types
// ============================================================================

/**
 * Result from reset detection
 */
export interface DetectionResult {
  triggered: boolean
  triggeredModels: string[]
}
