/**
 * Process detector - finds running Antigravity language server processes
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { debug } from '../core/logger.js'

const execAsync = promisify(exec)

export interface AntigravityProcessInfo {
  pid: number
  csrfToken?: string
  extensionServerPort?: number
  commandLine: string
}

/**
 * Detects running Antigravity language server processes
 * Returns process info including PID and extracted command-line arguments
 */
export async function detectAntigravityProcess(): Promise<AntigravityProcessInfo | null> {
  const platform = process.platform
  
  debug('process-detector', `Detecting Antigravity process on platform: ${platform}`)
  
  if (platform === 'win32') {
    return detectOnWindows()
  } else {
    // macOS and Linux use similar commands
    return detectOnUnix()
  }
}

/**
 * Detect Antigravity process on Unix-like systems (macOS, Linux)
 */
async function detectOnUnix(): Promise<AntigravityProcessInfo | null> {
  try {
    // Use ps to list all processes with full command line
    // Look for processes containing 'antigravity' in their command
    const { stdout } = await execAsync('ps aux')
    
    const lines = stdout.split('\n')
    
    for (const line of lines) {
      const lower = line.toLowerCase()
      if (!lower.includes('antigravity')) {
        continue
      }

      // Ignore remote server install scripts that contain broad "server" terms
      // but are not the language server process.
      if (lower.includes('server installation script')) {
        continue
      }

      const hasServerSignal =
        line.includes('language-server') ||
        line.includes('lsp') ||
        line.includes('--csrf_token') ||
        line.includes('--extension_server_port') ||
        line.includes('exa.language_server_pb')

      if (!hasServerSignal) {
        continue
      }

      debug('process-detector', `Found potential Antigravity process: ${line}`)

      const processInfo = parseUnixProcessLine(line)
      if (processInfo) {
        return processInfo
      }
    }
    
    debug('process-detector', 'No Antigravity process found')
    return null
  } catch (err) {
    debug('process-detector', 'Error detecting process on Unix', err)
    return null
  }
}

/**
 * Parse a Unix ps output line to extract process info
 */
function parseUnixProcessLine(line: string): AntigravityProcessInfo | null {
  // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
  const parts = line.trim().split(/\s+/)
  
  if (parts.length < 11) {
    return null
  }
  
  const pid = parseInt(parts[1], 10)
  if (isNaN(pid)) {
    return null
  }
  
  // Command is everything from index 10 onwards
  const commandLine = parts.slice(10).join(' ')
  
  // Extract arguments from command line
  const csrfToken = extractArgument(commandLine, '--csrf_token')
  const extensionServerPort = extractArgument(commandLine, '--extension_server_port')
  
  return {
    pid,
    csrfToken: csrfToken || undefined,
    extensionServerPort: extensionServerPort ? parseInt(extensionServerPort, 10) : undefined,
    commandLine
  }
}

/**
 * Detect Antigravity process on Windows
 */
async function detectOnWindows(): Promise<AntigravityProcessInfo | null> {
  try {
    // Use WMIC to get process details with command line
    const { stdout } = await execAsync(
      'wmic process where "name like \'%antigravity%\' or commandline like \'%antigravity%\'" get processid,commandline /format:csv',
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for long command lines
    )
    
    const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('Node,CommandLine,ProcessId'))
    const candidates: AntigravityProcessInfo[] = []

    for (const line of lines) {
      // CSV format: Node,CommandLine,ProcessId
      const parts = line.split(',')
      if (parts.length >= 3) {
        const commandLine = parts.slice(1, -1).join(',') // Command line might contain commas
        const pid = parseInt(parts[parts.length - 1].trim(), 10)
        
        if (!isNaN(pid) && commandLine.toLowerCase().includes('antigravity')) {
          candidates.push({
            pid,
            csrfToken: extractArgument(commandLine, '--csrf_token') || undefined,
            extensionServerPort: parsePortValue(extractArgument(commandLine, '--extension_server_port')),
            commandLine
          })
        }
      }
    }

    const selected = selectBestWindowsCandidate(candidates)
    if (selected) {
      debug('process-detector', `Selected Antigravity process on Windows: PID ${selected.pid}`)
      return selected
    }
    
    // Fallback: try PowerShell if WMIC doesn't work
    return await detectOnWindowsPowerShell()
  } catch (err) {
    debug('process-detector', 'Error detecting process on Windows with WMIC, trying PowerShell', err)
    return await detectOnWindowsPowerShell()
  }
}

/**
 * Fallback Windows detection using PowerShell
 */
async function detectOnWindowsPowerShell(): Promise<AntigravityProcessInfo | null> {
  try {
    const { stdout } = await execAsync(
      'powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*antigravity*\' } | Select-Object Id, ProcessName | ConvertTo-Json"'
    )
    
    if (!stdout.trim()) {
      return null
    }
    
    const processes = JSON.parse(stdout)
    const processList = Array.isArray(processes) ? processes : [processes]
    
    const candidates: AntigravityProcessInfo[] = []

    for (const proc of processList) {
      if (proc.Id) {
        // Get command line for this process
        const { stdout: cmdLine } = await execAsync(
          `powershell -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId = ${proc.Id}').CommandLine"`
        )
        
        const commandLine = cmdLine.trim()
        if (!commandLine.toLowerCase().includes('antigravity')) {
          continue
        }

        candidates.push({
          pid: proc.Id,
          csrfToken: extractArgument(commandLine, '--csrf_token') || undefined,
          extensionServerPort: parsePortValue(extractArgument(commandLine, '--extension_server_port')),
          commandLine
        })
      }
    }

    const selected = selectBestWindowsCandidate(candidates)
    if (selected) {
      debug('process-detector', `Selected Antigravity process on Windows (PowerShell): PID ${selected.pid}`)
      return selected
    }

    return null
  } catch (err) {
    debug('process-detector', 'Error detecting process on Windows with PowerShell', err)
    return null
  }
}

function parsePortValue(rawPort: string | null): number | undefined {
  if (!rawPort) {
    return undefined
  }
  const parsed = parseInt(rawPort, 10)
  return isNaN(parsed) ? undefined : parsed
}

function scoreWindowsCandidate(candidate: AntigravityProcessInfo): number {
  const lower = candidate.commandLine.toLowerCase()

  let score = 0
  if (lower.includes('antigravity')) score += 1
  if (lower.includes('lsp')) score += 5
  if (candidate.extensionServerPort) score += 10
  if (candidate.csrfToken) score += 20
  if (
    lower.includes('language_server') ||
    lower.includes('language-server') ||
    lower.includes('exa.language_server_pb')
  ) {
    score += 50
  }

  return score
}

function selectBestWindowsCandidate(candidates: AntigravityProcessInfo[]): AntigravityProcessInfo | null {
  if (candidates.length === 0) {
    return null
  }

  debug('process-detector', `Found ${candidates.length} Antigravity candidate process(es) on Windows`)

  let best: AntigravityProcessInfo | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    const score = scoreWindowsCandidate(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  if (best) {
    debug('process-detector', `Selected PID ${best.pid} with score ${bestScore}`)
  }

  return best
}

/**
 * Extract argument value from command line
 * Supports formats: --arg=value and --arg value
 */
function extractArgument(commandLine: string, argName: string): string | null {
  // Try --arg=value format
  const eqRegex = new RegExp(`${argName}=([^\\s"']+|"[^"]*"|'[^']*')`, 'i')
  const eqMatch = commandLine.match(eqRegex)
  if (eqMatch) {
    return eqMatch[1].replace(/^["']|["']$/g, '') // Remove quotes
  }
  
  // Try --arg value format
  const spaceRegex = new RegExp(`${argName}\\s+([^\\s"']+|"[^"]*"|'[^']*')`, 'i')
  const spaceMatch = commandLine.match(spaceRegex)
  if (spaceMatch) {
    return spaceMatch[1].replace(/^["']|["']$/g, '') // Remove quotes
  }
  
  return null
}
