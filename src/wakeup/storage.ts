/**
 * Auto Wake-up storage service
 * Handles persistence of config, trigger history, reset state, and model mappings
 */

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { debug } from '../core/logger.js'
import { getConfigDir } from '../core/env.js'
import type { 
  WakeupConfig, 
  TriggerRecord, 
  ResetState,
  ModelMapping 
} from './types.js'
import { getDefaultConfig } from './types.js'

// Storage paths
const WAKEUP_DIR_NAME = 'wakeup'
const CONFIG_FILE_NAME = 'config.json'
const HISTORY_FILE_NAME = 'history.json'
const RESET_STATE_FILE_NAME = 'reset-state.json'
const MODEL_MAPPING_FILE_NAME = 'model-mapping.json'

// History ring buffer size
const MAX_HISTORY_ENTRIES = 100

/**
 * Get wakeup storage directory path
 */
function getWakeupDir(): string {
  return join(getConfigDir(), WAKEUP_DIR_NAME)
}

/**
 * Ensure wakeup directory exists
 */
function ensureWakeupDir(): void {
  const dir = getWakeupDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    debug('wakeup-storage', `Created wakeup directory: ${dir}`)
  }
}

/**
 * Generic JSON file reader
 */
function readJsonFile<T>(filename: string, defaultValue: T): T {
  const filepath = join(getWakeupDir(), filename)
  try {
    if (existsSync(filepath)) {
      const content = readFileSync(filepath, 'utf-8')
      return JSON.parse(content) as T
    }
  } catch (err) {
    debug('wakeup-storage', `Error reading ${filename}:`, err)
  }
  return defaultValue
}

/**
 * Generic JSON file writer
 */
function writeJsonFile<T>(filename: string, data: T): void {
  ensureWakeupDir()
  const filepath = join(getWakeupDir(), filename)
  try {
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')
    debug('wakeup-storage', `Wrote ${filename}`)
  } catch (err) {
    debug('wakeup-storage', `Error writing ${filename}:`, err)
    throw err
  }
}

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Load wake-up configuration
 * Returns null if no config exists
 */
export function loadWakeupConfig(): WakeupConfig | null {
  const config = readJsonFile<WakeupConfig | null>(CONFIG_FILE_NAME, null)
  if (config) {
    debug('wakeup-storage', 'Loaded wakeup config')
  }
  return config
}

/**
 * Save wake-up configuration
 */
export function saveWakeupConfig(config: WakeupConfig): void {
  writeJsonFile(CONFIG_FILE_NAME, config)
  debug('wakeup-storage', 'Saved wakeup config')
}

/**
 * Get or create default config
 * Includes migration logic to update existing configs to new default models
 */
export function getOrCreateConfig(): WakeupConfig {
  const existing = loadWakeupConfig()
  if (existing) {
    // Auto-migrate to new default models if selectedModels is empty
    // This ensures both Claude and Gemini families are triggered
    if (!existing.selectedModels || existing.selectedModels.length === 0) {
      existing.selectedModels = ['claude-sonnet-4-5', 'gemini-3-flash']
      saveWakeupConfig(existing)
      debug('wakeup-storage', 'Migrated config to new default models')
    }
    return existing
  }
  const defaultConfig = getDefaultConfig()
  saveWakeupConfig(defaultConfig)
  return defaultConfig
}

// ============================================================================
// History Operations
// ============================================================================

/**
 * Load trigger history
 */
export function loadTriggerHistory(): TriggerRecord[] {
  return readJsonFile<TriggerRecord[]>(HISTORY_FILE_NAME, [])
}

/**
 * Save trigger history
 */
export function saveTriggerHistory(history: TriggerRecord[]): void {
  writeJsonFile(HISTORY_FILE_NAME, history)
}

/**
 * Add a trigger record to history (maintains ring buffer)
 */
export function addTriggerRecord(record: TriggerRecord): void {
  const history = loadTriggerHistory()
  
  // Add new record at the beginning
  history.unshift(record)
  
  // Trim to max entries
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(MAX_HISTORY_ENTRIES)
  }
  
  saveTriggerHistory(history)
  debug('wakeup-storage', `Added trigger record (total: ${history.length})`)
}

/**
 * Get recent trigger history
 */
export function getRecentHistory(limit: number = 10): TriggerRecord[] {
  const history = loadTriggerHistory()
  return history.slice(0, limit)
}

/**
 * Get last trigger record
 */
export function getLastTrigger(): TriggerRecord | null {
  const history = loadTriggerHistory()
  return history.length > 0 ? history[0] : null
}

/**
 * Clear trigger history
 */
export function clearTriggerHistory(): void {
  saveTriggerHistory([])
  debug('wakeup-storage', 'Cleared trigger history')
}

// ============================================================================
// Reset State Operations
// ============================================================================

/**
 * Load reset deduplication state
 */
export function loadResetState(): ResetState {
  return readJsonFile<ResetState>(RESET_STATE_FILE_NAME, {})
}

/**
 * Save reset state
 */
export function saveResetState(state: ResetState): void {
  writeJsonFile(RESET_STATE_FILE_NAME, state)
}

/**
 * Update reset state for a specific model
 */
export function updateResetState(modelKey: string, resetAt: string): void {
  const state = loadResetState()
  
  state[modelKey] = {
    lastResetAt: resetAt,
    lastTriggeredTime: new Date().toISOString()
  }
  
  saveResetState(state)
  debug('wakeup-storage', `Updated reset state for ${modelKey}`)
}

/**
 * Get reset state for a specific model
 */
export function getModelResetState(modelKey: string): { lastResetAt: string; lastTriggeredTime: string } | null {
  const state = loadResetState()
  return state[modelKey] || null
}

/**
 * Clear reset state
 */
export function clearResetState(): void {
  saveResetState({})
  debug('wakeup-storage', 'Cleared reset state')
}

// ============================================================================
// Model Mapping Operations
// ============================================================================

/**
 * Load model ID to constant mapping
 */
export function loadModelMapping(): ModelMapping {
  return readJsonFile<ModelMapping>(MODEL_MAPPING_FILE_NAME, {})
}

/**
 * Save model mapping
 */
export function saveModelMapping(mapping: ModelMapping): void {
  writeJsonFile(MODEL_MAPPING_FILE_NAME, mapping)
  debug('wakeup-storage', `Saved model mapping (${Object.keys(mapping).length} models)`)
}

/**
 * Update model mapping with new entries
 * Merges with existing mappings
 */
export function updateModelMapping(newMappings: ModelMapping): void {
  const existing = loadModelMapping()
  const merged = { ...existing, ...newMappings }
  saveModelMapping(merged)
}

/**
 * Get model constant for a model ID
 */
export function getModelConstant(modelId: string): string | undefined {
  const mapping = loadModelMapping()
  return mapping[modelId]
}

/**
 * Get reset key for a model (uses constant if available, else ID)
 */
export function getResetKey(modelId: string): string {
  return getModelConstant(modelId) || modelId
}
