/**
 * agent 运行态 / 实例启停适配器单测（Task 9）。
 *
 * 用 M2 真实响应样例锁定：
 * - `GET /instances` → `RuntimeSnapshot` 同形对象（运行中实例、缺省 pid、catalog）；
 * - monitor 两侧 `{stale,data,error}` 包装、失败回填上一份数据、无历史时给空 stale；
 * - 401 继续触发全局会话失效回调；
 * - runner 的 URL / 方法 / 请求体与错误码原样透传。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentRuntime, __resetAgentRuntimeState } from '@/shared/platform/backend/agent/runtime'
import { agentRunner } from '@/shared/platform/backend/agent/runner'
import { ApiError, isApiError, onUnauthorized } from '@/shared/platform/backend/http'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

describe('agentRuntime', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    __resetAgentRuntimeState()
  })

  afterEach(() => {
    disposeUnauthorized?.()
    disposeUnauthorized = null
    vi.unstubAllGlobals()
  })

  it('instances：只投影运行中实例，catalog 含运行中与已停止配置', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        instances: [
          {
            id: 'home',
            running: true,
            pid: 4242,
            startedAt: 1_700_000_000,
            rpcPortal: '127.0.0.1:15888'
          },
          { id: 'office', running: false, startedAt: null, rpcPortal: null },
          // 缺 pid（启动中 / Android 风格）按 0 处理
          { id: 'lonely', running: true }
        ],
        catalog: ['home', 'office', 'lonely']
      })
    )

    const snapshot = await agentRuntime.instances()

    expect(snapshot.catalog).toEqual(['home', 'office', 'lonely'])
    expect(snapshot.instances).toEqual([
      {
        configFileName: 'home',
        fileName: 'home.toml',
        pid: 4242,
        rpcPortal: '127.0.0.1:15888',
        instanceId: 'home'
      },
      {
        configFileName: 'lonely',
        fileName: 'lonely.toml',
        pid: 0,
        rpcPortal: undefined,
        instanceId: 'lonely'
      }
    ])
    expect(snapshot.revision).toBeGreaterThan(0)
    expect(typeof snapshot.updatedAt).toBe('number')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/instances')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('instances：空响应时给出空快照，catalog 回退到实例 id', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    const snapshot = await agentRuntime.instances()

    expect(snapshot.instances).toEqual([])
    expect(snapshot.catalog).toEqual([])
  })

  it('instances：revision 单调递增', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { instances: [], catalog: ['only'] })
    )

    const first = await agentRuntime.instances()
    const second = await agentRuntime.instances()

    expect(second.revision).toBeGreaterThan(first.revision)
    expect(second.catalog).toEqual(['only'])
  })

  it('monitor：包装两侧监控值，URL 编码实例 id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        node: { stale: false, data: { hostname: 'nas' } },
        peers: { stale: false, data: [{ hostname: 'peer-a' }] }
      })
    )

    const result = await agentRuntime.monitor('a b')

    expect(result.node).toEqual({ stale: false, data: { hostname: 'nas' }, error: null })
    expect(result.peers).toEqual({
      stale: false,
      data: [{ hostname: 'peer-a' }],
      error: null
    })
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/instances/a%20b/monitor')
    expect(init.method).toBe('GET')
  })

  it('monitor：轮询失败时回填上一份成功数据并标记 stale', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        node: { stale: false, data: { hostname: 'nas' } },
        peers: { stale: false, data: [{ hostname: 'peer-a' }] }
      })
    )
    await agentRuntime.monitor('home')

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await agentRuntime.monitor('home')

    expect(result.node).toMatchObject({
      stale: true,
      data: { hostname: 'nas' },
      error: 'network down'
    })
    expect(result.peers).toMatchObject({
      stale: true,
      data: [{ hostname: 'peer-a' }],
      error: 'network down'
    })
  })

  it('monitor：无历史数据时返回空 stale 形状而不是抛错', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'instance_not_running', message: 'instance is not running' }
      })
    )

    const result = await agentRuntime.monitor('home')

    expect(result.node).toEqual({ stale: true, data: null, error: 'instance is not running' })
    expect(result.peers).toEqual({ stale: true, data: null, error: 'instance is not running' })
  })

  it('monitor：服务端 stale 原样传递（CLI 超时回填快照）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        node: { stale: true, data: { hostname: 'nas' }, error: 'cli_timeout' },
        peers: { stale: true, data: [], error: 'cli_timeout' }
      })
    )

    const result = await agentRuntime.monitor('home')

    expect(result.node.stale).toBe(true)
    expect(result.node.error).toBe('cli_timeout')
    expect(result.peers.stale).toBe(true)
  })

  it('monitor：401 原样抛出并触发全局会话失效', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_required', message: 'login required' } })
    )

    const error = await agentRuntime.monitor('home').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('agentRunner', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['start', 'stop', 'restart'] as const)(
    '%s：POST /instances/{id}/%s，无请求体',
    async (verb) => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'home', running: verb !== 'stop' }))

      await agentRunner[verb]('home')

      const [url, init] = lastCall()
      expect(url).toBe(`/api/v1/instances/home/${verb}`)
      expect(init.method).toBe('POST')
      expect(init.body).toBeUndefined()
    }
  )

  it('id 做 URL 编码', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'a b', running: true }))

    await agentRunner.start('a b')

    expect(lastCall()[0]).toBe('/api/v1/instances/a%20b/start')
  })

  it('错误码原样透传（port_in_use 带 params）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: 'port_in_use',
          message: 'port 11000 is already used by office',
          params: { port: 11000, owner: 'office' }
        }
      })
    )

    await expect(agentRunner.start('home')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'port_in_use',
      status: 409,
      params: { port: 11000, owner: 'office' }
    })
  })
})
