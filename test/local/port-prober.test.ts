import { describe, it, expect, vi, beforeEach } from 'vitest'
import { probeForConnectAPI } from '../../src/local/port-prober.js'
import * as https from 'https'
import * as http from 'http'
import { EventEmitter } from 'events'

vi.mock('http')
vi.mock('https')

type MockPlan = {
  statusCode?: number
  error?: Error
  body?: string
}

function applyModulePlan(module: { request: any }, plansByPort: Record<number, MockPlan>) {
  module.request.mockImplementation((options: any, callback: any) => {
    const req = new EventEmitter() as any
    req.end = vi.fn()
    req.write = vi.fn()
    req.destroy = vi.fn()

    const port = Number(options.port)
    const plan = plansByPort[port] || { error: new Error('Connection refused') }

    setTimeout(() => {
      if (plan.error) {
        req.emit('error', plan.error)
        return
      }

      const res = new EventEmitter() as any
      res.statusCode = plan.statusCode
      res.resume = vi.fn()
      callback(res)
      if (plan.body) {
        res.emit('data', Buffer.from(plan.body))
      }
      res.emit('end')
    }, 0)

    return req
  })
}

describe('port-prober', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('accepts HTTPS Connect endpoint on 200', async () => {
    applyModulePlan(https as any, { 42001: { statusCode: 200 } })
    applyModulePlan(http as any, { 42001: { error: new Error('unused') } })

    const result = await probeForConnectAPI([42001])

    expect(result).toEqual({
      baseUrl: 'https://127.0.0.1:42001',
      protocol: 'https',
      port: 42001
    })
  })

  it('accepts HTTPS Connect endpoint on 401 (auth required signal)', async () => {
    applyModulePlan(https as any, { 42002: { statusCode: 401 } })
    applyModulePlan(http as any, { 42002: { error: new Error('unused') } })

    const result = await probeForConnectAPI([42002])

    expect(result).toEqual({
      baseUrl: 'https://127.0.0.1:42002',
      protocol: 'https',
      port: 42002
    })
  })

  it('falls back to HTTP Connect endpoint when HTTPS probe fails', async () => {
    applyModulePlan(https as any, { 42003: { error: new Error('SSL error') } })
    applyModulePlan(http as any, { 42003: { statusCode: 200 } })

    const result = await probeForConnectAPI([42003])

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:42003',
      protocol: 'http',
      port: 42003
    })
  })

  it('rejects HTTP mismatch response from HTTPS-only endpoint', async () => {
    applyModulePlan(https as any, { 42004: { error: new Error('SSL error') } })
    applyModulePlan(http as any, {
      42004: {
        statusCode: 400,
        body: 'Client sent an HTTP request to an HTTPS server.'
      }
    })

    const result = await probeForConnectAPI([42004])
    expect(result).toBeNull()
  })

  it('rejects non-connect status codes', async () => {
    applyModulePlan(https as any, { 42005: { statusCode: 404 } })
    applyModulePlan(http as any, { 42005: { statusCode: 404 } })

    const result = await probeForConnectAPI([42005])
    expect(result).toBeNull()
  })

  it('tries multiple ports and returns first valid Connect endpoint', async () => {
    applyModulePlan(https as any, {
      3001: { error: new Error('refused') },
      3002: { error: new Error('refused') },
      3003: { statusCode: 200 }
    })
    applyModulePlan(http as any, {
      3001: { statusCode: 404 },
      3002: { statusCode: 404 },
      3003: { error: new Error('unused') }
    })

    const result = await probeForConnectAPI([3001, 3002, 3003])

    expect(result).toEqual({
      baseUrl: 'https://127.0.0.1:3003',
      protocol: 'https',
      port: 3003
    })
  })
})
