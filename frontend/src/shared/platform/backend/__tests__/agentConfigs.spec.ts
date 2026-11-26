/**
 * agent 配置适配器单测：请求路径 / 方法 / 请求体形状与错误映射。
 *
 * 与 agentAuth.spec 同一策略：直接走真实 http 客户端，只替换全局 fetch，
 * 锁定 `PUT` 必带 `expectedHash`、409 `conflict_hash` 原样抛出等契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentConfigs } from '@/shared/platform/backend/agent/configs'
import { ApiError, onUnauthorized } from '@/shared/platform/backend/http'
import type { ConfigMeta } from '@/shared/platform/backend/types'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

const meta: ConfigMeta = { id: 'home', hash: 'h1', size: 42, modifiedAt: 1_700_000_000 }

describe('agentConfigs', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    disposeUnauthorized?.()
    disposeUnauthorized = null
    vi.unstubAllGlobals()
  })

  it('list：GET /api/v1/configs，取出 configs 数组', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { configs: [meta] }))

    await expect(agentConfigs.list()).resolves.toEqual([meta])

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('list：空响应体时返回空列表而不是抛错', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    await expect(agentConfigs.list()).resolves.toEqual([])
  })

  it('read：GET /api/v1/configs/{id}，id 做 URL 编码', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { toml: 'hostname = "a"', hash: 'h1' }))

    await expect(agentConfigs.read('a b')).resolves.toEqual({
      toml: 'hostname = "a"',
      hash: 'h1'
    })

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/a%20b')
    expect(init.method).toBe('GET')
  })

  it('read：未知 id 的 404 原样抛出 ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'not_found', message: 'config not found' } })
    )

    await expect(agentConfigs.read('missing')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'not_found',
      status: 404
    })
  })

  it('read：401 触发全局会话失效回调（配置端点不做 silentAuth）', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_required', message: 'login required' } })
    )

    await expect(agentConfigs.read('home')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('write：PUT 携带 toml 与 expectedHash，返回新 hash', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'home', hash: 'h2' }))

    await expect(agentConfigs.write('home', 'hostname = "b"', 'h1')).resolves.toBe('h2')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/home')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({
      toml: 'hostname = "b"',
      expectedHash: 'h1'
    })
  })

  it('write：未提供 expectedHash 时请求体只带 toml（新增配置）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'new', hash: 'h9' }))

    await agentConfigs.write('new', 'dhcp = true\n')

    const [, init] = lastCall()
    expect(JSON.parse(String(init.body))).toEqual({ toml: 'dhcp = true\n' })
  })

  it('write：409 conflict_hash 抛 ApiError，页面可据此提示刷新', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'conflict_hash', message: 'config changed', params: { current: 'h3' } }
      })
    )

    await expect(agentConfigs.write('home', 'x = 1', 'h1')).rejects.toMatchObject({
      code: 'conflict_hash',
      status: 409,
      params: { current: 'h3' }
    })
  })

  it('remove：DELETE /api/v1/configs/{id}，204 解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentConfigs.remove('home')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/home')
    expect(init.method).toBe('DELETE')
  })

  it('rename：POST /{id}/rename，body {to}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'renamed', hash: 'h4' }))

    await expect(agentConfigs.rename('home', 'renamed')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/home/rename')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ to: 'renamed' })
  })

  it('importToml：POST /api/v1/configs/import，body {filename, toml}，返回新 id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...meta, id: 'imported' }))

    await expect(agentConfigs.importToml('imported.toml', 'dhcp = true\n')).resolves.toBe(
      'imported'
    )

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/import')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      filename: 'imported.toml',
      toml: 'dhcp = true\n'
    })
  })

  it('exportToml：GET /{id}/export，返回 {filename, toml}', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { filename: 'home.toml', toml: 'hostname = "a"' })
    )

    await expect(agentConfigs.exportToml('home')).resolves.toEqual({
      filename: 'home.toml',
      toml: 'hostname = "a"'
    })

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/configs/home/export')
    expect(init.method).toBe('GET')
  })

  it('可选：ApiError 实例可被 isApiError 识别（页面按 code 分支）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'conflict_hash', message: 'config changed' } })
    )

    const error = await agentConfigs.write('home', 'x = 1', 'h1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
  })
})
