/**
 * Wakeup command - Auto wake-up and warm up AI models
 */

import inquirer from 'inquirer'
import Table from 'cli-table3'
import {
  loadWakeupConfig,
  saveWakeupConfig,
  getOrCreateConfig,
  getRecentHistory,
  getLastTrigger,
  clearTriggerHistory,
  type WakeupConfig,
  type TriggerRecord,
  getDefaultConfig
} from '../wakeup/index.js'
import {
  installCronJob,
  uninstallCronJob,
  getCronStatus,
  isCronSupported
} from '../wakeup/cron-installer.js'
import {
  configToCronExpression,
  getScheduleDescription,
  getNextRunEstimate
} from '../wakeup/schedule-converter.js'
import {
  executeTrigger,
  testTrigger
} from '../wakeup/trigger-service.js'
import {
  resolveAccounts,
  getAccountResolutionStatus
} from '../wakeup/account-resolver.js'
import { getAccountManager } from '../accounts/manager.js'
import { debug } from '../core/logger.js'

// Subcommand type
type WakeupSubcommand = 'config' | 'trigger' | 'install' | 'uninstall' | 'test' | 'history' | 'status'

interface WakeupOptions {
  scheduled?: boolean
  limit?: string
  json?: boolean
}

/**
 * Main wakeup command handler
 */
export async function wakeupCommand(
  subcommand: WakeupSubcommand,
  args: string[],
  options: WakeupOptions
): Promise<void> {
  debug('wakeup', `Subcommand: ${subcommand}, options:`, options)
  
  switch (subcommand) {
    case 'config':
      await configureWakeup()
      break
    
    case 'trigger':
      await runScheduledTrigger(options.scheduled ?? false)
      break
    
    case 'install':
      await installSchedule()
      break
    
    case 'uninstall':
      await uninstallSchedule()
      break
    
    case 'test':
      await runTestTrigger()
      break
    
    case 'history':
      await showHistory(options)
      break
    
    case 'status':
    default:
      await showStatus()
      break
  }
}

// ============================================================================
// Subcommand Implementations
// ============================================================================

/**
 * Configure wake-up schedule interactively
 */
async function configureWakeup(): Promise<void> {
  console.log('\n🔧 Auto Wake-up Configuration\n')
  
  const config = getOrCreateConfig()
  const accountManager = getAccountManager()
  const accounts = accountManager.getAccountEmails()
  
  if (accounts.length === 0) {
    console.log('❌ No accounts available. Please login first:')
    console.log('   antigravity-usage login\n')
    return
  }
  
  // Step 1: Enable/disable
  const { enabled } = await inquirer.prompt([{
    type: 'confirm',
    name: 'enabled',
    message: 'Enable auto wake-up?',
    default: config.enabled
  }])
  
  if (!enabled) {
    config.enabled = false
    saveWakeupConfig(config)
    console.log('\n✅ Auto wake-up disabled')
    return
  }
  
  // Step 2: Choose trigger mode
  const { triggerMode } = await inquirer.prompt([{
    type: 'list',
    name: 'triggerMode',
    message: 'Trigger mode:',
    choices: [
      { name: 'Schedule-based (run at specific times)', value: 'schedule' },
      { name: 'Quota-reset-based (trigger when quota resets)', value: 'reset' }
    ],
    default: config.wakeOnReset ? 'reset' : 'schedule'
  }])
  
  config.wakeOnReset = triggerMode === 'reset'
  
  // Step 3: Configure schedule (if schedule mode)
  if (!config.wakeOnReset) {
    const { scheduleMode } = await inquirer.prompt([{
      type: 'list',
      name: 'scheduleMode',
      message: 'Schedule type:',
      choices: [
        { name: 'Every N hours', value: 'interval' },
        { name: 'Daily at specific times', value: 'daily' },
        { name: 'Custom cron expression', value: 'custom' }
      ],
      default: config.scheduleMode
    }])
    
    config.scheduleMode = scheduleMode
    
    if (scheduleMode === 'interval') {
      const { intervalHours } = await inquirer.prompt([{
        type: 'number',
        name: 'intervalHours',
        message: 'Trigger every N hours:',
        default: config.intervalHours || 6,
        validate: (val: number) => val >= 1 && val <= 23 ? true : 'Must be 1-23'
      }])
      config.intervalHours = intervalHours
    } else if (scheduleMode === 'daily') {
      const { dailyTime } = await inquirer.prompt([{
        type: 'input',
        name: 'dailyTime',
        message: 'Time to trigger (HH:MM):',
        default: config.dailyTimes?.[0] || '09:00',
        validate: (val: string) => /^\d{1,2}:\d{2}$/.test(val) ? true : 'Use HH:MM format'
      }])
      config.dailyTimes = [dailyTime]
    } else if (scheduleMode === 'custom') {
      const { cronExpression } = await inquirer.prompt([{
        type: 'input',
        name: 'cronExpression',
        message: 'Cron expression (min hour day month weekday):',
        default: config.cronExpression || '0 */6 * * *'
      }])
      config.cronExpression = cronExpression
    }
  } else {
    // Reset mode configuration
    const { resetCooldown } = await inquirer.prompt([{
      type: 'number',
      name: 'resetCooldown',
      message: 'Cooldown between triggers (minutes):',
      default: config.resetCooldownMinutes || 10,
      validate: (val: number) => val >= 1 ? true : 'Must be at least 1 minute'
    }])
    config.resetCooldownMinutes = resetCooldown
  }
  
  // Step 4: Models - Use default models that cover both families
  // claude-sonnet-4-5 triggers Claude family, gemini-3-flash triggers Gemini family
  config.selectedModels = ['claude-sonnet-4-5', 'gemini-3-flash']
  console.log('\n   📦 Models: claude-sonnet-4-5, gemini-3-flash')
  console.log('      (Triggers both Claude and Gemini families)')
  
  // Step 5: Select accounts
  if (accounts.length > 1) {
    const { selectedAccounts } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedAccounts',
      message: 'Select accounts to use:',
      choices: accounts.map(email => ({
        name: email,
        value: email,
        checked: !config.selectedAccounts || config.selectedAccounts.includes(email)
      }))
    }])
    config.selectedAccounts = selectedAccounts.length > 0 ? selectedAccounts : undefined
  } else {
    config.selectedAccounts = undefined // Use default (active account)
  }
  
  // Step 6: Custom prompt (optional)
  const { customPrompt } = await inquirer.prompt([{
    type: 'input',
    name: 'customPrompt',
    message: 'Custom wake-up prompt (leave empty for default "hi"):',
    default: config.customPrompt || ''
  }])
  config.customPrompt = customPrompt || undefined
  
  // Step 7: Max output tokens
  const { maxTokens } = await inquirer.prompt([{
    type: 'number',
    name: 'maxTokens',
    message: 'Max output tokens (0 = no limit):',
    default: config.maxOutputTokens || 0
  }])
  config.maxOutputTokens = maxTokens
  
  // Save config
  config.enabled = true
  saveWakeupConfig(config)
  
  console.log('\n✅ Configuration saved!')
  console.log(`   Mode: ${getScheduleDescription(config)}`)
  console.log(`   Models: ${config.selectedModels.join(', ')}`)
  console.log(`   Accounts: ${config.selectedAccounts?.join(', ') || 'Active account'}`)
  
  // Offer to install cron job if schedule mode
  if (!config.wakeOnReset && isCronSupported()) {
    const { installNow } = await inquirer.prompt([{
      type: 'confirm',
      name: 'installNow',
      message: 'Install to system cron now?',
      default: true
    }])
    
    if (installNow) {
      await installSchedule()
    } else {
      console.log('\n📋 To install later, run:')
      console.log('   antigravity-usage wakeup install')
    }
  }
  
  console.log('')
}

/**
 * Run a scheduled trigger (called by cron)
 */
async function runScheduledTrigger(isScheduled: boolean): Promise<void> {
  debug('wakeup', `Running trigger (scheduled: ${isScheduled})`)
  
  const config = loadWakeupConfig()
  
  if (!config || !config.enabled) {
    debug('wakeup', 'Wakeup not configured or disabled')
    return
  }
  
  const accounts = resolveAccounts(config.selectedAccounts)
  if (accounts.length === 0) {
    debug('wakeup', 'No valid accounts')
    return
  }
  
  if (config.selectedModels.length === 0) {
    debug('wakeup', 'No models selected')
    return
  }
  
  // Execute trigger for each account
  for (const accountEmail of accounts) {
    const result = await executeTrigger({
      models: config.selectedModels,
      accountEmail,
      triggerType: 'auto',
      triggerSource: isScheduled ? 'scheduled' : 'manual',
      customPrompt: config.customPrompt,
      maxOutputTokens: config.maxOutputTokens
    })
    
    const successCount = result.results.filter(r => r.success).length
    console.log(`[${new Date().toISOString()}] ${accountEmail}: ${successCount}/${result.results.length} models triggered`)
  }
}

/**
 * Install schedule to system cron
 */
async function installSchedule(): Promise<void> {
  console.log('\n📅 Installing wake-up schedule to cron...\n')
  
  if (!isCronSupported()) {
    console.log('❌ Cron is not supported on this platform.')
    console.log('   Windows Task Scheduler support coming soon.')
    return
  }
  
  const config = loadWakeupConfig()
  
  if (!config) {
    console.log('❌ No wake-up configuration found.')
    console.log('   Run: antigravity-usage wakeup config')
    return
  }
  
  if (!config.enabled) {
    console.log('❌ Wake-up is disabled. Enable it first:')
    console.log('   antigravity-usage wakeup config')
    return
  }
  
  if (config.wakeOnReset) {
    console.log('ℹ️  Quota-reset mode does not require cron installation.')
    console.log('   Triggers happen automatically when you check quota.')
    return
  }
  
  try {
    const cronExpression = configToCronExpression(config)
    console.log(`   Schedule: ${getScheduleDescription(config)}`)
    console.log(`   Cron: ${cronExpression}`)
    console.log('')
    
    const result = await installCronJob(cronExpression)
    
    if (result.success) {
      console.log('✅ Cron job installed successfully!')
      console.log(`   Next run: ${getNextRunEstimate(cronExpression)}`)
      console.log('')
      console.log('   To check status: antigravity-usage wakeup status')
      console.log('   To uninstall: antigravity-usage wakeup uninstall')
    } else {
      console.log('⚠️  Automatic installation failed.')
      if (result.manualInstructions) {
        console.log('')
        console.log(result.manualInstructions)
      }
    }
  } catch (err) {
    console.log(`❌ Error: ${err instanceof Error ? err.message : err}`)
  }
  
  console.log('')
}

/**
 * Uninstall schedule from system cron
 */
async function uninstallSchedule(): Promise<void> {
  console.log('\n🗑️  Removing wake-up schedule from cron...\n')
  
  const success = await uninstallCronJob()
  
  if (success) {
    console.log('✅ Cron job removed successfully!')
  } else {
    console.log('⚠️  Could not remove cron job. It may not be installed.')
    console.log('   Check your crontab: crontab -l')
  }
  
  console.log('')
}

/**
 * Run a manual test trigger
 */
async function runTestTrigger(): Promise<void> {
  console.log('\n🧪 Test Trigger\n')
  
  const accountManager = getAccountManager()
  const accounts = accountManager.getAccountEmails()
  
  if (accounts.length === 0) {
    console.log('❌ No accounts available. Please login first.')
    return
  }
  
  // Select account
  let accountEmail = accounts[0]
  if (accounts.length > 1) {
    const { selectedAccount } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedAccount',
      message: 'Select account:',
      choices: accounts
    }])
    accountEmail = selectedAccount
  }
  
  // Enter model ID
  const config = loadWakeupConfig()
  const { modelId } = await inquirer.prompt([{
    type: 'input',
    name: 'modelId',
    message: 'Model ID to test:',
    default: config?.selectedModels[0] || 'claude-sonnet-4-5'
  }])
  
  // Enter prompt
  const { prompt } = await inquirer.prompt([{
    type: 'input',
    name: 'prompt',
    message: 'Test prompt:',
    default: 'hi'
  }])
  
  console.log('\n⏳ Triggering...')
  
  try {
    const result = await testTrigger(modelId, accountEmail, prompt)
    
    if (result.success) {
      console.log(`\n✅ Success! (${result.durationMs}ms)`)
      if (result.response) {
        console.log(`\n📝 Response:\n${result.response.substring(0, 200)}...`)
      }
      if (result.tokensUsed) {
        console.log(`\n📊 Tokens: ${result.tokensUsed.total} (prompt: ${result.tokensUsed.prompt}, completion: ${result.tokensUsed.completion})`)
      }
    } else {
      console.log(`\n❌ Failed: ${result.error}`)
    }
  } catch (err) {
    console.log(`\n❌ Error: ${err instanceof Error ? err.message : err}`)
  }
  
  console.log('')
  
  // Exit cleanly to avoid hanging on open HTTP connections
  process.exit(0)
}

/**
 * Show trigger history
 */
async function showHistory(options: WakeupOptions): Promise<void> {
  const limit = parseInt(options.limit || '10', 10)
  const history = getRecentHistory(limit)
  
  if (history.length === 0) {
    console.log('\n📜 No trigger history yet.\n')
    return
  }
  
  if (options.json) {
    console.log(JSON.stringify(history, null, 2))
    return
  }
  
  console.log(`\n📜 Trigger History (last ${Math.min(limit, history.length)} records)\n`)
  
  const table = new Table({
    head: ['Time', 'Source', 'Model', 'Account', 'Duration', 'Status'],
    style: { head: ['cyan'] }
  })
  
  for (const record of history) {
    const time = new Date(record.timestamp).toLocaleString()
    const status = record.success ? '✅' : `❌ ${record.error?.substring(0, 20) || ''}`
    
    table.push([
      time,
      record.triggerSource,
      record.models[0] || '-',
      record.accountEmail.split('@')[0],
      `${record.durationMs}ms`,
      status
    ])
  }
  
  console.log(table.toString())
  console.log('')
}

/**
 * Show current wake-up status
 */
async function showStatus(): Promise<void> {
  console.log('\n📊 Auto Wake-up Status\n')
  
  const config = loadWakeupConfig()
  
  if (!config) {
    console.log('   Status: Not configured')
    console.log('')
    console.log('   To configure: antigravity-usage wakeup config')
    console.log('')
    return
  }
  
  // Basic status
  console.log(`   Enabled: ${config.enabled ? '✅ Yes' : '❌ No'}`)
  console.log(`   Mode: ${getScheduleDescription(config)}`)
  
  // Models
  if (config.selectedModels.length > 0) {
    console.log(`   Models: ${config.selectedModels.join(', ')}`)
  } else {
    console.log('   Models: None selected')
  }
  
  // Accounts
  console.log(`   Accounts: ${getAccountResolutionStatus(config.selectedAccounts)}`)
  
  // Cron status (for schedule mode)
  if (!config.wakeOnReset && config.enabled) {
    const cronStatus = await getCronStatus()
    if (cronStatus.installed) {
      console.log(`   Cron: ✅ Installed (${cronStatus.cronExpression})`)
      if (cronStatus.nextRun) {
        console.log(`   Next run: ${cronStatus.nextRun}`)
      }
    } else {
      console.log('   Cron: ❌ Not installed')
      console.log('         Run: antigravity-usage wakeup install')
    }
  }
  
  // Last trigger
  const lastTrigger = getLastTrigger()
  if (lastTrigger) {
    const ago = getTimeAgo(new Date(lastTrigger.timestamp))
    const status = lastTrigger.success ? '✅ success' : `❌ ${lastTrigger.error?.substring(0, 30) || 'failed'}`
    console.log(`   Last trigger: ${ago} (${status})`)
  } else {
    console.log('   Last trigger: Never')
  }
  
  console.log('')
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}
