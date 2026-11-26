/**
 * 运行模式判定单测。
 *
 * 绑定顺序：Tauri → native（零探测）；DEV 无 `?agent=1` → mock（零探测）；
 * DEV `?agent=1` / 生产浏览器 → 探测 `/api/v1/meta`，可达且响应体确为 agent
 * meta 时 agent、否则 offline。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isTauri: vi.fn<() => boolean>() }))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.isTauri() }))

import {
  META_PROBE_PATH,
  META_PROBE_TIMEOUT_MS,
  detectBackendMode
} from '@/shared/platform/backend/mode'

const fetchMock = vi.fn()

/** agent `/meta` 的最小合法响应（后端当前把 apiVersion 序列化为字符串） */
const metaBody = {
  apiVersion: '1',
  agentVersion: '1.2.3',
  setupRequired: false,
  tunAvailable: true,
  features: { routes: true, login: true },
  coreVersions: []
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/** 用 stubGlobal 注入 location，afterEach 的 unstubAllGlobals 会恢复，不污染其他测试 */
const setSearch = (search: string): void => {
  vi.stubGlobal('location', { search })
}

describe('detectBackendMode', () => {
  beforeEach(() => {
    mocks.isTauri.mockReset()
    mocks.isTauri.mockReturnValue(false)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('Tauri 环境直接判定 native，且不发起任何探测请求', async () => {
    mocks.isTauri.mockReturnValue(true)
    vi.stubEnv('DEV', true)
    setSearch('?agent=1')

    await expect(detectBackendMode()).resolves.toBe('native')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DEV 未带 ?agent=1 时保持 mock，且不发起任何探测请求', async () => {
    vi.stubEnv('DEV', true)
    setSearch('')

    await expect(detectBackendMode()).resolves.toBe('mock')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DEV 带 ?agent=1 且 meta 合法（字符串版本号）时判定 agent', async () => {
    vi.stubEnv('DEV', true)
    setSearch('?agent=1')
    fetchMock.mockResolvedValue(jsonResponse(200, metaBody))

    await expect(detectBackendMode()).resolves.toBe('agent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe(META_PROBE_PATH)
    expect(init.credentials).toBe('same-origin')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('生产浏览器 meta 数值版本号 + features 对象时判定 agent', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockResolvedValue(jsonResponse(200, { ...metaBody, apiVersion: 1 }))

    await expect(detectBackendMode()).resolves.toBe('agent')
  })

  it('生产浏览器 meta 网络错误时判定 offline（不回退 Mock）', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('DEV 带 ?agent=1 但代理返回 500（agent 未启动）时判定 offline', async () => {
    vi.stubEnv('DEV', true)
    setSearch('?agent=1')
    // Vite 代理在后端拒连时返回 500 响应而非网络错误，只看抛错会误判
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('生产浏览器探测超时判定 offline', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('200 返回 SPA index.html（文本托管回落）时判定 offline', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html><body>LightTier</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    )

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('200 返回 JSON 但缺少 features 对象时判定 offline', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    // features: undefined 会被 JSON.stringify 丢弃，等价于响应体无该字段
    fetchMock.mockResolvedValue(jsonResponse(200, { ...metaBody, features: undefined }))

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('200 返回非数字 apiVersion 时判定 offline', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockResolvedValue(jsonResponse(200, { ...metaBody, apiVersion: 'v1' }))

    await expect(detectBackendMode()).resolves.toBe('offline')
  })

  it('探测超时为 3s', async () => {
    vi.stubEnv('DEV', false)
    setSearch('')
    fetchMock.mockResolvedValue(jsonResponse(200, metaBody))
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    try {
      await expect(detectBackendMode()).resolves.toBe('agent')
      expect(META_PROBE_TIMEOUT_MS).toBe(3000)
      expect(timeoutSpy).toHaveBeenCalledWith(3000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
