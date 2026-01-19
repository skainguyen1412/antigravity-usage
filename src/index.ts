/**
 * antigravity-usage CLI entry point
 */

import { Command } from 'commander'
import { version } from './version'
import { setDebugMode } from './core/logger.js'

// Import commands
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { statusCommand } from './commands/status.js'
import { quotaCommand } from './commands/quota.js'
import { doctorCommand } from './commands/doctor.js'
import { accountsCommand } from './commands/accounts.js'

const program = new Command()

program
  .name('antigravity-usage')
  .description('CLI tool to check Antigravity model quota via Google Cloud Code API')
  .version(version)
  .option('--debug', 'Enable debug mode')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.debug) {
      setDebugMode(true)
    }
  })

// Login command
program
  .command('login')
  .description('Authenticate with Google (adds a new account)')
  .option('--no-browser', 'Do not open browser, print URL instead')
  .option('-p, --port <port>', 'Port for OAuth callback server', parseInt)
  .action(loginCommand)

// Logout command
program
  .command('logout [email]')
  .description('Remove stored credentials')
  .option('--all', 'Logout from all accounts')
  .action((email, options) => logoutCommand(options, email))

// Status command
program
  .command('status')
  .description('Show current authentication status')
  .option('--all', 'Show status for all accounts')
  .option('-a, --account <email>', 'Show status for specific account')
  .action(statusCommand)

// Quota command (default)
program
  .command('quota', { isDefault: true })
  .description('Fetch and display quota information')
  .option('--json', 'Output as JSON')
  .option('-m, --method <method>', 'Method to use: auto (default), local, or google', 'auto')
  .option('--all', 'Show quota for all accounts')
  .option('-a, --account <email>', 'Show quota for specific account')
  .option('--refresh', 'Force refresh (ignore cache)')
  .action(quotaCommand)

// Accounts command with subcommands
const accountsCmd = program
  .command('accounts')
  .description('Manage multiple accounts')

accountsCmd
  .command('list')
  .description('List all accounts')
  .option('--refresh', 'Show refresh tip')
  .action((options) => accountsCommand('list', [], options))

accountsCmd
  .command('add')
  .description('Add a new account (triggers OAuth login)')
  .action(() => accountsCommand('add', [], {}))

accountsCmd
  .command('switch <email>')
  .description('Switch to a different account')
  .action((email) => accountsCommand('switch', [email], {}))

accountsCmd
  .command('remove <email>')
  .description('Remove an account')
  .option('--force', 'Skip confirmation')
  .action((email, options) => accountsCommand('remove', [email], options))

accountsCmd
  .command('current')
  .description('Show current active account')
  .action(() => accountsCommand('current', [], {}))

accountsCmd
  .command('refresh [email]')
  .description('Refresh account tokens')
  .option('--all', 'Refresh all accounts')
  .action((email, options) => accountsCommand('refresh', email ? [email] : [], options))

// Default action for accounts command (show list)
accountsCmd.action(() => accountsCommand('list', [], {}))

// Doctor command
program
  .command('doctor')
  .description('Run diagnostics and show configuration')
  .action(doctorCommand)

// Wakeup command with subcommands
import { wakeupCommand } from './commands/wakeup.js'

const wakeupCmd = program
  .command('wakeup')
  .description('Auto wake-up and warm up AI models')

wakeupCmd
  .command('config')
  .description('Configure auto wake-up schedule')
  .action(() => wakeupCommand('config', [], {}))

wakeupCmd
  .command('trigger')
  .description('Execute one trigger cycle (called by cron)')
  .option('--scheduled', 'Mark as scheduled trigger')
  .action((options) => wakeupCommand('trigger', [], options))

wakeupCmd
  .command('install')
  .description('Install wake-up schedule to system cron')
  .action(() => wakeupCommand('install', [], {}))

wakeupCmd
  .command('uninstall')
  .description('Remove wake-up schedule from system cron')
  .action(() => wakeupCommand('uninstall', [], {}))

wakeupCmd
  .command('test')
  .description('Test trigger manually')
  .action(() => wakeupCommand('test', [], {}))

wakeupCmd
  .command('history')
  .description('View trigger history')
  .option('--limit <n>', 'Number of records to show', '10')
  .option('--json', 'Output as JSON')
  .action((options) => wakeupCommand('history', [], options))

wakeupCmd
  .command('status')
  .description('Show wake-up status and configuration')
  .action(() => wakeupCommand('status', [], {}))

// Default action for wakeup command (show status)
wakeupCmd.action(() => wakeupCommand('status', [], {}))

// Parse and run
program.parse()

