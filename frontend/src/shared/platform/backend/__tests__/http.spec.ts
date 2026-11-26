/**
 * agent HTTP 客户端单测。
 *
 * 覆盖：204 空响应、JSON 错误映射为 ApiError、401/428 回调、
 * 超时/中断错误原样透传（不包装成 ApiError）、请求形状与纯文本响应。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  isApiError,
  onSetupRequired,
  onUnauthorized,
  request
} from '@/shared/platform/backend/http'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null
let disposeSetupRequired: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('request', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    disposeUnauthorized?.()
    disposeSetupRequired?.()
    disposeUnauthorized = null
    disposeSetupRequired = null
    vi.unstubAllGlobals()
  })

  it('204 解析为 undefined 且不触发鉴权回调', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(request('/api/v1/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('非 2xx 按 {error:{code,message}} 抛出 ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'conflict_hash', message: 'config changed' } })
    )

    const error = await request('/api/v1/configs/home', { method: 'PUT' }).catch((e: unknown) => e)
    expect(isApiError(error)).toBe(true)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('conflict_hash')
    expect((error as ApiError).message).toBe('config changed')
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).params).toBeUndefined()
  })

  it('ApiError 透传 error.params（限流秒数 / 端口占用者）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, {
        error: {
          code: 'auth_rate_limited',
          message: 'too many attempts, retry later',
          params: { seconds: 30 }
        }
      })
    )

    const rateLimited = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { password: 'wrong' },
      silentAuth: true
    }).catch((e: unknown) => e)
    expect((rateLimited as ApiError).params).toEqual({ seconds: 30 })

    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: 'port_in_use',
          message: 'port 11010 is already used by easytier-core',
          params: { port: 11010, owner: 'easytier-core' }
        }
      })
    )
    const portInUse = await request('/api/v1/instances/home/start', { method: 'POST' }).catch(
      (e: unknown) => e
    )
    expect((portInUse as ApiError).params).toEqual({ port: 11010, owner: 'easytier-core' })
  })

  it('非对象 params 归一为 undefined', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: 'invalid_id', message: 'invalid identifier', params: 'oops' }
      })
    )

    const error = await request('/api/v1/configs/x').catch((e: unknown) => e)
    expect((error as ApiError).params).toBeUndefined()
  })

  it('401 触发 onUnauthorized 回调', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_required', message: 'authentication required' } })
    )

    await expect(request('/api/v1/auth/session')).rejects.toMatchObject({
      code: 'auth_required',
      status: 401
    })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('428 触发 onSetupRequired 回调', async () => {
    const setupRequired = vi.fn()
    disposeSetupRequired = onSetupRequired(setupRequired)
    fetchMock.mockResolvedValue(
      jsonResponse(428, { error: { code: 'setup_required', message: 'setup required' } })
    )

    await expect(request('/api/v1/configs')).rejects.toMatchObject({ code: 'setup_required' })
    expect(setupRequired).toHaveBeenCalledTimes(1)
  })

  it('silentAuth 抑制 401 的 onUnauthorized 通知，但仍抛出 ApiError', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_invalid', message: 'invalid credentials' } })
    )

    await expect(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: { password: 'wrong' },
        silentAuth: true
      })
    ).rejects.toMatchObject({ code: 'auth_invalid', status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('silentAuth 不影响 428 的 setup 通知', async () => {
    const setupRequired = vi.fn()
    disposeSetupRequired = onSetupRequired(setupRequired)
    fetchMock.mockResolvedValue(
      jsonResponse(428, { error: { code: 'setup_required', message: 'setup required' } })
    )

    await expect(request('/api/v1/auth/session', { silentAuth: true })).rejects.toMatchObject({
      code: 'setup_required'
    })
    expect(setupRequired).toHaveBeenCalledTimes(1)
  })

  it('默认超时为 15s', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    try {
      await request('/api/v1/meta')
      expect(DEFAULT_TIMEOUT_MS).toBe(15000)
      expect(timeoutSpy).toHaveBeenCalledWith(15000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('无 JSON 错误体时退化为 http_<status>，响应体为空不抛解析错误', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }))

    const error = await request('/api/v1/meta').catch((e: unknown) => e)
    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).code).toBe('http_502')
    expect((error as ApiError).status).toBe(502)
  })

  it('超时/中断错误原样透传，不包装成 ApiError', async () => {
    const abort = new DOMException('The operation timed out.', 'TimeoutError')
    fetchMock.mockRejectedValue(abort)

    const error = await request('/api/v1/meta').catch((e: unknown) => e)
    expect(error).toBe(abort)
    expect(isApiError(error)).toBe(false)
    expect((error as DOMException).name).toBe('TimeoutError')
  })

  it('请求形状：同源凭据、JSON body、15s 超时信号', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    await request('/api/v1/auth/login', { method: 'POST', body: { password: 'secret' } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ password: 'secret' }))
  })

  it('纯文本响应（日志端点）不做 JSON 解析', async () => {
    fetchMock.mockResolvedValue(
      new Response('line-1\nline-2\n', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    )

    await expect(
      request('/api/v1/logs/agent/agent.log', { text: true, query: { tail: 2 } })
    ).resolves.toBe('line-1\nline-2\n')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/logs/agent/agent.log?tail=2')
  })

  it('200 空响应体解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    await expect(request('/api/v1/packages/tasks/t1/cancel', { method: 'POST' })).resolves.toBe(
      undefined
    )
  })
})
