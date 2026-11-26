/**
 * useSettingsKernel 的 agent 用例（Task 10）。
 *
 * 锁定：
 * - `loadCoreState` 从 `packages.list()` 取版本/已安装/active，并读取 TUN 提示；
 *   重复调用时保留已选的已知版本，未知值回退 preferred；
 * - 安装走 `install()` 拿 taskId，1 秒轮询任务：进度百分比、done 后重新拉清单；
 * - 失败时用 `error.code` 出文案；
 * - 取消：服务端应答只是受理，终态由工作线程写入，轮询必须继续到终态为止；
 * - `installAllowed: false` 时安装入口在调用前就被拒绝；
 * - 内置版本不提供删除调用。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSettingsKernel } from '@/features/settings/composables/useSettingsKernel'

const api = vi.hoisted(() => ({
  mode: 'agent' as string,
  packages: {
    list: vi.fn(),
    install: vi.fn(),
    task: vi.fn(),
    cancelTask: vi.fn(),
    remove: vi.fn()
  },
  auth: { meta: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/ui/useCreamToast', () => ({ useCreamToast: () => api.toast }))
vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => api.mode,
  backendPackages: () => api.packages,
  backendAuth: () => api.auth,
  agentCodeI18n: (code: string) => ({ key: `agentError.${code}` }),
  agentErrorI18n: () => null
}))
vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => ({
    runningList: [],
    coreVersionDetecting: false,
    coreVersionRaw: '',
    detectedCoreVersion: '',
    coreCaps: null,
    stopLoop: false,
    configList: []
  })
}))
vi.mock('@/shared/composables/useCoreInstall', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useCoreInstall: () => ({
      installing: vueRef(false),
      installCore: vi.fn(),
      lastInstallError: vueRef('')
    })
  }
})
vi.mock('@/shared/composables/useMirrorProbe', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    MIRROR_SOURCE_KEY: 'mirror-source',
    LATENCY_GOOD: 200,
    LATENCY_BAD: 800,
    useMirrorProbe: () => ({
      sources: vueRef([]),
      probing: vueRef(false),
      selected: vueRef(''),
      probeAll: vi.fn(),
      probeSource: vi.fn(),
      downloadFromMirrors: vi.fn(),
      selectSource: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      canRestoreDefaults: vueRef(false),
      restoreDefaults: vi.fn()
    })
  }
})
vi.mock('@/shared/platform/fileUtil', () => ({
  deleteFileOrDir: vi.fn(),
  downloadFile: vi.fn(),
  listFiles: vi.fn(async () => []),
  openPath: vi.fn()
}))
vi.mock('@/shared/platform/sysUtil', () => ({
  getArch: () => 'x64',
  getOsType: () => 'linux'
}))
vi.mock('@tauri-apps/api/path', () => ({
  resourceDir: vi.fn(async () => '/res'),
  join: vi.fn(async (...parts: string[]) => parts.join('/'))
}))

const PACKAGES = {
  installed: [] as { version: string; builtin: boolean }[],
  available: [
    { version: 'v2.6.4', channel: 'stable' as const, installed: false },
    { version: 'v2.7.0', channel: 'prerelease' as const, installed: false }
  ],
  active: null as string | null,
  installAllowed: true
}

const createKernel = () =>
  useSettingsKernel({
    confirm: vi.fn(async () => true),
    mirror: {
      sources: ref([]),
      probing: ref(false),
      selected: ref(''),
      probeAll: vi.fn(),
      probeSource: vi.fn(),
      downloadFromMirrors: vi.fn(),
      selectSource: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      canRestoreDefaults: ref(false),
      restoreDefaults: vi.fn()
    } as never,
    isDesktopRuntime: false,
    isAndroidPlatform: false
  })

describe('useSettingsKernel (agent)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    api.mode = 'agent'
    api.packages.list.mockResolvedValue({ ...PACKAGES })
    api.auth.meta.mockResolvedValue({
      apiVersion: 1,
      agentVersion: '0.1.0',
      setupRequired: false,
      tunAvailable: true,
      features: {}
    })
  })

  it('loadCoreState：取服务端清单，默认选中 active 版本并暴露 installAllowed', async () => {
    api.packages.list.mockResolvedValue({
      ...PACKAGES,
      installed: [{ version: 'v2.6.4', builtin: true }],
      active: 'v2.6.4'
    })
    const kernel = createKernel()

    await kernel.loadCoreState()

    expect(kernel.coreVerSelect.value).toBe('v2.6.4')
    expect(kernel.coreVerOptions.value.map((item) => item.tag_name)).toEqual(['v2.6.4', 'v2.7.0'])
    expect(kernel.agentInstallAllowed.value).toBe(true)
    expect(kernel.agentSelectedBuiltin.value).toBe(true)
    expect(kernel.selectedCoreReady.value).toBe(true)
  })

  it('loadCoreState：TUN 不可用时带出 tunReason', async () => {
    api.auth.meta.mockResolvedValue({
      apiVersion: 1,
      agentVersion: '0.1.0',
      setupRequired: false,
      tunAvailable: false,
      tunReason: 'no /dev/net/tun in container',
      features: {}
    })
    const kernel = createKernel()

    await kernel.loadCoreState()

    expect(kernel.agentTunAvailable.value).toBe(false)
    expect(kernel.agentTunReason.value).toBe('no /dev/net/tun in container')
  })

  it('loadCoreState：首次按 active 播种，重复进入保留已选的已知版本，未知值回退 preferred', async () => {
    api.packages.list.mockResolvedValue({
      ...PACKAGES,
      installed: [{ version: 'v2.5.0', builtin: false }],
      active: 'v2.5.0'
    })
    const kernel = createKernel()
    await kernel.loadCoreState()
    expect(kernel.coreVerSelect.value).toBe('v2.5.0')

    // v2.6.4 在 available 内（已知），再次加载不应覆盖用户选择
    kernel.coreVerSelect.value = 'v2.6.4'
    await kernel.loadCoreState()
    expect(kernel.coreVerSelect.value).toBe('v2.6.4')

    // 未知版本（既未安装也不在 available）回退到 preferred
    kernel.coreVerSelect.value = 'v9.9.9'
    await kernel.loadCoreState()
    expect(kernel.coreVerSelect.value).toBe('v2.5.0')
  })

  it('安装：install() 拿 taskId，1s 轮询进度并在 done 后重新拉清单', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-1')
    api.packages.task
      .mockResolvedValueOnce({
        id: 'task-1',
        version: 'v2.6.4',
        state: 'downloading',
        downloaded: 50,
        total: 100,
        error: null
      })
      .mockResolvedValueOnce({
        id: 'task-1',
        version: 'v2.6.4',
        state: 'done',
        downloaded: 100,
        total: 100,
        error: null
      })

    await kernel.handleInstallCore()
    expect(api.packages.install).toHaveBeenCalledWith('v2.6.4')
    expect(kernel.agentInstallBusy.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(api.packages.task).toHaveBeenCalledWith('task-1')
    expect(kernel.agentProgressPercent.value).toBe(50)

    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.agentTaskState.value).toBe('done')
    expect(api.packages.list).toHaveBeenCalledTimes(2)
    expect(api.toast.success).toHaveBeenCalledWith('newSettings.agentInstallDone')
  })

  it('安装失败：用 error.code 映射文案', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-2')
    api.packages.task.mockResolvedValue({
      id: 'task-2',
      version: 'v2.6.4',
      state: 'failed',
      downloaded: 0,
      total: 100,
      error: { code: 'checksum_mismatch', message: 'checksum mismatch' }
    })

    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.toast.error).toHaveBeenCalledWith(
      'newSettings.agentInstallFailed：agentError.checksum_mismatch'
    )
    expect(kernel.agentInstallBusy.value).toBe(false)
  })

  it('installAllowed=false：安装按钮逻辑直接拒绝，不调用 install', async () => {
    api.packages.list.mockResolvedValue({ ...PACKAGES, installAllowed: false })
    const kernel = createKernel()
    await kernel.loadCoreState()

    await kernel.handleInstallCore()

    expect(api.packages.install).not.toHaveBeenCalled()
    expect(api.toast.warning).toHaveBeenCalledWith('newSettings.agentInstallDisabled')
  })

  it('内置版本：删除入口不调用 remove', async () => {
    api.packages.list.mockResolvedValue({
      ...PACKAGES,
      installed: [{ version: 'v2.6.4', builtin: true }],
      active: 'v2.6.4'
    })
    const kernel = createKernel()
    await kernel.loadCoreState()

    await kernel.handleAgentRemoveCore()

    expect(api.packages.remove).not.toHaveBeenCalled()
  })

  it('非内置版本：remove 成功后重新拉清单', async () => {
    api.packages.list.mockResolvedValue({
      ...PACKAGES,
      installed: [{ version: 'v2.5.0', builtin: false }],
      active: 'v2.5.0'
    })
    api.packages.remove.mockResolvedValue(undefined)
    const kernel = createKernel()
    await kernel.loadCoreState()

    await kernel.handleAgentRemoveCore()

    expect(api.packages.remove).toHaveBeenCalledWith('v2.5.0')
    expect(api.toast.success).toHaveBeenCalledWith('newSettings.agentRemoveCoreSuccess')
    expect(api.packages.list).toHaveBeenCalledTimes(2)
  })

  it('取消安装：应答非终态时继续轮询，直到工作线程写入 canceled', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-3')
    api.packages.task.mockResolvedValue({
      id: 'task-3',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.agentInstallBusy.value).toBe(true)

    // 真实服务端：cancel 只受理，快照仍是 downloading
    api.packages.cancelTask.mockResolvedValue({
      id: 'task-3',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleCancelAgentTask()
    expect(kernel.agentCancelRequested.value).toBe(true)
    expect(kernel.agentInstallBusy.value).toBe(true)
    expect(api.toast.info).toHaveBeenCalledWith('newSettings.agentInstallCanceling')

    const callsAfterCancel = api.packages.task.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.packages.task.mock.calls.length).toBe(callsAfterCancel + 1)

    // 工作线程写入终态后由轮询收尾
    api.packages.task.mockResolvedValue({
      id: 'task-3',
      version: 'v2.6.4',
      state: 'canceled',
      downloaded: 10,
      total: 100,
      error: null
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.agentTaskState.value).toBe('canceled')
    expect(kernel.agentInstallBusy.value).toBe(false)
    expect(kernel.agentCancelRequested.value).toBe(false)
    expect(api.toast.info).toHaveBeenCalledWith('newSettings.agentInstallCanceled')

    const callsAtTerminal = api.packages.task.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.packages.task.mock.calls.length).toBe(callsAtTerminal)
  })

  it('取消安装：应答已是终态时立刻停止轮询，只提示已取消', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-5')
    api.packages.task.mockResolvedValue({
      id: 'task-5',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)

    api.packages.cancelTask.mockResolvedValue({
      id: 'task-5',
      version: 'v2.6.4',
      state: 'canceled',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleCancelAgentTask()
    expect(kernel.agentTaskState.value).toBe('canceled')
    expect(kernel.agentInstallBusy.value).toBe(false)
    expect(kernel.agentCancelRequested.value).toBe(false)
    expect(api.toast.info).toHaveBeenCalledWith('newSettings.agentInstallCanceled')
    expect(api.toast.info).not.toHaveBeenCalledWith('newSettings.agentInstallCanceling')

    const calls = api.packages.task.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.packages.task.mock.calls.length).toBe(calls)
  })

  it('取消安装：轮询先到终态时，迟到的取消应答不会把面板拉回安装中', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-7')
    api.packages.task.mockResolvedValue({
      id: 'task-7',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)

    let resolveCancel: (view: unknown) => void = () => {}
    api.packages.cancelTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        })
    )
    const pending = kernel.handleCancelAgentTask()

    api.packages.task.mockResolvedValue({
      id: 'task-7',
      version: 'v2.6.4',
      state: 'canceled',
      downloaded: 10,
      total: 100,
      error: null
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(kernel.agentTaskState.value).toBe('canceled')

    resolveCancel({
      id: 'task-7',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await pending

    expect(kernel.agentTaskState.value).toBe('canceled')
    expect(kernel.agentInstallBusy.value).toBe(false)
    expect(kernel.agentCancelRequested.value).toBe(false)
  })

  it('取消安装：轮询中途失败时停止轮询并恢复可再次取消', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-8')
    api.packages.task.mockResolvedValue({
      id: 'task-8',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)

    api.packages.cancelTask.mockResolvedValue({
      id: 'task-8',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleCancelAgentTask()
    expect(kernel.agentCancelRequested.value).toBe(true)

    api.packages.task.mockRejectedValue(new Error('network'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(kernel.agentCancelRequested.value).toBe(false)
    expect(kernel.agentInstallBusy.value).toBe(true)
    const calls = api.packages.task.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.packages.task.mock.calls.length).toBe(calls)
  })

  it('取消安装：cancelTask 失败时用专用文案提示，轮询与任务状态不受影响', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-6')
    api.packages.task.mockResolvedValue({
      id: 'task-6',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)

    api.packages.cancelTask.mockRejectedValue(new Error('boom'))
    await kernel.handleCancelAgentTask()

    expect(api.toast.error).toHaveBeenCalledWith(
      expect.stringContaining('newSettings.agentInstallCancelFail')
    )
    expect(kernel.agentCancelRequested.value).toBe(false)
    expect(kernel.agentInstallBusy.value).toBe(true)

    const calls = api.packages.task.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.packages.task.mock.calls.length).toBe(calls + 1)
  })

  it('关闭设置：stopAgentPoll 只停轮询，不再拉任务也不标记失败', async () => {
    vi.useFakeTimers()
    const kernel = createKernel()
    await kernel.loadCoreState()

    api.packages.install.mockResolvedValue('task-4')
    api.packages.task.mockResolvedValue({
      id: 'task-4',
      version: 'v2.6.4',
      state: 'downloading',
      downloaded: 10,
      total: 100,
      error: null
    })
    await kernel.handleInstallCore()
    await vi.advanceTimersByTimeAsync(1000)
    const calls = api.packages.task.mock.calls.length

    kernel.stopAgentPoll()
    await vi.advanceTimersByTimeAsync(5000)

    expect(api.packages.task.mock.calls.length).toBe(calls)
    expect(api.toast.error).not.toHaveBeenCalled()
    expect(api.packages.list).toHaveBeenCalledTimes(1)
    expect(kernel.agentTaskState.value).toBe('downloading')
  })
})
