import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectAntigravityProcess } from '../../src/local/process-detector.js'
import * as child_process from 'child_process'

// Mock child_process exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

describe('process-detector', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('detectAntigravityProcess', () => {
    it('should extract info from Unix process list', async () => {
      // Mock platform to be linux or darwin
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })
      
      const mockStdout = `
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
user      1001  0.0  0.0   1234   567 ?        S    10:00   0:00 /usr/bin/some-process
user      1234  1.0  2.0 555555 11111 ?        Sl   10:01   0:10 /path/to/antigravity --language-server --csrf_token=abc123token --extension_server_port=42001
user      9999  0.0  0.0   1111   222 ?        S    10:02   0:00 grep antigravity
`
      
      const mockExec = vi.mocked(child_process.exec)
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        if (cmd === 'ps aux') {
          callback(null, { stdout: mockStdout, stderr: '' })
        } else {
          callback(new Error('Unknown command'), null)
        }
      }) as any)
      
      const result = await detectAntigravityProcess()
      
      expect(result).toEqual({
        pid: 1234,
        csrfToken: 'abc123token',
        extensionServerPort: 42001,
        commandLine: '/path/to/antigravity --language-server --csrf_token=abc123token --extension_server_port=42001'
      })
      
      // Restore platform
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should handle missing arguments', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      
      const mockStdout = `
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
user      5678  1.0  2.0 555555 11111 ?        Sl   10:01   0:10 /path/to/antigravity --language-server
`
      
      const mockExec = vi.mocked(child_process.exec)
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: mockStdout, stderr: '' })
      }) as any)
      
      const result = await detectAntigravityProcess()
      
      expect(result).toEqual({
        pid: 5678,
        csrfToken: undefined,
        extensionServerPort: undefined,
        commandLine: '/path/to/antigravity --language-server'
      })
      
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should return null if no process found', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })
      
      const mockStdout = `
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
user      1001  0.0  0.0   1234   567 ?        S    10:00   0:00 /usr/bin/some-process
`
      
      const mockExec = vi.mocked(child_process.exec)
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: mockStdout, stderr: '' })
      }) as any)
      
      const result = await detectAntigravityProcess()
      
      expect(result).toBeNull()
      
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should handle Windows output (WMIC)', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      
      const mockStdout = `
Node,CommandLine,ProcessId
WIN-PC,"C:\\Program Files\\Antigravity\\antigravity.exe" --language-server --csrf_token "win-token" --extension_server_port 55555,2468
`
      
      const mockExec = vi.mocked(child_process.exec)
      mockExec.mockImplementation(((cmd: string, options: any, callback: any) => {
        // Handle varying signatures of exec
        const cb = typeof options === 'function' ? options : callback
        
        if (typeof cmd === 'string' && cmd.includes('wmic')) {
          cb(null, { stdout: mockStdout, stderr: '' })
        } else {
          cb(new Error('Command failed'), null)
        }
      }) as any)
      
      const result = await detectAntigravityProcess()
      
      expect(result).toEqual({
        pid: 2468,
        csrfToken: 'win-token',
        extensionServerPort: 55555,
        commandLine: '"C:\\Program Files\\Antigravity\\antigravity.exe" --language-server --csrf_token "win-token" --extension_server_port 55555'
      })
      
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should prefer Windows language server process when multiple antigravity candidates exist', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })

      const mockStdout = `
Node,CommandLine,ProcessId
WIN-PC,"C:\\Program Files\\Antigravity\\Antigravity.exe",1111
WIN-PC,"C:\\Users\\mrw-l\\.antigravity\\language_server_windows_x64.exe --csrf_token token-2 --extension_server_port 60479",2222
`

      const mockExec = vi.mocked(child_process.exec)
      mockExec.mockImplementation(((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback
        if (typeof cmd === 'string' && cmd.includes('wmic')) {
          cb(null, { stdout: mockStdout, stderr: '' })
        } else {
          cb(new Error('Command failed'), null)
        }
      }) as any)

      const result = await detectAntigravityProcess()

      expect(result).toEqual({
        pid: 2222,
        csrfToken: 'token-2',
        extensionServerPort: 60479,
        commandLine: '"C:\\Users\\mrw-l\\.antigravity\\language_server_windows_x64.exe --csrf_token token-2 --extension_server_port 60479"'
      })

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })
})
