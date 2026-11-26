/**
 * 门面装配单测。
 *
 * 每个用例都用 `vi.resetModules()` + 动态 import 拿到全新模块实例，避免
 * `initBackend()` 的模块级 memoization 在用例之间串味。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isTauri: vi.fn<() => boolean>() }))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.isTauri() }))

// native 适配器会传递委托给既有平台模块；这里只验证门面装配，避免拉入
// fileUtil / mobileVpn 等带 Tauri 模块级副作用的实现（无 window 时会抛错）。
vi.mock('@/shared/platform/coreApi', () => ({
  getRunningList: vi.fn(),
  startConfig: vi.fn(),
  stopConfig: vi.fn()
}))
vi.mock('@/shared/platform/runtimeApi', () => ({ getRuntimeSnapshot: vi.fn() }))

const fetchMock = vi.fn()

const loadFacade = async () => {
  vi.resetModules()
  return import('@/shared/platform/backend')
}

const metaResponse = (): Response =>
  new Response(
    JSON.stringify({
      apiVersion: '1',
      agentVersion: '1.2.3',
      setupRequired: false,
      tunAvailable: true,
      features: { routes: true, login: true },
      coreVersions: []
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

describe('backend facade', () => {
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

  it('Tauri 环境装配 native 适配器、零探测，meta() 永不 reject', async () => {
    mocks.isTauri.mockReturnValue(true)
    vi.stubEnv('DEV', true)
    vi.stubGlobal('location', { search: '?agent=1' })
    const facade = await loadFacade()

    await expect(facade.initBackend()).resolves.toBe('native')
    expect(facade.backendMode()).toBe('native')
    expect(facade.backend().kind).toBe('native')
    expect(fetchMock).not.toHaveBeenCalled()

    // 共享守卫按 session → meta 调用时，桌面端不能因 meta reject 误入 agent 错误页
    await expect(facade.backend().auth.session()).resolves.toEqual({ authenticated: true })
    const meta = await facade.backend().auth.meta()
    expect(meta).toMatchObject({
      apiVersion: 1,
      agentVersion: 'native',
      setupRequired: false,
      tunAvailable: true,
      coreVersions: []
    })
    expect(Object.values(meta.features).every(Boolean)).toBe(true)
  })

  it('DEV 未带 ?agent=1 时装配 native（Mock）适配器且零探测', async () => {
    vi.stubEnv('DEV', true)
    vi.stubGlobal('location', { search: '' })
    const facade = await loadFacade()

    await expect(facade.initBackend()).resolves.toBe('mock')
    expect(facade.backendMode()).toBe('mock')
    expect(facade.backend().kind).toBe('native')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('agent 可达时装配 HTTP 适配器', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('location', { search: '' })
    fetchMock.mockResolvedValue(metaResponse())
    const facade = await loadFacade()

    await expect(facade.initBackend()).resolves.toBe('agent')
    expect(facade.backend().kind).toBe('agent')
    expect(facade.backendCapabilities()).toMatchObject({ kernel: true, logs: true, routes: false })
  })

  it('initBackend / resolveBackendMode 共用 memoized 探测，只打一次 /meta', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('location', { search: '' })
    fetchMock.mockResolvedValue(metaResponse())
    const facade = await loadFacade()

    expect(facade.resolveBackendMode).toBe(facade.initBackend)
    await expect(facade.resolveBackendMode()).resolves.toBe('agent')
    await expect(facade.initBackend()).resolves.toBe('agent')
    await expect(facade.initBackend()).resolves.toBe('agent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('initBackend() 完成前调用 backend() 抛出明确错误', async () => {
    vi.stubEnv('DEV', true)
    vi.stubGlobal('location', { search: '' })
    const facade = await loadFacade()

    expect(facade.backendMode()).toBe('native')
    expect(() => facade.backend()).toThrow(/initBackend/)
    expect(() => facade.backendAuth()).toThrow(/initBackend/)

    await facade.initBackend()
    expect(() => facade.backend()).not.toThrow()
  })
})
