/**
 * useInstanceActions 单测：启动预检（兼容/端口/Android 停旧起新）、失败回滚、停止清理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstanceActions } from '@/shared/composables/useInstanceActions'

const storeMock = vi.hoisted(() => ({
  configList: [] as RunningItem[],
  runningList: [] as RunningItem[],
  detectedCoreVersion: null as string | null,
  stopLoop: false,
  p2pNotify: true,
  setRunningList: vi.fn(),
  removeRunningList: vi.fn(),
  setLastRunConfigName: vi.fn()
}))

const api = vi.hoisted(() => ({
  startConfig: vi.fn(async () => {}),
  stopConfig: vi.fn(async () => true),
  getRunningList: vi.fn(async () => []),
  checkPortConflicts: vi.fn(async () => [] as PortConflict[])
}))

const metric = vi.hoisted(() => ({
  beforeStart: vi.fn(async () => {}),
  afterStop: vi.fn(async () => {})
}))

const route = vi.hoisted(() => ({
  clearExitRoute: vi.fn(async () => ({ ok: true, cleared: 0, failed: 0, failedEntries: [] }))
}))

const compat = vi.hoisted(() => ({
  issues: [] as { code: string; level: 'error' | 'warning'; params?: Record<string, unknown> }[]
}))

const platform = vi.hoisted(() => ({ android: false }))

vi.mock('@/shared/store/easytier', () => ({ useEasyTierStore: () => storeMock }))
vi.mock('@/shared/platform/coreApi', () => api)
vi.mock('@/shared/composables/useAutoMetric', () => ({ useAutoMetric: () => metric }))
vi.mock('@/shared/platform/routeUtil', () => route)
vi.mock('@/shared/composables/useConfigCompatCheck', () => ({
  useConfigCompatCheck: () => ({
    getCompatIssues: vi.fn(async () => compat.issues)
  })
}))
vi.mock('@/shared/platform/platformUtil', () => ({ isAndroid: () => platform.android }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

const item: RunningItem = { configFileName: 'home.toml', fileName: 'home.toml' }

describe('useInstanceActions.startInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.configList = [item]
    storeMock.runningList = []
    storeMock.detectedCoreVersion = null
    storeMock.stopLoop = false
    storeMock.p2pNotify = true
    compat.issues = []
    platform.android = false
  })

  it('正常启动：记录自动跃点、刷新运行列表并触发启动后处理', async () => {
    const confirm = vi.fn(async () => true)
    const afterStart = vi.fn(async () => {})
    const { startInstance } = useInstanceActions({ confirm, afterStart })

    await startInstance(item)

    expect(metric.beforeStart).toHaveBeenCalledWith('home.toml')
    expect(api.startConfig).toHaveBeenCalledWith('home.toml')
    expect(storeMock.stopLoop).toBe(false)
    expect(storeMock.p2pNotify).toBe(true)
    expect(storeMock.setLastRunConfigName).toHaveBeenCalledWith(item)
    expect(api.getRunningList).toHaveBeenCalledWith(['home.toml'])
    expect(afterStart).toHaveBeenCalledWith(item, false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('兼容错误确认取消时不启动', async () => {
    compat.issues = [{ code: 'unknownFlag', level: 'error' }]
    const confirm = vi.fn(async () => false)
    const { startInstance } = useInstanceActions({ confirm })

    await expect(startInstance(item)).rejects.toThrow('compat-cancelled')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.startConfig).not.toHaveBeenCalled()
    expect(metric.beforeStart).not.toHaveBeenCalled()
  })

  it('自动运行遇兼容错误：提示后跳过，不弹确认框', async () => {
    compat.issues = [{ code: 'unknownFlag', level: 'error' }]
    const confirm = vi.fn(async () => true)
    const onAutoCompatSkip = vi.fn()
    const { startInstance } = useInstanceActions({ confirm, onAutoCompatSkip })

    await expect(startInstance(item, { auto: true })).rejects.toThrow('compat-blocked')

    expect(confirm).not.toHaveBeenCalled()
    expect(onAutoCompatSkip).toHaveBeenCalledWith('home.toml', 'coreCompat.unknownFlag:{}')
    expect(api.startConfig).not.toHaveBeenCalled()
  })

  it('端口冲突：标记冲突来源并跳过启动', async () => {
    api.checkPortConflicts.mockResolvedValueOnce([
      { port: 11000, conflictConfig: 'office.toml' },
      { port: 11000, conflictConfig: 'office.toml' },
      { port: 15888, conflictConfig: 'home2.toml' }
    ])
    const confirm = vi.fn(async () => true)
    const onPortConflict = vi.fn()
    const { startInstance } = useInstanceActions({
      confirm,
      portConflictCheck: true,
      onPortConflict
    })

    await expect(startInstance(item)).rejects.toThrow('port-conflict')

    expect(onPortConflict).toHaveBeenCalledWith({ office: [11000], home2: [15888] })
    expect(api.startConfig).not.toHaveBeenCalled()
  })

  it('启动失败：回滚自动跃点并抛出 start-failed', async () => {
    api.startConfig.mockRejectedValueOnce(new Error('core boom'))
    const afterStart = vi.fn(async () => {})
    const { startInstance } = useInstanceActions({
      confirm: async () => true,
      afterStart
    })

    await expect(startInstance(item)).rejects.toThrow('start-failed')

    expect(metric.afterStop).toHaveBeenCalledWith('home.toml')
    expect(afterStart).not.toHaveBeenCalled()
  })

  it('Android 单实例：确认后停旧起新', async () => {
    platform.android = true
    storeMock.runningList = [{ configFileName: 'old.toml', fileName: 'old.toml' }]
    const confirm = vi.fn(async () => true)
    const { startInstance } = useInstanceActions({ confirm })

    await startInstance(item)

    expect(api.stopConfig).toHaveBeenCalledWith(storeMock.runningList[0])
    expect(storeMock.removeRunningList).toHaveBeenCalledWith('old.toml')
    expect(api.startConfig).toHaveBeenCalledWith('home.toml')
  })

  it('Android 停旧起新取消时不启动', async () => {
    platform.android = true
    storeMock.runningList = [{ configFileName: 'old.toml', fileName: 'old.toml' }]
    const confirm = vi.fn(async () => false)
    const { startInstance } = useInstanceActions({ confirm })

    await expect(startInstance(item)).rejects.toThrow('switch-cancelled')

    expect(api.stopConfig).not.toHaveBeenCalled()
    expect(api.startConfig).not.toHaveBeenCalled()
  })
})

describe('useInstanceActions.stopInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.runningList = [{ configFileName: 'home.toml', fileName: 'home.toml', pid: 123 }]
    platform.android = false
  })

  it('停止成功：结束进程、恢复跃点并清理出口路由', async () => {
    const { stopInstance } = useInstanceActions({
      confirm: async () => true,
      exitRouteGuard: () => true
    })

    await expect(stopInstance(item)).resolves.toBe(true)

    expect(api.stopConfig).toHaveBeenCalledWith(storeMock.runningList[0])
    expect(storeMock.stopLoop).toBe(true)
    expect(storeMock.removeRunningList).toHaveBeenCalledWith('home.toml')
    expect(metric.afterStop).toHaveBeenCalledWith('home.toml')
    expect(route.clearExitRoute).toHaveBeenCalledWith('home.toml')
  })

  it('停止失败：保留运行记录且不清理路由', async () => {
    api.stopConfig.mockResolvedValueOnce(false)
    const { stopInstance } = useInstanceActions({
      confirm: async () => true,
      exitRouteGuard: () => true
    })

    await expect(stopInstance(item)).resolves.toBe(false)

    expect(storeMock.removeRunningList).not.toHaveBeenCalled()
    expect(metric.afterStop).not.toHaveBeenCalled()
    expect(route.clearExitRoute).not.toHaveBeenCalled()
  })
})
