/**
 * Port prober - probes ports to find the Connect API endpoint
 */

import https from 'https'
import http from 'http'
import { debug } from '../core/logger.js'

const CONNECT_RPC_PATH = '/exa.language_server_pb.LanguageServerService/GetUnleashData'
const VALID_CONNECT_STATUSES = new Set([200, 401])

export interface ProbeResult {
  baseUrl: string
  protocol: 'https' | 'http'
  port: number
}

/**
 * Probes ports to find a working Connect API endpoint
 * Tries HTTPS first (with self-signed cert handling), then HTTP
 * @param ports Array of port numbers to probe
 * @param csrfToken Optional CSRF token for authentication
 * @param timeout Timeout per probe in ms (default 500ms)
 * @returns ProbeResult with working endpoint, or null if none found
 */
export async function probeForConnectAPI(ports: number[], csrfToken?: string, timeout = 500): Promise<ProbeResult | null> {
  debug('port-prober', `Probing ${ports.length} ports: ${ports.join(', ')}`)
  
  // Probe all ports concurrently
  const probePromises = ports.map(port => probePort(port, csrfToken, timeout))
  const results = await Promise.allSettled(probePromises)
  
  // Find first successful probe
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'fulfilled' && result.value) {
      debug('port-prober', `Found working endpoint: ${result.value.baseUrl}`)
      return result.value
    }
  }
  
  debug('port-prober', 'No working Connect API endpoint found')
  return null
}

/**
 * Probe a single port for Connect API
 * Tries HTTPS first, then HTTP
 */
async function probePort(port: number, csrfToken?: string, timeout = 500): Promise<ProbeResult | null> {
  // Try HTTPS first (language server typically uses self-signed certs)
  const httpsResult = await probeHttps(port, timeout, csrfToken)
  if (httpsResult) {
    return httpsResult
  }
  
  // Fallback to HTTP
  const httpResult = await probeHttp(port, timeout, csrfToken)
  if (httpResult) {
    return httpResult
  }
  
  return null
}

/**
 * Probe a port with HTTPS (allowing self-signed certificates)
 * Uses Connect RPC GetUnleashData endpoint to verify it's the correct port
 */
function probeHttps(port: number, timeout: number, csrfToken?: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: CONNECT_RPC_PATH,
      method: 'POST',
      timeout,
      rejectUnauthorized: false, // Allow self-signed certificates
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        ...(csrfToken ? { 'X-Codeium-Csrf-Token': csrfToken } : {})
      }
    }
    
    const req = https.request(options, (res) => {
      if (res.statusCode && VALID_CONNECT_STATUSES.has(res.statusCode)) {
        debug('port-prober', `HTTPS Connect RPC probe on port ${port}: status ${res.statusCode} - valid connect port`)
        resolve({
          baseUrl: `https://127.0.0.1:${port}`,
          protocol: 'https',
          port
        })
      } else {
        debug('port-prober', `HTTPS probe on port ${port}: status ${res.statusCode} - not connect port`)
        resolve(null)
      }
      
      // Consume response data to free up memory
      res.resume()
    })
    
    req.on('error', (err) => {
      debug('port-prober', `HTTPS probe on port ${port} failed: ${err.message}`)
      resolve(null)
    })
    
    req.on('timeout', () => {
      debug('port-prober', `HTTPS probe on port ${port} timed out`)
      req.destroy()
      resolve(null)
    })
    
    // Send the Connect RPC request body
    req.write(JSON.stringify({ wrapper_data: {} }))
    req.end()
  })
}

/**
 * Probe a port with HTTP
 */
function probeHttp(port: number, timeout: number, csrfToken?: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: CONNECT_RPC_PATH,
      method: 'POST',
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        ...(csrfToken ? { 'X-Codeium-Csrf-Token': csrfToken } : {})
      }
    }
    
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk.toString()
      })

      res.on('end', () => {
        if (
          data.toLowerCase().includes('client sent an http request to an https server')
        ) {
          debug('port-prober', `HTTP probe on port ${port}: protocol mismatch response, rejecting`)
          resolve(null)
          return
        }

        if (res.statusCode && VALID_CONNECT_STATUSES.has(res.statusCode)) {
          debug('port-prober', `HTTP Connect RPC probe on port ${port}: status ${res.statusCode} - valid connect port`)
          resolve({
            baseUrl: `http://127.0.0.1:${port}`,
            protocol: 'http',
            port
          })
          return
        }

        debug('port-prober', `HTTP probe on port ${port}: status ${res.statusCode} - not connect port`)
        resolve(null)
      })
    })
    
    req.on('error', (err) => {
      debug('port-prober', `HTTP probe on port ${port} failed: ${err.message}`)
      resolve(null)
    })
    
    req.on('timeout', () => {
      debug('port-prober', `HTTP probe on port ${port} timed out`)
      req.destroy()
      resolve(null)
    })
    
    req.write(JSON.stringify({ wrapper_data: {} }))
    req.end()
  })
}
