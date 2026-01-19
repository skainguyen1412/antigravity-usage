/**
 * Schedule converter for auto wake-up
 * Converts schedule configuration to cron expressions
 */

import type { WakeupConfig, WeeklySchedule } from './types.js'

/**
 * Convert wakeup config to cron expression
 * @param config Wake-up configuration
 * @returns Cron expression string (5 fields: minute hour day month weekday)
 */
export function configToCronExpression(config: WakeupConfig): string {
  // If custom cron expression provided, use it directly
  if (config.cronExpression) {
    return config.cronExpression
  }
  
  switch (config.scheduleMode) {
    case 'interval':
      return intervalToCron(config.intervalHours || 6)
    
    case 'daily':
      return dailyToCron(config.dailyTimes || ['09:00'])
    
    case 'weekly':
      return weeklyToCron(config.weeklySchedule || {})
    
    case 'custom':
      // Should have cronExpression set, fallback to every 6 hours
      return '0 */6 * * *'
    
    default:
      throw new Error(`Unknown schedule mode: ${config.scheduleMode}`)
  }
}

/**
 * Interval mode: every N hours
 * Example: every 6 hours produces cron "0 STAR/6 * * *" (STAR = asterisk)
 */
function intervalToCron(hours: number): string {
  if (hours < 1 || hours > 23) {
    throw new Error('Interval hours must be between 1 and 23')
  }
  return `0 */${hours} * * *`
}

/**
 * Daily mode: at specific times each day
 * For multiple times, creates comma-separated hours
 * Example: ["09:00", "18:00"] produces cron "0 9,18 * * *"
 */
function dailyToCron(times: string[]): string {
  if (times.length === 0) {
    throw new Error('Daily mode requires at least one time')
  }
  
  // Parse all times
  const parsedTimes = times.map(parseTime)
  
  // Group by minute (most common case: all same minute, usually :00)
  // For simplicity, use the first time's minute and all hours
  const [firstHour, firstMinute] = parsedTimes[0]
  const hours = parsedTimes.map(([h]) => h)
  
  // If all times have the same minute, use comma-separated hours
  const allSameMinute = parsedTimes.every(([, m]) => m === firstMinute)
  
  if (allSameMinute) {
    return `${firstMinute} ${hours.join(',')} * * *`
  }
  
  // Different minutes - just use the first time
  // (Multiple cron entries would require multiple install calls)
  return `${firstMinute} ${firstHour} * * *`
}

/**
 * Weekly mode: specific days at specific times
 * Example: day 1 at 09:00 and day 5 at 17:00 produces cron "0 9 * * 1"
 * Note: For multiple days with same time, uses comma-separated days
 */
function weeklyToCron(schedule: WeeklySchedule): string {
  const days = Object.keys(schedule).map(Number).sort()
  
  if (days.length === 0) {
    throw new Error('Weekly mode requires at least one day')
  }
  
  // Use first day's first time
  const firstDay = days[0]
  const firstDayTimes = schedule[firstDay]
  
  if (!firstDayTimes || firstDayTimes.length === 0) {
    throw new Error(`No times specified for day ${firstDay}`)
  }
  
  const [hour, minute] = parseTime(firstDayTimes[0])
  
  // Create day list
  const daysStr = days.join(',')
  
  return `${minute} ${hour} * * ${daysStr}`
}

/**
 * Parse time string "HH:MM" to [hour, minute]
 */
function parseTime(timeStr: string): [number, number] {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM`)
  }
  
  const hour = parseInt(match[1], 10)
  const minute = parseInt(match[2], 10)
  
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time values: ${timeStr}`)
  }
  
  return [hour, minute]
}

/**
 * Validate a cron expression (basic validation)
 * @param expr Cron expression to validate
 * @returns true if valid, false otherwise
 */
export function validateCronExpression(expr: string): boolean {
  // Basic validation: 5 fields (minute hour day month weekday)
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return false
  }
  
  // Each field should match basic cron syntax
  const fieldPattern = /^(\*|[\d,\-\/\*]+)$/
  return parts.every(part => fieldPattern.test(part))
}

/**
 * Get human-readable description of schedule
 */
export function getScheduleDescription(config: WakeupConfig): string {
  if (!config.enabled) {
    return 'Disabled'
  }
  
  if (config.wakeOnReset) {
    const cooldown = config.resetCooldownMinutes || 10
    return `Quota-reset based (${cooldown}min cooldown)`
  }
  
  switch (config.scheduleMode) {
    case 'interval':
      const hours = config.intervalHours || 6
      return `Every ${hours} hour${hours > 1 ? 's' : ''}`
    
    case 'daily':
      const times = config.dailyTimes || ['09:00']
      if (times.length === 1) {
        return `Daily at ${times[0]}`
      }
      return `Daily at ${times.join(', ')}`
    
    case 'weekly':
      const days = Object.keys(config.weeklySchedule || {}).map(Number)
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const dayList = days.map(d => dayNames[d]).join(', ')
      return `Weekly on ${dayList}`
    
    case 'custom':
      return `Custom: ${config.cronExpression || 'Not set'}`
    
    default:
      return 'Unknown schedule'
  }
}

/**
 * Calculate next run time from cron expression (simplified)
 * Returns a human-readable estimate
 */
export function getNextRunEstimate(cronExpression: string): string {
  try {
    const parts = cronExpression.trim().split(/\s+/)
    if (parts.length !== 5) {
      return 'Invalid cron'
    }
    
    const [minute, hour, day, month, weekday] = parts
    
    // Simple cases
    if (hour.startsWith('*/')) {
      const interval = parseInt(hour.substring(2), 10)
      return `Every ${interval} hour${interval > 1 ? 's' : ''}`
    }
    
    if (day === '*' && month === '*' && weekday === '*') {
      // Daily - show specific time
      const displayHour = hour.includes(',') ? hour.split(',')[0] : hour
      return `Daily at ${displayHour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    }
    
    if (weekday !== '*') {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const dayNums = weekday.split(',').map(Number)
      const dayList = dayNums.map(d => dayNames[d] || d).join(', ')
      return `${dayList} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    }
    
    return cronExpression
  } catch {
    return cronExpression
  }
}
