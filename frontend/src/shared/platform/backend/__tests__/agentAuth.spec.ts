/**
 * agent 鉴权适配器单测：请求路径 / 方法 / 请求体 / 同源凭据与 silentAuth 行为。
 *
 * 直接走真实 http 客户端，只替换全局 fetch，确保适配层新增的端点参数可被锁定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth } from '@/shared/platform/backend/agent/auth'
import { onSetupRequired, onUnauthorized } from '@/shared/platform/backend/http'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null
let disposeSetupRequired: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

describe('agentAuth', () => {
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

  it('login：POST /api/v1/auth/login，body {password}，同源凭据', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await agentAuth.login('secret-pass')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ password: 'secret-pass' })
  })

  it('setup：POST /api/v1/auth/setup，body {token,password}，204 解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentAuth.setup('token-1', 'secret-pass')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/auth/setup')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ token: 'token-1', password: 'secret-pass' })
  })

  it('session：GET /api/v1/auth/session，返回 authenticated', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { authenticated: true }))

    await expect(agentAuth.session()).resolves.toEqual({ authenticated: true })

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/auth/session')
    expect(init.method).toBe('GET')
  })

  it('session / login 的 401 不触发全局会话失效回调', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)

    fetchMock.mockImplementation(async () =>
      jsonResponse(401, { error: { code: 'auth_invalid', message: 'invalid credentials' } })
    )

    await expect(agentAuth.session()).rejects.toMatchObject({ status: 401 })
    await expect(agentAuth.login('wrong-pass')).rejects.toMatchObject({
      code: 'auth_invalid',
      status: 401
    })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('setup 的 428 仍触发初始化回调', async () => {
    const setupRequired = vi.fn()
    disposeSetupRequired = onSetupRequired(setupRequired)

    fetchMock.mockResolvedValue(
      jsonResponse(428, { error: { code: 'setup_required', message: 'setup required' } })
    )

    await expect(agentAuth.session()).rejects.toMatchObject({ code: 'setup_required' })
    expect(setupRequired).toHaveBeenCalledTimes(1)
  })

  it('logout：POST /api/v1/auth/logout，204 无返回体', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentAuth.logout()).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/auth/logout')
    expect(init.method).toBe('POST')
  })

  it('changePassword：POST /api/v1/auth/password，body {password}，204 解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentAuth.changePassword('new-secret-pass')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/auth/password')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ password: 'new-secret-pass' })
  })

  it('changePassword：长度不足 auth_invalid 透传，且不触发全局会话失效回调', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)

    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_invalid', message: 'invalid credentials' } })
    )

    await expect(agentAuth.changePassword('short')).rejects.toMatchObject({
      code: 'auth_invalid',
      status: 401
    })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('changePassword：未初始化 setup_required 透传并触发初始化回调', async () => {
    const setupRequired = vi.fn()
    disposeSetupRequired = onSetupRequired(setupRequired)

    fetchMock.mockResolvedValue(
      jsonResponse(428, { error: { code: 'setup_required', message: 'setup required' } })
    )

    await expect(agentAuth.changePassword('new-secret-pass')).rejects.toMatchObject({
      code: 'setup_required',
      status: 428
    })
    expect(setupRequired).toHaveBeenCalledTimes(1)
  })

  it('meta：把字符串 apiVersion 归一为数字', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        apiVersion: '1',
        agentVersion: '0.1.0',
        setupRequired: false,
        tunAvailable: true,
        features: { login: true },
        coreVersions: []
      })
    )

    const meta = await agentAuth.meta()

    expect(meta.apiVersion).toBe(1)
  })
})
