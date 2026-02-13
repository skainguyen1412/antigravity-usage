import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchQuota } from '../../src/quota/service.js'
import * as localModule from '../../src/local/index.js'
import * as tokenManagerModule from '../../src/google/token-manager.js'
import * as cloudCodeModule from '../../src/google/cloudcode.js'
import * as parserModule from '../../src/google/parser.js'

// Mock dependencies
vi.mock('../../src/local/index.js')
vi.mock('../../src/google/token-manager.js')
vi.mock('../../src/google/cloudcode.js')
vi.mock('../../src/google/parser.js')

describe('quota service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    
    // Default mocks with required methods
    vi.mocked(tokenManagerModule.getTokenManager).mockReturnValue({
      getEmail: vi.fn().mockReturnValue('test@example.com'),
      isLoggedIn: vi.fn().mockReturnValue(true),
      getValidAccessToken: vi.fn().mockResolvedValue('mock-token')
    } as any)
    vi.mocked(cloudCodeModule.CloudCodeClient).mockImplementation(() => ({
      loadCodeAssist: vi.fn(),
      fetchAvailableModels: vi.fn()
    }) as any)
  })

  describe('fetchQuota', () => {
    it('should use google method when specified', async () => {
      vi.mocked(parserModule.parseQuotaSnapshot).mockReturnValue({ 
        method: 'google', 
        timestamp: '', 
        models: [] 
      } as any)

      const result = await fetchQuota('google')

      expect(cloudCodeModule.CloudCodeClient).toHaveBeenCalled()
      expect(localModule.detectAntigravityProcess).not.toHaveBeenCalled()
      expect(result.method).toBe('google')
    })

    it('should use local method when specified', async () => {
      vi.mocked(localModule.detectAntigravityProcess).mockResolvedValue({
        pid: 123,
        commandLine: ''
      })
      vi.mocked(localModule.discoverPorts).mockResolvedValue([1234])
      vi.mocked(localModule.probeForConnectAPI).mockResolvedValue({
        baseUrl: 'http://localhost:1234',
        protocol: 'http',
        port: 1234
      })
      vi.mocked(localModule.ConnectClient).mockImplementation(() => ({
        getUserStatus: vi.fn().mockResolvedValue({})
      }) as any)
      vi.mocked(localModule.parseLocalQuotaSnapshot).mockReturnValue({
        method: 'local',
        timestamp: '',
        models: []
      } as any)

      const result = await fetchQuota('local')

      expect(localModule.detectAntigravityProcess).toHaveBeenCalled()
      expect(cloudCodeModule.CloudCodeClient).not.toHaveBeenCalled()
      expect(result.method).toBe('local')
    })

    it('should default to auto (try local first)', async () => {
      // Setup successful local
      vi.mocked(localModule.detectAntigravityProcess).mockResolvedValue({
        pid: 123,
        commandLine: ''
      })
      vi.mocked(localModule.discoverPorts).mockResolvedValue([1234])
      vi.mocked(localModule.probeForConnectAPI).mockResolvedValue({
        baseUrl: 'http://localhost:1234',
        protocol: 'http',
        port: 1234
      })
      vi.mocked(localModule.ConnectClient).mockImplementation(() => ({
        getUserStatus: vi.fn().mockResolvedValue({})
      }) as any)
      vi.mocked(localModule.parseLocalQuotaSnapshot).mockReturnValue({
        method: 'local',
        timestamp: '',
        models: []
      } as any)

      const result = await fetchQuota() // default is auto

      expect(localModule.detectAntigravityProcess).toHaveBeenCalled()
      expect(cloudCodeModule.CloudCodeClient).not.toHaveBeenCalled()
      expect(result.method).toBe('local')
    })

    it('should fallback to google if local fails in auto mode and user is logged in', async () => {
      // Setup failing local
      vi.mocked(localModule.detectAntigravityProcess).mockResolvedValue(null)
      
      // Ensure user is logged in for fallback to work
      vi.mocked(tokenManagerModule.getTokenManager).mockReturnValue({
        getEmail: vi.fn().mockReturnValue('test@example.com'),
        isLoggedIn: vi.fn().mockReturnValue(true),
        getValidAccessToken: vi.fn().mockResolvedValue('mock-token')
      } as any)
      
      // Setup successful google
      vi.mocked(parserModule.parseQuotaSnapshot).mockReturnValue({ 
        method: 'google', 
        timestamp: '', 
        models: [] 
      } as any)

      const result = await fetchQuota('auto')

      expect(localModule.detectAntigravityProcess).toHaveBeenCalled()
      expect(cloudCodeModule.CloudCodeClient).toHaveBeenCalled()
      expect(result.method).toBe('google')
    })

    it('should fallback to extension_server_port when discoverPorts returns empty', async () => {
      vi.mocked(localModule.detectAntigravityProcess).mockResolvedValue({
        pid: 123,
        extensionServerPort: 60479,
        commandLine: ''
      })
      vi.mocked(localModule.discoverPorts).mockResolvedValue([])
      vi.mocked(localModule.probeForConnectAPI).mockResolvedValue({
        baseUrl: 'https://127.0.0.1:60479',
        protocol: 'https',
        port: 60479
      })
      vi.mocked(localModule.ConnectClient).mockImplementation(() => ({
        getUserStatus: vi.fn().mockResolvedValue({})
      }) as any)
      vi.mocked(localModule.parseLocalQuotaSnapshot).mockReturnValue({
        method: 'local',
        timestamp: '',
        models: []
      } as any)

      const result = await fetchQuota('local')

      expect(localModule.probeForConnectAPI).toHaveBeenCalledWith([60479], undefined)
      expect(result.method).toBe('local')
    })
  })
})
