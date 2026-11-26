import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
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
    mode: 'native' as 'native' | 'agent',
    health: vi.fn(),
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
vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => mocks.mode,
  backendRuntime: () => ({ health: mocks.health })
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
    Object.defineProperty(documentMock, 'visibilityState', { value: 'visible', writable: true })
    documentMock.hidden = false
    vi.stubGlobal('document', documentMock)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    setActivePinia(createPinia())
    mocks.mode = 'native'
    mocks.health.mockResolvedValue({ revision: 0, sampledAt: 0, instances: [] })
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

describe('useIslandBridge agent 健康采样', () => {
  let scope: ReturnType<typeof effectScope>

  const POOR_SNAPSHOT = {
    revision: 1,
    sampledAt: 1_730_000_000,
    instances: [{ configFileName: 'home', ok: true, avgLatencyMs: 200, lossRate: 3, peerCount: 2 }]
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const documentMock = new EventTarget() as EventTarget & { hidden: boolean }
    Object.defineProperty(documentMock, 'hidden', { value: false, writable: true })
    Object.defineProperty(documentMock, 'visibilityState', { value: 'visible', writable: true })
    vi.stubGlobal('document', documentMock)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    setActivePinia(createPinia())
    mocks.mode = 'agent'
    mocks.health.mockResolvedValue({ revision: 0, sampledAt: 0, instances: [] })
    mocks.easy.runningList = reactive([{ configFileName: 'home' }])
    mocks.easy.detectedCoreVersion = ''
    mocks.easy.updateStableOnly = true
    mocks.easy.refreshManagerReleaseInfo = mocks.refreshManagerReleaseInfo
    mocks.refreshManagerReleaseInfo.mockResolvedValue([])
    mocks.scan.mockImplementation((options: { onSuccess: () => void }) => options.onSuccess())
    scope = effectScope()
  })

  const start = () => scope.run(() => useIslandBridge())

  const setVisibility = (visible: boolean) => {
    Object.defineProperty(document, 'hidden', { value: !visible })
    Object.defineProperty(document, 'visibilityState', {
      value: visible ? 'visible' : 'hidden'
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('初始化成功后立即采样并按 10s 节奏轮询，连续越界上报质量', async () => {
    mocks.health.mockResolvedValue(POOR_SNAPSHOT)
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.health).toHaveBeenCalledTimes(2)
    expect(useIslandStore().current?.type).toBe('quality')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.health).toHaveBeenCalledTimes(3)
  })

  it('关闭 quality 或灵动岛时停止轮询，重新打开立即采样', async () => {
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)
    const island = useIslandStore()

    island.setTypeEnabled('quality', false)
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.health).toHaveBeenCalledTimes(1)

    island.setTypeEnabled('quality', true)
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(2)

    island.setEnabled(false)
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.health).toHaveBeenCalledTimes(2)

    island.setEnabled(true)
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(3)
  })

  it('页面不可见时暂停轮询，恢复可见立即采一次', async () => {
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)

    setVisibility(false)
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.health).toHaveBeenCalledTimes(1)

    setVisibility(true)
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.health).toHaveBeenCalledTimes(3)
  })

  it('请求失败静默跳过本轮，不弹错误也不连续重试', async () => {
    mocks.health.mockRejectedValueOnce(new Error('network down'))
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)
    expect(useIslandStore().current).toBeNull()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.health).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.health).toHaveBeenCalledTimes(2)
    expect(useIslandStore().current).toBeNull()
  })

  it('运行实例集合变化时重置节奏并立即采样', async () => {
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)

    mocks.easy.runningList.push({ configFileName: 'office' })
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.health).toHaveBeenCalledTimes(3)
  })

  it('实例集合变化后，旧请求的结果不再上报', async () => {
    let resolveOld!: (snapshot: typeof POOR_SNAPSHOT) => void
    mocks.health.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done
        })
    )
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)

    mocks.easy.runningList.push({ configFileName: 'office' })
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(2)

    resolveOld(POOR_SNAPSHOT)
    await flush()
    expect(useIslandStore().current).toBeNull()
  })

  it('作用域销毁后停止轮询', async () => {
    start()
    await flush()
    expect(mocks.health).toHaveBeenCalledTimes(1)

    scope.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.health).toHaveBeenCalledTimes(1)
  })

  it('没有运行实例时不轮询', async () => {
    mocks.easy.runningList = reactive([])
    start()
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.health).not.toHaveBeenCalled()
  })
})
