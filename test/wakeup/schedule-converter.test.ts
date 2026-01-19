/**
 * Tests for schedule converter module
 */

import { describe, it, expect } from 'vitest'
import {
  configToCronExpression,
  validateCronExpression,
  getScheduleDescription,
  getNextRunEstimate
} from '../../src/wakeup/schedule-converter.js'
import { getDefaultConfig, type WakeupConfig } from '../../src/wakeup/types.js'

describe('Schedule Converter', () => {
  describe('configToCronExpression', () => {
    it('should use custom cron expression when provided', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        cronExpression: '30 */4 * * *',
        scheduleMode: 'custom'
      }
      
      expect(configToCronExpression(config)).toBe('30 */4 * * *')
    })
    
    describe('Interval Mode', () => {
      it('should convert interval to cron (every 6 hours)', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'interval',
          intervalHours: 6
        }
        
        expect(configToCronExpression(config)).toBe('0 */6 * * *')
      })
      
      it('should convert interval to cron (every 1 hour)', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'interval',
          intervalHours: 1
        }
        
        expect(configToCronExpression(config)).toBe('0 */1 * * *')
      })
      
      it('should use default of 6 hours if not specified', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'interval',
          intervalHours: undefined
        }
        
        expect(configToCronExpression(config)).toBe('0 */6 * * *')
      })
      
      it('should throw for invalid interval hours', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'interval',
          intervalHours: 25
        }
        
        expect(() => configToCronExpression(config)).toThrow()
      })
    })
    
    describe('Daily Mode', () => {
      it('should convert single daily time', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'daily',
          dailyTimes: ['09:00']
        }
        
        expect(configToCronExpression(config)).toBe('0 9 * * *')
      })
      
      it('should convert multiple daily times with same minute', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'daily',
          dailyTimes: ['09:00', '15:00', '21:00']
        }
        
        expect(configToCronExpression(config)).toBe('0 9,15,21 * * *')
      })
      
      it('should handle times with non-zero minutes', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'daily',
          dailyTimes: ['09:30']
        }
        
        expect(configToCronExpression(config)).toBe('30 9 * * *')
      })
      
      it('should throw for empty times array', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'daily',
          dailyTimes: []
        }
        
        expect(() => configToCronExpression(config)).toThrow()
      })
    })
    
    describe('Weekly Mode', () => {
      it('should convert single day schedule', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'weekly',
          weeklySchedule: { 1: ['09:00'] } // Monday at 9am
        }
        
        expect(configToCronExpression(config)).toBe('0 9 * * 1')
      })
      
      it('should convert multiple days schedule', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'weekly',
          weeklySchedule: { 1: ['09:00'], 3: ['09:00'], 5: ['09:00'] }
        }
        
        expect(configToCronExpression(config)).toBe('0 9 * * 1,3,5')
      })
      
      it('should throw for empty weekly schedule', () => {
        const config: WakeupConfig = {
          ...getDefaultConfig(),
          scheduleMode: 'weekly',
          weeklySchedule: {}
        }
        
        expect(() => configToCronExpression(config)).toThrow()
      })
    })
  })
  
  describe('validateCronExpression', () => {
    it('should validate correct cron expressions', () => {
      expect(validateCronExpression('0 */6 * * *')).toBe(true)
      expect(validateCronExpression('30 9 * * 1,3,5')).toBe(true)
      expect(validateCronExpression('0 0 1 * *')).toBe(true)
      expect(validateCronExpression('*/15 * * * *')).toBe(true)
    })
    
    it('should reject invalid cron expressions', () => {
      expect(validateCronExpression('0 */6 * *')).toBe(false) // Only 4 fields
      expect(validateCronExpression('0 */6 * * * *')).toBe(false) // 6 fields
      expect(validateCronExpression('')).toBe(false)
    })
  })
  
  describe('getScheduleDescription', () => {
    it('should describe disabled config', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: false
      }
      
      expect(getScheduleDescription(config)).toBe('Disabled')
    })
    
    it('should describe quota-reset mode', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: true,
        wakeOnReset: true,
        resetCooldownMinutes: 15
      }
      
      expect(getScheduleDescription(config)).toBe('Quota-reset based (15min cooldown)')
    })
    
    it('should describe interval mode', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: true,
        scheduleMode: 'interval',
        intervalHours: 4
      }
      
      expect(getScheduleDescription(config)).toBe('Every 4 hours')
    })
    
    it('should describe daily mode with single time', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: true,
        scheduleMode: 'daily',
        dailyTimes: ['09:00']
      }
      
      expect(getScheduleDescription(config)).toBe('Daily at 09:00')
    })
    
    it('should describe daily mode with multiple times', () => {
      const config: WakeupConfig = {
        ...getDefaultConfig(),
        enabled: true,
        scheduleMode: 'daily',
        dailyTimes: ['09:00', '18:00']
      }
      
      expect(getScheduleDescription(config)).toBe('Daily at 09:00, 18:00')
    })
  })
  
  describe('getNextRunEstimate', () => {
    it('should describe interval-based schedules', () => {
      expect(getNextRunEstimate('0 */6 * * *')).toBe('Every 6 hours')
      expect(getNextRunEstimate('0 */1 * * *')).toBe('Every 1 hour')
    })
    
    it('should describe daily schedules', () => {
      expect(getNextRunEstimate('0 9 * * *')).toContain('Daily at')
    })
    
    it('should describe weekly schedules', () => {
      const estimate = getNextRunEstimate('0 9 * * 1,3,5')
      expect(estimate).toContain('Mon')
    })
    
    it('should return expression for invalid cron', () => {
      expect(getNextRunEstimate('invalid')).toBe('Invalid cron')
    })
  })
})
