/**
 * agent 主题适配器单测：列表逐项取回、保存/删除的路径与方法，
 * 以及服务端 `invalid_theme` 原样抛给页面做文案映射。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentThemes } from '@/shared/platform/backend/agent/themes'
import { ApiError } from '@/shared/platform/backend/http'

const fetchMock = vi.fn()

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

describe('agentThemes', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list：先取元信息，再逐项取回完整 CSS', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { themes: [{ name: 'ocean' }, { name: 'sand' }] }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'ocean', cssText: 'a' }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'sand', cssText: 'b' }))

    await expect(agentThemes.list()).resolves.toEqual([
      { name: 'ocean', cssText: 'a' },
      { name: 'sand', cssText: 'b' }
    ])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/themes',
      '/api/v1/themes/ocean',
      '/api/v1/themes/sand'
    ])
  })

  it('list：无主题时只打一次列表请求', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { themes: [] }))

    await expect(agentThemes.list()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('save：POST /api/v1/themes 携带 name 与 cssText', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { name: 'ocean', size: 3, modifiedAt: 1 }))

    await agentThemes.save('ocean', 'css')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/themes')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'ocean', cssText: 'css' })
  })

  it('remove：DELETE 名称做 URL 编码', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await agentThemes.remove('a b')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/themes/a%20b')
    expect(init.method).toBe('DELETE')
  })

  it('服务端拒绝时抛出带 code 的 ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { error: { code: 'invalid_theme', message: 'bad' } })
    )

    await expect(agentThemes.save('ocean', 'css')).rejects.toMatchObject({
      code: 'invalid_theme'
    })
    await expect(agentThemes.save('ocean', 'css')).rejects.toBeInstanceOf(ApiError)
  })
})
