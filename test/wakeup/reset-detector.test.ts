/**
 * Tests for smart reset detector module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ModelQuotaInfo, QuotaSnapshot } from '../../src/quota/types.js'
import { isModelUnused, findUnusedModels, hasUnusedModels } from '../../src/wakeup/reset-detector.js'

// Helper to create model info with specified values
function createModelInfo(overrides: Partial<ModelQuotaInfo> = {}): ModelQuotaInfo {
  return {
    label: 'Test Model',
    modelId: 'test-model',
    remainingPercentage: 100,
    isExhausted: false,
    resetTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), // 5h from now
    timeUntilResetMs: 5 * 60 * 60 * 1000, // 5 hours
    ...overrides
  }
}

function createSnapshot(models: ModelQuotaInfo[]): QuotaSnapshot {
  return {
    timestamp: new Date().toISOString(),
    method: 'google',
    models
  }
}

describe('Smart Reset Detector', () => {
  describe('isModelUnused', () => {
    it('should return true for unused model (100% remaining, ~5h reset)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: 5 * 60 * 60 * 1000 // 5 hours
      })
      
      expect(isModelUnused(model)).toBe(true)
    })
    
    it('should return true for 99% remaining (within threshold)', () => {
      const model = createModelInfo({
        remainingPercentage: 99,
        timeUntilResetMs: 5 * 60 * 60 * 1000
      })
      
      expect(isModelUnused(model)).toBe(true)
    })
    
    it('should return false for used model (less than 99%)', () => {
      const model = createModelInfo({
        remainingPercentage: 98,
        timeUntilResetMs: 5 * 60 * 60 * 1000
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    it('should return false for model with 50% remaining', () => {
      const model = createModelInfo({
        remainingPercentage: 50,
        timeUntilResetMs: 5 * 60 * 60 * 1000
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    it('should return false for exhausted model', () => {
      const model = createModelInfo({
        remainingPercentage: 0,
        isExhausted: true,
        timeUntilResetMs: 5 * 60 * 60 * 1000
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    // Reset time window tests
    it('should return false if reset time is too short (< 4.5h)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: 4 * 60 * 60 * 1000 // 4 hours (too short)
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    it('should return false if reset time is too long (> 5.5h)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: 6 * 60 * 60 * 1000 // 6 hours (too long)
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    it('should return true for 4.5h reset time (at boundary)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: 4.5 * 60 * 60 * 1000 // 4.5 hours (exactly at min)
      })
      
      expect(isModelUnused(model)).toBe(true)
    })
    
    it('should return true for 5.5h reset time (at boundary)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: 5.5 * 60 * 60 * 1000 // 5.5 hours (exactly at max)
      })
      
      expect(isModelUnused(model)).toBe(true)
    })
    
    it('should return true for 4h59m reset time (typical unused)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: (4 * 60 + 59) * 60 * 1000 // 4h59m
      })
      
      expect(isModelUnused(model)).toBe(true)
    })
    
    // Missing data tests
    it('should return false if no remaining percentage', () => {
      const model = createModelInfo({
        remainingPercentage: undefined,
        timeUntilResetMs: 5 * 60 * 60 * 1000
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
    
    it('should return false if no reset time', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        timeUntilResetMs: undefined
      })
      
      expect(isModelUnused(model)).toBe(false)
    })
  })
  
  describe('findUnusedModels', () => {
    it('should return empty array when no models are unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({ 
          modelId: 'model-1', 
          remainingPercentage: 50, // Used
          timeUntilResetMs: 5 * 60 * 60 * 1000 
        }),
        createModelInfo({ 
          modelId: 'model-2', 
          remainingPercentage: 100, 
          timeUntilResetMs: 2 * 60 * 60 * 1000 // Wrong time window
        })
      ])
      
      expect(findUnusedModels(snapshot)).toEqual([])
    })
    
    it('should return only unused models', () => {
      const usedModel = createModelInfo({ 
        modelId: 'used-model', 
        remainingPercentage: 50,
        timeUntilResetMs: 5 * 60 * 60 * 1000 
      })
      
      const unusedModel = createModelInfo({ 
        modelId: 'unused-model', 
        remainingPercentage: 100,
        timeUntilResetMs: 5 * 60 * 60 * 1000 
      })
      
      const snapshot = createSnapshot([usedModel, unusedModel])
      const unused = findUnusedModels(snapshot)
      
      expect(unused).toHaveLength(1)
      expect(unused[0].modelId).toBe('unused-model')
    })
    
    it('should return all unused models', () => {
      const snapshot = createSnapshot([
        createModelInfo({ 
          modelId: 'unused-1', 
          remainingPercentage: 100,
          timeUntilResetMs: 5 * 60 * 60 * 1000 
        }),
        createModelInfo({ 
          modelId: 'unused-2', 
          remainingPercentage: 100,
          timeUntilResetMs: 4.8 * 60 * 60 * 1000 
        }),
        createModelInfo({ 
          modelId: 'used-1', 
          remainingPercentage: 80,
          timeUntilResetMs: 5 * 60 * 60 * 1000 
        })
      ])
      
      const unused = findUnusedModels(snapshot)
      
      expect(unused).toHaveLength(2)
      expect(unused.map(m => m.modelId)).toContain('unused-1')
      expect(unused.map(m => m.modelId)).toContain('unused-2')
    })
  })
  
  describe('hasUnusedModels', () => {
    it('should return false when no models are unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({ remainingPercentage: 50 })
      ])
      
      expect(hasUnusedModels(snapshot)).toBe(false)
    })
    
    it('should return true when at least one model is unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({ 
          remainingPercentage: 50,
          timeUntilResetMs: 5 * 60 * 60 * 1000 
        }),
        createModelInfo({ 
          remainingPercentage: 100,
          timeUntilResetMs: 5 * 60 * 60 * 1000 
        })
      ])
      
      expect(hasUnusedModels(snapshot)).toBe(true)
    })
  })
})
