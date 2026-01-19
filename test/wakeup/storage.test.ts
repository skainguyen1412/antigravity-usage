/**
 * Tests for wakeup storage module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  loadWakeupConfig,
  saveWakeupConfig,
  getOrCreateConfig,
  loadTriggerHistory,
  addTriggerRecord,
  getRecentHistory,
  getLastTrigger,
  clearTriggerHistory,
  loadResetState,
  updateResetState,
  getModelResetState,
  clearResetState,
  loadModelMapping,
  saveModelMapping,
  getResetKey
} from '../../src/wakeup/storage.js'
import { getDefaultConfig, type TriggerRecord, type WakeupConfig } from '../../src/wakeup/types.js'

// Mock the env module to use temp directory
vi.mock('../../src/core/env.js', () => ({
  getConfigDir: () => '/tmp/antigravity-usage-test'
}))

describe('Wakeup Storage', () => {
  const testDir = '/tmp/antigravity-usage-test/wakeup'
  
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })
  
  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })
  
  describe('Config Operations', () => {
    it('should return null when no config exists', () => {
      const config = loadWakeupConfig()
      expect(config).toBeNull()
    })
    
    it('should save and load config', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: true,
        selectedModels: ['gemini-2.0-flash-exp'],
        intervalHours: 4
      }
      
      saveWakeupConfig(config)
      const loaded = loadWakeupConfig()
      
      expect(loaded).not.toBeNull()
      expect(loaded!.enabled).toBe(true)
      expect(loaded!.selectedModels).toEqual(['gemini-2.0-flash-exp'])
      expect(loaded!.intervalHours).toBe(4)
    })
    
    it('should get or create default config', () => {
      const config = getOrCreateConfig()
      
      expect(config).not.toBeNull()
      expect(config.enabled).toBe(false)
      expect(config.scheduleMode).toBe('interval')
      
      // Should be saved to disk
      const loaded = loadWakeupConfig()
      expect(loaded).not.toBeNull()
    })
  })
  
  describe('History Operations', () => {
    it('should return empty array when no history exists', () => {
      const history = loadTriggerHistory()
      expect(history).toEqual([])
    })
    
    it('should add and retrieve trigger records', () => {
      const record: TriggerRecord = {
        timestamp: new Date().toISOString(),
        success: true,
        triggerType: 'manual',
        triggerSource: 'manual',
        models: ['gemini-2.0-flash-exp'],
        accountEmail: 'test@example.com',
        durationMs: 1234,
        prompt: 'hi'
      }
      
      addTriggerRecord(record)
      
      const history = loadTriggerHistory()
      expect(history.length).toBe(1)
      expect(history[0].success).toBe(true)
      expect(history[0].models).toEqual(['gemini-2.0-flash-exp'])
    })
    
    it('should maintain FIFO order (newest first)', () => {
      const record1: TriggerRecord = {
        timestamp: '2024-01-01T00:00:00Z',
        success: true,
        triggerType: 'auto',
        triggerSource: 'scheduled',
        models: ['model1'],
        accountEmail: 'test@example.com',
        durationMs: 100,
        prompt: 'hi'
      }
      
      const record2: TriggerRecord = {
        timestamp: '2024-01-02T00:00:00Z',
        success: false,
        triggerType: 'auto',
        triggerSource: 'scheduled',
        models: ['model2'],
        accountEmail: 'test@example.com',
        durationMs: 200,
        prompt: 'hi'
      }
      
      addTriggerRecord(record1)
      addTriggerRecord(record2)
      
      const history = loadTriggerHistory()
      expect(history.length).toBe(2)
      expect(history[0].models).toEqual(['model2']) // Newest first
      expect(history[1].models).toEqual(['model1'])
    })
    
    it('should respect limit in getRecentHistory', () => {
      for (let i = 0; i < 5; i++) {
        addTriggerRecord({
          timestamp: new Date().toISOString(),
          success: true,
          triggerType: 'auto',
          triggerSource: 'scheduled',
          models: [`model${i}`],
          accountEmail: 'test@example.com',
          durationMs: 100,
          prompt: 'hi'
        })
      }
      
      const recent = getRecentHistory(3)
      expect(recent.length).toBe(3)
    })
    
    it('should get last trigger', () => {
      expect(getLastTrigger()).toBeNull()
      
      addTriggerRecord({
        timestamp: new Date().toISOString(),
        success: true,
        triggerType: 'manual',
        triggerSource: 'manual',
        models: ['test-model'],
        accountEmail: 'test@example.com',
        durationMs: 100,
        prompt: 'hi'
      })
      
      const last = getLastTrigger()
      expect(last).not.toBeNull()
      expect(last!.models).toEqual(['test-model'])
    })
    
    it('should clear history', () => {
      addTriggerRecord({
        timestamp: new Date().toISOString(),
        success: true,
        triggerType: 'manual',
        triggerSource: 'manual',
        models: ['test'],
        accountEmail: 'test@example.com',
        durationMs: 100,
        prompt: 'hi'
      })
      
      expect(loadTriggerHistory().length).toBe(1)
      
      clearTriggerHistory()
      
      expect(loadTriggerHistory().length).toBe(0)
    })
  })
  
  describe('Reset State Operations', () => {
    it('should return empty object when no state exists', () => {
      const state = loadResetState()
      expect(state).toEqual({})
    })
    
    it('should update and retrieve reset state', () => {
      updateResetState('model-key-1', '2024-01-01T12:00:00Z')
      
      const modelState = getModelResetState('model-key-1')
      expect(modelState).not.toBeNull()
      expect(modelState!.lastResetAt).toBe('2024-01-01T12:00:00Z')
      expect(modelState!.lastTriggeredTime).toBeDefined()
    })
    
    it('should return null for non-existent model', () => {
      const state = getModelResetState('non-existent')
      expect(state).toBeNull()
    })
    
    it('should clear reset state', () => {
      updateResetState('model-1', '2024-01-01T00:00:00Z')
      expect(getModelResetState('model-1')).not.toBeNull()
      
      clearResetState()
      
      expect(getModelResetState('model-1')).toBeNull()
    })
  })
  
  describe('Model Mapping Operations', () => {
    it('should return empty object when no mapping exists', () => {
      const mapping = loadModelMapping()
      expect(mapping).toEqual({})
    })
    
    it('should save and load model mappings', () => {
      const mapping = {
        'gemini-2.0-flash-exp': 'GEMINI_FLASH_CONSTANT',
        'gemini-pro': 'GEMINI_PRO_CONSTANT'
      }
      
      saveModelMapping(mapping)
      const loaded = loadModelMapping()
      
      expect(loaded).toEqual(mapping)
    })
    
    it('should get reset key (constant or id)', () => {
      saveModelMapping({
        'gemini-2.0-flash-exp': 'GEMINI_FLASH_CONSTANT'
      })
      
      // Has mapping
      expect(getResetKey('gemini-2.0-flash-exp')).toBe('GEMINI_FLASH_CONSTANT')
      
      // No mapping - returns id
      expect(getResetKey('unknown-model')).toBe('unknown-model')
    })
  })
})
