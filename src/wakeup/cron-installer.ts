/**
 * Cron installer for auto wake-up
 * Manages cron job installation for macOS/Linux
 */

import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { debug } from '../core/logger.js'
import type { CronInstallResult, CronStatus } from './types.js'

const execAsync = promisify(exec)

// Comment marker to identify our cron entries
const CRON_COMMENT_MARKER = 'antigravity-usage-wakeup'

/**
 * Get PATH directories for cron environment
 * Returns directories where node and npm binaries are found
 * This makes cron jobs portable across different machines and Node.js installations
 */
function getBinDirectories(): string[] {
  const dirs = new Set<string>()
  
  try {
    // Get node's bin directory from current process
    const nodePath = process.execPath
    const nodeDir = nodePath.substring(0, nodePath.lastIndexOf('/'))
    if (nodeDir) {
      dirs.add(nodeDir)
      debug('cron-installer', `Found node bin dir: ${nodeDir}`)
    }
  } catch {
    debug('cron-installer', 'Could not determine node bin directory')
  }
  
  try {
    // Get npm global bin directory
    const npmBin = execSync('npm bin -g', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    if (npmBin) {
      dirs.add(npmBin)
      debug('cron-installer', `Found npm bin dir: ${npmBin}`)
    }
  } catch {
    debug('cron-installer', 'Could not determine npm bin directory')
  }
  
  // Try to get user's current PATH as fallback
  // This helps capture paths from nvm, homebrew, etc.
  if (process.env.PATH) {
    const userPaths = process.env.PATH.split(':').filter(p => {
      // Include paths that might contain node or npm binaries
      return p.includes('node') || p.includes('npm') || 
             p.includes('nvm') || p.includes('.local') ||
             p === '/usr/local/bin' || p === '/opt/homebrew/bin'
    })
    userPaths.forEach(p => {
      if (p) {
        dirs.add(p)
        debug('cron-installer', `Added user PATH: ${p}`)
      }
    })
  }
  
  // Add standard system paths (always include these)
  dirs.add('/usr/local/bin')
  dirs.add('/usr/bin')
  dirs.add('/bin')
  dirs.add('/opt/homebrew/bin') // For Apple Silicon Macs
  
  return Array.from(dirs)
}

/**
 * Load current crontab entries
 */
async function loadCrontab(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""')
    const lines = stdout.split('\n').filter(line => line.trim())
    debug('cron-installer', `Loaded ${lines.length} crontab entries`)
    return lines
  } catch {
    debug('cron-installer', 'No existing crontab or error loading')
    return []
  }
}

/**
 * Save crontab entries
 */
async function saveCrontab(lines: string[]): Promise<void> {
  const content = lines.join('\n') + '\n'
  
  try {
    // Write to temp file and load into crontab
    const { exec: execCallback } = await import('child_process')
    
    await new Promise<void>((resolve, reject) => {
      const proc = execCallback('crontab -', (err) => {
        if (err) reject(err)
        else resolve()
      })
      proc.stdin?.write(content)
      proc.stdin?.end()
    })
    
    debug('cron-installer', 'Saved crontab successfully')
  } catch (err) {
    debug('cron-installer', 'Error saving crontab:', err)
    throw err
  }
}

/**
 * Remove all antigravity-usage-wakeup entries from crontab lines
 */
function removeWakeupEntries(lines: string[]): string[] {
  return lines.filter(line => !line.includes(CRON_COMMENT_MARKER))
}

/**
 * Check if running on a supported platform
 */
export function isCronSupported(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux'
}

/**
 * Install cron job for scheduled wake-up
 * @param cronExpression Cron expression (5 fields: minute hour day month weekday)
 * @returns Installation result with success status or manual instructions
 */
export async function installCronJob(cronExpression: string): Promise<CronInstallResult> {
  if (!isCronSupported()) {
    return {
      success: false,
      error: `Cron is not supported on ${process.platform}. Windows Task Scheduler support coming soon.`,
      manualInstructions: getWindowsInstructions(cronExpression)
    }
  }
  
  try {
    // Get PATH directories - auto-detected from current environment
    // This makes the cron job portable across different machines and Node.js installations
    const binDirs = getBinDirectories()
    const pathValue = binDirs.join(':')
    
    // Load existing crontab
    const lines = await loadCrontab()
    
    // Remove any existing antigravity-usage entries (both PATH and job lines)
    const filteredLines = removeWakeupEntries(lines)
    
    // Add PATH if not already set for other cron jobs
    const hasPath = filteredLines.some(line => line.startsWith('PATH='))
    if (!hasPath) {
      filteredLines.unshift(`PATH=${pathValue}`)
    }
    
    // Create new cron entry with simple, portable command
    // Using 'antigravity-usage' instead of absolute paths makes it work anywhere
    const cronLine = `${cronExpression} antigravity-usage wakeup trigger --scheduled # ${CRON_COMMENT_MARKER}`
    
    // Add new entry
    filteredLines.push(cronLine)
    
    // Save crontab
    await saveCrontab(filteredLines)
    
    debug('cron-installer', `Installed cron job: ${cronLine}`)
    debug('cron-installer', `Using PATH: ${pathValue}`)
    
    return {
      success: true,
      cronExpression
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    debug('cron-installer', `Failed to install cron job: ${errorMessage}`)
    
    return {
      success: false,
      error: errorMessage,
      manualInstructions: getManualInstructions(cronExpression)
    }
  }
}

/**
 * Uninstall cron job
 * @returns true if successful, false otherwise
 */
export async function uninstallCronJob(): Promise<boolean> {
  if (!isCronSupported()) {
    debug('cron-installer', 'Cron not supported on this platform')
    return false
  }
  
  try {
    // Load existing crontab
    const lines = await loadCrontab()
    
    // Remove our entries
    const filteredLines = removeWakeupEntries(lines)
    
    // If nothing changed, already uninstalled
    if (filteredLines.length === lines.length) {
      debug('cron-installer', 'No cron job found to uninstall')
      return true
    }
    
    // Save updated crontab
    await saveCrontab(filteredLines)
    
    debug('cron-installer', 'Uninstalled cron job successfully')
    return true
  } catch (err) {
    debug('cron-installer', 'Failed to uninstall cron job:', err)
    return false
  }
}

/**
 * Check if cron job is installed
 */
export async function isCronJobInstalled(): Promise<boolean> {
  if (!isCronSupported()) {
    return false
  }
  
  try {
    const lines = await loadCrontab()
    return lines.some(line => line.includes(CRON_COMMENT_MARKER))
  } catch {
    return false
  }
}

/**
 * Get current cron job status
 */
export async function getCronStatus(): Promise<CronStatus> {
  if (!isCronSupported()) {
    return { installed: false }
  }
  
  try {
    const lines = await loadCrontab()
    const cronLine = lines.find(line => line.includes(CRON_COMMENT_MARKER))
    
    if (!cronLine) {
      return { installed: false }
    }
    
    // Extract cron expression from line
    const parts = cronLine.trim().split(/\s+/)
    const cronExpression = parts.slice(0, 5).join(' ')
    
    return {
      installed: true,
      cronExpression,
      nextRun: getNextRunDescription(cronExpression)
    }
  } catch {
    return { installed: false }
  }
}

/**
 * Generate manual instructions for cron setup
 */
function getManualInstructions(cronExpression: string): string {
  const binDirs = getBinDirectories()
  const pathValue = binDirs.join(':')
  
  return `
Failed to automatically install cron job. Please add manually:

1. Open terminal and run: crontab -e

2. Add these lines:
   PATH=${pathValue}
   ${cronExpression} antigravity-usage wakeup trigger --scheduled # ${CRON_COMMENT_MARKER}

3. Save and exit the editor

To verify, run: crontab -l
`.trim()
}

/**
 * Generate instructions for Windows users
 */
function getWindowsInstructions(cronExpression: string): string {
  return `
Windows Task Scheduler support is not yet available.

To set up manually using Task Scheduler:

1. Open Task Scheduler (taskschd.msc)
2. Create a new Basic Task
3. Set trigger: Based on your schedule (${cronExpression})
4. Set action: Start a program
   - Program: antigravity-usage
   - Arguments: wakeup trigger --scheduled
5. Save the task

Alternatively, use Windows Subsystem for Linux (WSL) with cron.
`.trim()
}

/**
 * Get human-readable description of next run
 */
function getNextRunDescription(cronExpression: string): string {
  try {
    const parts = cronExpression.split(/\s+/)
    if (parts.length !== 5) return 'Unknown'
    
    const [minute, hour] = parts
    
    // Interval-based
    if (hour.startsWith('*/')) {
      const hours = parseInt(hour.substring(2), 10)
      const now = new Date()
      const currentHour = now.getHours()
      const nextHour = Math.ceil((currentHour + 1) / hours) * hours
      const isToday = nextHour < 24
      return isToday ? `Today around ${nextHour}:00` : 'Tomorrow'
    }
    
    // Specific time
    const hourNum = parseInt(hour.split(',')[0], 10)
    const minuteNum = parseInt(minute, 10)
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const targetMinutes = hourNum * 60 + minuteNum
    
    if (targetMinutes > currentMinutes) {
      return `Today at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    }
    return `Tomorrow at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  } catch {
    return 'Unknown'
  }
}
