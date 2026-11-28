import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mode: 'native' as 'native' | 'agent' | 'mock',
  store: {
    refreshInterval: 3,
    autoRunNetworkSetting: false,
    autoRunConfigName: '',
    configList: [] as { configFileName: string }[],
    defaultServiceInstallMethod: 'nssm' as 'nssm' | 'official',
    defaultEnableAutostart: true,
    setRefreshInterval(value: number) {
      this.refreshInterval = value
    }
  },
  get: vi.fn(),
  put: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  storage: new Map<string, string>()
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/ui/useCreamToast', () => ({ useCreamToast: () => mocks.toast }))
vi.mock('@/shared/store/easytier', () => ({ useEasyTierStore: () => mocks.store }))
vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => mocks.mode,
  backendSettings: () => ({ get: mocks.get, put: mocks.put })
}))

import { useSettingsPreferences } from '@/features/settings/composables/useSettingsPreferences'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useSettingsPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode = 'native'
    mocks.store.refreshInterval = 3
    mocks.store.autoRunNetworkSetting = false
    mocks.store.autoRunConfigName = ''
    mocks.store.configList = []
    mocks.store.defaultServiceInstallMethod = 'nssm'
    mocks.store.defaultEnableAutostart = true
    mocks.get.mockResolvedValue({
      autoStartLastRunning: false,
      noTun: false,
      logLevel: 'info',
      coreMirror: ''
    })
    mocks.put.mockResolvedValue(undefined)
    mocks.storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mocks.storage.get(key) ?? null,
      setItem: (key: string, value: string) => mocks.storage.set(key, value),
      removeItem: (key: string) => mocks.storage.delete(key),
      clear: () => mocks.storage.clear()
    })
  })

  it('刷新间隔非法值不写回，合法值写回', () => {
    const prefs = useSettingsPreferences()
    prefs.refreshInput.value = 'abc'
    prefs.commitRefreshInterval()
    expect(prefs.refreshError.value).toBe('newSettings.refreshIntervalInvalid')
    expect(mocks.store.refreshInterval).toBe(3)

    prefs.refreshInput.value = '12'
    prefs.commitRefreshInterval()
    expect(prefs.refreshError.value).toBe('')
    expect(mocks.store.refreshInterval).toBe(12)
  })

  it('启动最小化写入与启动逻辑一致的 localStorage 键', () => {
    const prefs = useSettingsPreferences()
    prefs.setMinimizeOnStart(true)
    expect(mocks.storage.get('settings.minimizeOnStart')).toBe('true')
    prefs.setMinimizeOnStart(false)
    expect(mocks.storage.get('settings.minimizeOnStart')).toBe('false')
    expect(useSettingsPreferences().minimizeOnStart.value).toBe(false)
  })

  it('agent 自动运行保存失败时回滚并提示', async () => {
    mocks.mode = 'agent'
    mocks.put.mockRejectedValue(new Error('network'))
    const prefs = useSettingsPreferences()
    mocks.store.autoRunConfigName = 'old-config'

    prefs.handleAutoRunToggle(true)
    await flush()

    expect(mocks.store.autoRunNetworkSetting).toBe(false)
    expect(mocks.store.autoRunConfigName).toBe('old-config')
    expect(mocks.toast.error).toHaveBeenCalledWith('newSettings.agentSettingsSaveFail')
  })

  it('native 自动运行不调用服务端', async () => {
    const prefs = useSettingsPreferences()
    prefs.handleAutoRunToggle(true)
    await flush()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.store.autoRunNetworkSetting).toBe(true)
  })

  it('agent 加载 autoRun/noTun/logLevel', async () => {
    mocks.mode = 'agent'
    mocks.get.mockResolvedValue({
      autoStartLastRunning: true,
      noTun: true,
      logLevel: 'debug',
      coreMirror: ''
    })
    const prefs = useSettingsPreferences()
    await prefs.loadAgentSettings()

    expect(mocks.store.autoRunNetworkSetting).toBe(true)
    expect(prefs.agentNoTun.value).toBe(true)
    expect(prefs.agentLogLevel.value).toBe('debug')
  })

  it('agent noTun 保存失败时回滚', async () => {
    mocks.mode = 'agent'
    mocks.put.mockRejectedValue(new Error('network'))
    const prefs = useSettingsPreferences()

    prefs.handleAgentNoTunToggle(true)
    await flush()

    expect(prefs.agentNoTun.value).toBe(false)
    expect(prefs.agentSettingsError.value).toBe('newSettings.agentSettingsSaveFail')
  })

  it('agent 日志级别保存失败时回滚', async () => {
    mocks.mode = 'agent'
    mocks.put.mockRejectedValue(new Error('network'))
    const prefs = useSettingsPreferences()

    prefs.handleAgentLogLevelSelect('trace')
    await flush()

    expect(prefs.agentLogLevel.value).toBe('info')
    expect(prefs.agentSettingsError.value).toBe('newSettings.agentSettingsSaveFail')
  })
})
