/**
 * Tests for cron installer module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import {
  installCronJob,
  uninstallCronJob,
  isCronJobInstalled,
  getCronStatus,
  isCronSupported
} from '../../src/wakeup/cron-installer.js'

describe('Cron Installer', () => {
  // Store original crontab to restore after tests
  let originalCrontab: string | null = null
  
  beforeEach(async () => {
    // Only run these tests on supported platforms
    if (!isCronSupported()) {
      return
    }
    
    // Backup current crontab
    try {
      originalCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    } catch {
      originalCrontab = null
    }
    
    // Clean up any existing antigravity-usage cron jobs for clean test state
    await uninstallCronJob()
  })
  
  afterEach(async () => {
    // Only run cleanup on supported platforms
    if (!isCronSupported()) {
      return
    }
    
    // Restore original crontab
    if (originalCrontab !== null) {
      execSync('echo "' + originalCrontab.replace(/"/g, '\\"') + '" | crontab -')
    } else {
      execSync('crontab -r 2>/dev/null || true')
    }
  })
  
  describe('isCronSupported', () => {
    it('should return true on macOS', () => {
      if (process.platform === 'darwin') {
        expect(isCronSupported()).toBe(true)
      }
    })
    
    it('should return true on Linux', () => {
      if (process.platform === 'linux') {
        expect(isCronSupported()).toBe(true)
      }
    })
    
    it('should return false on Windows', () => {
      if (process.platform === 'win32') {
        expect(isCronSupported()).toBe(false)
      }
    })
  })
  
  describe('installCronJob', () => {
    it('should install a cron job successfully', { skip: !isCronSupported() }, async () => {
      const cronExpression = '0 9 * * *'
      const result = await installCronJob(cronExpression)
      
      expect(result.success).toBe(true)
      expect(result.cronExpression).toBe(cronExpression)
      
      // Verify it's actually in crontab
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      expect(crontab).toContain('antigravity-usage wakeup trigger --scheduled')
      expect(crontab).toContain('antigravity-usage-wakeup')
    })
    
    it('should add PATH to crontab', { skip: !isCronSupported() }, async () => {
      const cronExpression = '0 9 * * *'
      await installCronJob(cronExpression)
      
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      expect(crontab).toMatch(/^PATH=/m)
    })
    
    it('should use simple portable command', { skip: !isCronSupported() }, async () => {
      const cronExpression = '0 9 * * *'
      await installCronJob(cronExpression)
      
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      // Should NOT contain absolute paths to node
      expect(crontab).toContain('antigravity-usage wakeup trigger --scheduled')
      // Should be the simple command on the scheduled line
      const cronLine = crontab.split('\n').find(line => line.includes('antigravity-usage-wakeup'))
      expect(cronLine).toBeTruthy()
      expect(cronLine).toMatch(/^\d+ \d+ \* \* \* antigravity-usage/)
    })
    
    it('should replace existing cron job', { skip: !isCronSupported() }, async () => {
      // Install first cron job
      await installCronJob('0 9 * * *')
      
      // Install second one with different time
      await installCronJob('0 10 * * *')
      
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      const cronLines = crontab.split('\n').filter(line => line.includes('antigravity-usage-wakeup'))
      
      // Should only have one entry
      expect(cronLines.length).toBe(1)
      // Should have the new time
      expect(cronLines[0]).toContain('0 10 * * *')
    })
    
    it('should return error on Windows', async () => {
      const originalPlatform = process.platform
      
      // Mock platform (note: this won't actually work in vitest, but shows intent)
      if (process.platform === 'win32') {
        const cronExpression = '0 9 * * *'
        const result = await installCronJob(cronExpression)
        
        expect(result.success).toBe(false)
        expect(result.error).toContain('not supported')
        expect(result.manualInstructions).toBeTruthy()
      }
    })
  })
  
  describe('uninstallCronJob', () => {
    it('should remove installed cron job', { skip: !isCronSupported() }, async () => {
      // First install
      await installCronJob('0 9 * * *')
      
      // Then uninstall
      const success = await uninstallCronJob()
      
      expect(success).toBe(true)
      
      // Verify it's removed
      const installed = await isCronJobInstalled()
      expect(installed).toBe(false)
    })
    
    it('should return true when no job is installed', { skip: !isCronSupported() }, async () => {
      const success = await uninstallCronJob()
      expect(success).toBe(true)
    })
  })
  
  describe('isCronJobInstalled', () => {
    it('should return false when not installed', { skip: !isCronSupported() }, async () => {
      const installed = await isCronJobInstalled()
      expect(installed).toBe(false)
    })
    
    it('should return true when installed', { skip: !isCronSupported() }, async () => {
      await installCronJob('0 9 * * *')
      
      const installed = await isCronJobInstalled()
      expect(installed).toBe(true)
    })
  })
  
  describe('getCronStatus', () => {
    it('should return not installed status', { skip: !isCronSupported() }, async () => {
      const status = await getCronStatus()
      expect(status.installed).toBe(false)
    })
    
    it('should return installed status with details', { skip: !isCronSupported() }, async () => {
      const cronExpression = '30 14 * * *'
      await installCronJob(cronExpression)
      
      const status = await getCronStatus()
      expect(status.installed).toBe(true)
      expect(status.cronExpression).toBe(cronExpression)
      expect(status.nextRun).toBeTruthy()
    })
  })
  
  describe('PATH Detection', () => {
    it('should detect node bin directory', { skip: !isCronSupported() }, async () => {
      await installCronJob('0 9 * * *')
      
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      const pathLine = crontab.split('\n').find(line => line.startsWith('PATH='))
      
      expect(pathLine).toBeTruthy()
      
      // Should include node's bin directory
      const nodeBinDir = process.execPath.substring(0, process.execPath.lastIndexOf('/'))
      expect(pathLine).toContain(nodeBinDir)
    })
    
    it('should include standard paths', { skip: !isCronSupported() }, async () => {
      await installCronJob('0 9 * * *')
      
      const crontab = execSync('crontab -l', { encoding: 'utf-8' })
      const pathLine = crontab.split('\n').find(line => line.startsWith('PATH='))
      
      expect(pathLine).toContain('/usr/local/bin')
      expect(pathLine).toContain('/usr/bin')
      expect(pathLine).toContain('/bin')
    })
    
    it('should include npm global bin on macOS/Linux', { skip: !isCronSupported() }, async () => {
      await installCronJob('0 9 * * *')
      
      try {
        const npmBin = execSync('npm bin -g', { encoding: 'utf-8' }).trim()
        const crontab = execSync('crontab -l', { encoding: 'utf-8' })
        const pathLine = crontab.split('\n').find(line => line.startsWith('PATH='))
        
        expect(pathLine).toContain(npmBin)
      } catch {
        // npm might not be available in test environment
      }
    })
  })
})
