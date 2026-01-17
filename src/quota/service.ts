/**
 * Quota service - orchestrates fetching quota data
 */

import { debug } from '../core/logger.js'
import { getTokenManager } from '../google/token-manager.js'
import { CloudCodeClient, type FetchAvailableModelsResponse } from '../google/cloudcode.js'
import { parseQuotaSnapshot } from '../google/parser.js'
import { extractProjectId } from '../google/oauth.js'
import { 
  detectAntigravityProcess, 
  discoverPorts, 
  probeForConnectAPI, 
  ConnectClient, 
  parseLocalQuotaSnapshot 
} from '../local/index.js'
import { 
  AntigravityNotRunningError, 
  LocalConnectionError, 
  PortDetectionError,
  NoAuthMethodAvailableError
} from '../core/errors.js'
import type { QuotaSnapshot } from './types.js'

export type QuotaMethod = 'google' | 'local' | 'auto'

/**
 * Fetch quota using the specified method
 * @param method Method to use: 'auto' (default), 'google', or 'local'
 */
export async function fetchQuota(method: QuotaMethod = 'auto'): Promise<QuotaSnapshot> {
  if (method === 'auto') {
    try {
      debug('service', 'Auto mode: trying local method first')
      return await fetchQuotaLocal()
    } catch (err) {
      debug('service', 'Auto mode: local method failed', err)
      // Only fallback to Google if user is logged in
      const tokenManager = getTokenManager()
      if (tokenManager.isLoggedIn()) {
        debug('service', 'User is logged in, falling back to Google method')
        return fetchQuotaGoogle()
      }
      // User is not logged in and local failed - throw a helpful error
      throw new NoAuthMethodAvailableError()
    }
  }

  if (method === 'local') {
    return fetchQuotaLocal()
  }
  return fetchQuotaGoogle()
}

/**
 * Fetch quota from Google Cloud Code API
 */
async function fetchQuotaGoogle(): Promise<QuotaSnapshot> {
  debug('service', 'Fetching quota from Google')
  
  const tokenManager = getTokenManager()
  const email = tokenManager.getEmail()
  const client = new CloudCodeClient(tokenManager)
  
  // Fetch code assist (this one usually works)
  const codeAssistResponse = await client.loadCodeAssist()
  debug('service', 'Code assist response received', JSON.stringify(codeAssistResponse))
  
  // Save project ID to token storage for future use (for triggers, etc.)
  if (codeAssistResponse?.cloudaicompanionProject) {
    const projectId = extractProjectId(codeAssistResponse.cloudaicompanionProject)
    if (projectId) {
      tokenManager.setProjectId(projectId)
      debug('service', `Project ID saved: ${projectId}`)
    }
  }
  
  // Try to fetch models, but it might fail with 403
  let modelsResponse: FetchAvailableModelsResponse = {}
  try {
    modelsResponse = await client.fetchAvailableModels()
    debug('service', 'Models response received', JSON.stringify(modelsResponse))
  } catch (err) {
    debug('service', 'Failed to fetch models (might need different permissions)', err)
    // Continue without models - we'll still show prompt credits
  }
  
  // Parse into snapshot with email
  const snapshot = parseQuotaSnapshot(codeAssistResponse, modelsResponse, email)
  
  debug('service', 'Quota snapshot created')
  return snapshot
}

/**
 * Fetch quota from local Antigravity language server
 */
async function fetchQuotaLocal(): Promise<QuotaSnapshot> {
  debug('service', 'Fetching quota from local Antigravity server')
  
  // Step 1: Detect Antigravity process
  const processInfo = await detectAntigravityProcess()
  if (!processInfo) {
    throw new AntigravityNotRunningError()
  }
  
  debug('service', `Found Antigravity process: PID ${processInfo.pid}`)
  
  // Step 2: Discover all listening ports (to find the connect port, not extension_server_port)
  const ports = await discoverPorts(processInfo.pid)
  
  if (ports.length === 0) {
    throw new PortDetectionError()
  }
  
  debug('service', `Discovered ${ports.length} listening ports: ${ports.join(', ')}`)
  
  // Step 3: Probe ports to find Connect API (pass CSRF token for authentication)
  const probeResult = await probeForConnectAPI(ports, processInfo.csrfToken)
  if (!probeResult) {
    throw new LocalConnectionError('Could not find Antigravity Connect API on any port')
  }
  
  debug('service', `Found Connect API at ${probeResult.baseUrl}`)
  
  // Step 4: Connect to API and get user status
  const client = new ConnectClient(probeResult.baseUrl, processInfo.csrfToken)
  const userStatus = await client.getUserStatus()
  
  debug('service', 'User status received from local server')
  
  // Step 5: Parse into QuotaSnapshot
  const snapshot = parseLocalQuotaSnapshot(userStatus)
  
  debug('service', 'Local quota snapshot created')
  return snapshot
}
