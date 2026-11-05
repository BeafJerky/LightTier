/**
 * runtime store 单测：初始化订阅、目录同步与快照投影
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RuntimeSnapshot } from '@/shared/platform/runtimeApi'

const api = vi.hoisted(() => ({
  runtimeAvailable: vi.fn(() => true),
  getRuntimeSnapshot: vi.fn(),
  setRuntimeCatalog: vi.fn(async () => undefined),
  refreshRuntime: vi.fn(async () => undefined),
  onRuntimeSnapshot: vi.fn(async () => () => undefined),
  toRunningItem: vi.fn((instance: { configFileName: string; pid: number }) => ({
    configFileName: instance.configFileName,
    pid: instance.pid
  }))
}))

const storeMock = vi.hoisted(() => ({ setRunningList: vi.fn() }))

vi.mock('@/shared/platform/runtimeApi', () => api)

vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => storeMock
}))

const snapshot = (names: string[]): RuntimeSnapshot => ({
  revision: 1,
  updatedAt: 100,
  catalog: names,
  instances: names.map((name, index) => ({
    configFileName: name,
    fileName: `${name}.toml`,
    pid: 100 + index
  }))
})

describe('useRuntimeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 不清除实现：逐个复位，避免上一个用例的返回值泄漏
    api.runtimeAvailable.mockReturnValue(true)
    setActivePinia(createPinia())
  })

  it('初始化：先挂监听再拉快照，并投影运行列表', async () => {
    api.getRuntimeSnapshot.mockResolvedValue(snapshot(['a', 'b']))
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()

    await expect(store.init()).resolves.toBe(true)

    expect(api.onRuntimeSnapshot).toHaveBeenCalledTimes(1)
    expect(api.getRuntimeSnapshot).toHaveBeenCalledTimes(1)
    expect(store.available).toBe(true)
    expect(store.ready).toBe(true)
    expect(storeMock.setRunningList).toHaveBeenLastCalledWith([
      { configFileName: 'a', pid: 100 },
      { configFileName: 'b', pid: 101 }
    ])
  })

  it('初始化幂等：重复调用复用同一次订阅', async () => {
    api.getRuntimeSnapshot.mockResolvedValue(snapshot([]))
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()

    await Promise.all([store.init(), store.init()])
    await store.init()

    expect(api.onRuntimeSnapshot).toHaveBeenCalledTimes(1)
    expect(api.getRuntimeSnapshot).toHaveBeenCalledTimes(1)
  })

  it('非 Tauri 环境不初始化，交由调用方回退 mock', async () => {
    api.runtimeAvailable.mockReturnValue(false)
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()

    await expect(store.init()).resolves.toBe(false)
    expect(api.onRuntimeSnapshot).not.toHaveBeenCalled()
    expect(store.ready).toBe(true)
  })

  it('初始化失败后允许下次重试，不会永久降级', async () => {
    api.getRuntimeSnapshot
      .mockRejectedValueOnce(new Error('runtime not ready'))
      .mockResolvedValueOnce(snapshot(['a']))
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()

    await expect(store.init()).resolves.toBe(false)
    expect(store.available).toBe(false)

    await expect(store.init()).resolves.toBe(true)
    expect(store.available).toBe(true)
    expect(api.onRuntimeSnapshot).toHaveBeenCalledTimes(2)
    expect(storeMock.setRunningList).toHaveBeenLastCalledWith([{ configFileName: 'a', pid: 100 }])
  })

  it('目录同步：顺序无关比对，变化时下发清单并返回 true', async () => {
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()

    await expect(store.syncCatalog(['b', 'a'])).resolves.toBe(true)
    expect(api.setRuntimeCatalog).toHaveBeenLastCalledWith(['b', 'a'])

    await expect(store.syncCatalog(['a', 'b'])).resolves.toBe(false)
    expect(api.setRuntimeCatalog).toHaveBeenCalledTimes(1)
  })

  it('强制刷新：重新拉取快照并更新投影', async () => {
    api.getRuntimeSnapshot
      .mockResolvedValueOnce(snapshot(['a']))
      .mockResolvedValueOnce(snapshot(['a', 'b']))
    const { useRuntimeStore } = await import('@/shared/store/runtime')
    const store = useRuntimeStore()
    await store.init()

    await store.refresh()

    expect(api.refreshRuntime).toHaveBeenCalledTimes(1)
    expect(storeMock.setRunningList).toHaveBeenLastCalledWith([
      { configFileName: 'a', pid: 100 },
      { configFileName: 'b', pid: 101 }
    ])
  })
})
