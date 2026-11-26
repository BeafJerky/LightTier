/**
 * agent Web 配置适配器单测：端点 / 方法 / 请求体形状 / 路径编码与错误透传。
 *
 * 与 agentConfigs.spec 同一策略：走真实 http 客户端，只替换全局 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentWeb } from '@/shared/platform/backend/agent/web'
import { ApiError } from '@/shared/platform/backend/http'
import type { FormWebData } from '@/entities/config/formTypes'

const fetchMock = vi.fn()

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

const item = (overrides: Partial<FormWebData> = {}): FormWebData => ({
  protocol: 'udp',
  host: '192.168.1.10',
  port: 11010,
  userName: 'octet',
  webStartMethod: 2,
  configFileName: 'office',
  webUrl: '',
  ...overrides
})

describe('agentWeb', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list：GET /api/v1/web-configs，取出 items 并保留服务端 status/pid', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [{ ...item(), status: 'running', pid: 4242 }] })
    )

    await expect(agentWeb.list()).resolves.toEqual([{ ...item(), status: 'running', pid: 4242 }])

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/web-configs')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('list：空响应体时返回空列表而不是抛错', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    await expect(agentWeb.list()).resolves.toEqual([])
  })

  it('replace：PUT 整表 {items}，返回服务端新表', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [{ ...item(), status: 'notRunning', pid: null }] })
    )

    await expect(agentWeb.replace([item()])).resolves.toEqual([
      { ...item(), status: 'notRunning', pid: null }
    ])

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/web-configs')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ items: [item()] })
  })

  it('replace：409 config_exists 原样抛出 ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'config_exists', message: 'duplicate name' } })
    )

    await expect(agentWeb.replace([item(), item()])).rejects.toMatchObject({
      name: 'ApiError',
      code: 'config_exists',
      status: 409
    })
  })

  it('start：POST /{configFileName}/start，路径参数做百分号编码且解析 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentWeb.start('office 1')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/web-configs/office%201/start')
    expect(init.method).toBe('POST')
  })

  it('stop：POST /{configFileName}/stop，路径参数做百分号编码', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentWeb.stop('office 1')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/web-configs/office%201/stop')
    expect(init.method).toBe('POST')
  })

  it('start：409 core_missing 抛 ApiError，页面按通用失败文案提示', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'core_missing', message: 'kernel not installed' } })
    )

    await expect(agentWeb.start('office')).rejects.toMatchObject({
      code: 'core_missing',
      status: 409
    })
  })

  it('stop：404 not_found 抛 ApiError 实例', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'not_found', message: 'not found' } })
    )

    const error = await agentWeb.stop('gone').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'not_found', status: 404 })
  })
})
