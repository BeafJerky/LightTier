import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useIslandBridge } from '@/shared/composables/useIslandBridge'
import { useIslandStore } from '@/shared/store/island'

const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    length: 0,
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    key: vi.fn(() => null)
  })
  return {
    scan: vi.fn(),
    refreshManagerReleaseInfo: vi.fn(),
    easy: {
      runningList: [] as { configFileName: string }[],
      detectedCoreVersion: '',
      updateStableOnly: true,
      refreshManagerReleaseInfo: vi.fn()
    }
  }
})

vi.mock('@/shared/i18n/t', () => ({ t: (key: string) => key }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@/shared/store/easytier', () => ({ useEasyTierStore: () => mocks.easy }))
vi.mock('@/shared/composables/useRunningListSync', () => ({
  useRunningListSync: (options: { onError: () => void; onSuccess: () => void }) => ({
    updateRunningList: async () => mocks.scan(options)
  })
}))
vi.mock('@/shared/platform/sysUtil', () => ({
  getAppVersion: vi.fn(async () => 'v1.0.0'),
  compareVersions: (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
}))
vi.mock('@/shared/platform/platformUtil', () => ({ isAndroid: () => false }))
vi.mock('@/shared/platform/runtimeApi', () => ({
  onHealthSnapshot: vi.fn(),
  runtimeAvailable: () => false,
  subscribeHealth: vi.fn(),
  toRuntimeInstance: vi.fn(),
  unsubscribeHealth: vi.fn()
}))

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('useIslandBridge 启动与更新生命周期', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const documentMock = new EventTarget() as EventTarget & { hidden: boolean }
    Object.defineProperty(documentMock, 'hidden', { value: false, writable: true })
    documentMock.hidden = false
    vi.stubGlobal('document', documentMock)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    setActivePinia(createPinia())
    mocks.easy.runningList = []
    mocks.easy.detectedCoreVersion = ''
    mocks.easy.updateStableOnly = true
    mocks.easy.refreshManagerReleaseInfo = mocks.refreshManagerReleaseInfo
    mocks.refreshManagerReleaseInfo.mockResolvedValue([])
    mocks.scan.mockImplementation((options: { onSuccess: () => void }) => options.onSuccess())
    scope = effectScope()
  })

  const start = () => scope.run(() => useIslandBridge())

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('初次扫描持续按上限退避重试，成功后只建立一次基线', async () => {
    mocks.scan.mockImplementation((options: { onError: () => void }) => options.onError())
    start()
    await flush()
    expect(mocks.scan).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.scan).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.scan).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.scan).toHaveBeenCalledTimes(4)

    mocks.scan.mockImplementation((options: { onSuccess: () => void }) => options.onSuccess())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.scan).toHaveBeenCalledTimes(5)
    expect(useIslandStore().baselineReady).toBe(true)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.scan).toHaveBeenCalledTimes(5)
  })

  it('初始化失败时切回前台会立即重试', async () => {
    mocks.scan.mockImplementation((options: { onError: () => void }) => options.onError())
    start()
    await flush()
    Object.defineProperty(document, 'hidden', { value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(mocks.scan).toHaveBeenCalledTimes(2)
  })

  it('缓存失效后，旧更新请求的结果不会写回版本或通知', async () => {
    let resolve!: (releases: { tag_name: string }[]) => void
    mocks.refreshManagerReleaseInfo.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    start()
    await flush()
    const island = useIslandStore()
    island.invalidateManagerUpdate()
    resolve([{ tag_name: 'v2.0.0' }])
    await flush()

    expect(island.latestManagerVersion).toBe('')
    expect(island.current).toBeNull()
  })

  it('同一新版本被忽略后，前台恢复只补角标不再次主动提醒', async () => {
    mocks.refreshManagerReleaseInfo.mockResolvedValue([{ tag_name: 'v2.0.0' }])
    start()
    await flush()
    const island = useIslandStore()
    expect(island.current?.sourceKey).toBe('update:manager')
    expect(island.current?.quiet).toBe(false)
    island.dismiss(island.current!.id)

    Object.defineProperty(document, 'hidden', { value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(mocks.refreshManagerReleaseInfo).toHaveBeenCalledTimes(1)
    expect(island.current?.sourceKey).toBe('update:manager')
    expect(island.current?.quiet).toBe(true)
  })
})
