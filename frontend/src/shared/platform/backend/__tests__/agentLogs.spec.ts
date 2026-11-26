/**
 * agent 日志适配器单测（Task 10）。
 *
 * 锁定：
 * - `GET /logs` 清单形状归一（缺字段回退空数组）；
 * - `read` 走 `text/plain`（`text: true`），名称逐段编码但保留 `/`（`core/<id>/<file>`），
 *   `tail` 作为查询参数传给服务端而不是本地截断；
 * - `clear` 为 `DELETE /logs`，204 解析为 undefined；
 * - 401 / 400 等错误原样抛出，401 触发全局会话失效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentLogs } from '@/shared/platform/backend/agent/logs'
import { onUnauthorized } from '@/shared/platform/backend/http'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const textResponse = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

describe('agentLogs', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    disposeUnauthorized?.()
    disposeUnauthorized = null
    vi.unstubAllGlobals()
  })

  it('list：GET /api/v1/logs，agent 与 core 分组原样归一', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        agent: [
          { name: 'agent.log', size: 1024, modifiedAt: 1_700_000_000 },
          { name: 'audit.log', size: 128, modifiedAt: 1_700_000_100 }
        ],
        core: [
          {
            id: 'home',
            files: [{ name: 'kernel.log', size: 4096, modifiedAt: 1_700_000_200 }]
          }
        ]
      })
    )

    const list = await agentLogs.list()

    expect(list.agent.map((file) => file.name)).toEqual(['agent.log', 'audit.log'])
    expect(list.core).toEqual([
      { id: 'home', files: [{ name: 'kernel.log', size: 4096, modifiedAt: 1_700_000_200 }] }
    ])

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/logs')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('list：空响应体时返回空清单而不是抛错', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    await expect(agentLogs.list()).resolves.toEqual({ agent: [], core: [] })
  })

  it('read：GET /api/v1/logs/{name}?tail=N，按纯文本读取', async () => {
    fetchMock.mockResolvedValue(textResponse(200, 'line1\nline2\n'))

    const text = await agentLogs.read('agent.log', 200)

    expect(text).toBe('line1\nline2\n')
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/logs/agent.log?tail=200')
    expect(init.method).toBe('GET')
  })

  it('read：内核日志名保留 / 分隔且逐段编码', async () => {
    fetchMock.mockResolvedValue(textResponse(200, 'kernel output'))

    await agentLogs.read('core/home/kernel.log')

    const [url] = lastCall()
    expect(url).toBe('/api/v1/logs/core/home/kernel.log')
  })

  it('read：id 含特殊字符时逐段编码，斜杠不被转义', async () => {
    fetchMock.mockResolvedValue(textResponse(200, ''))

    await agentLogs.read('core/a b/kernel.log', 10)

    const [url] = lastCall()
    expect(url).toBe('/api/v1/logs/core/a%20b/kernel.log?tail=10')
  })

  it('read：未传 tail 时不带查询参数（服务端按 400 行默认）', async () => {
    fetchMock.mockResolvedValue(textResponse(200, 'x'))

    await agentLogs.read('audit.log')

    const [url] = lastCall()
    expect(url).toBe('/api/v1/logs/audit.log')
  })

  it('read：非法名称的 400 invalid_id 原样抛出', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: 'invalid_id', message: 'invalid identifier' } })
    )

    await expect(agentLogs.read('../state/auth.json')).rejects.toMatchObject({
      code: 'invalid_id',
      status: 400
    })
  })

  it('read：401 触发全局会话失效（日志端点不做 silentAuth）', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_required', message: 'login required' } })
    )

    await expect(agentLogs.read('agent.log')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('clear：DELETE /api/v1/logs，204 解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentLogs.clear()).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/logs')
    expect(init.method).toBe('DELETE')
  })
})
