/**
 * 通用设置：刷新间隔本地校验、自动运行默认项、默认服务安装方式、
 * 桌面启动最小化与 agent 服务端运行时设置（noTun / logLevel）。
 * 由设置弹窗统一实例化，经 provide/inject 交给通用分类子组件共享。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useEasyTierStore } from '@/shared/store/easytier'
import { backendMode, backendSettings } from '@/shared/platform/backend'

const AGENT_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const
type AgentLogLevel = (typeof AGENT_LOG_LEVELS)[number]

const normalizeAgentLogLevel = (value: string): AgentLogLevel =>
  (AGENT_LOG_LEVELS as readonly string[]).includes(value) ? (value as AgentLogLevel) : 'info'

const readMinimizeOnStart = (): boolean => {
  try {
    return localStorage.getItem('settings.minimizeOnStart') === 'true'
  } catch {
    return false
  }
}

export function useSettingsPreferences() {
  const store = useEasyTierStore()
  const toast = useCreamToast()
  const { t } = useI18n()
  const isAgentMode = backendMode() === 'agent'

  // 刷新间隔：本地文本承接输入，失焦/回车校验 1–60 的整数后再写回 store；
  // 非法输入保留原样并提示，不再逐键静默 clamp（UX-303）
  const refreshInput = ref(String(store.refreshInterval || 3))
  const refreshError = ref('')
  const syncRefreshInput = () => {
    refreshInput.value = String(store.refreshInterval || 3)
    refreshError.value = ''
  }
  const commitRefreshInterval = () => {
    const raw = refreshInput.value.trim()
    const val = Number(raw)
    if (!raw || !Number.isInteger(val) || val < 1 || val > 60) {
      refreshError.value = t('newSettings.refreshIntervalInvalid')
      return
    }
    refreshError.value = ''
    store.setRefreshInterval(val)
    refreshInput.value = String(val)
  }

  // 桌面启动最小化：App.vue 直接读取同一 localStorage 键
  const minimizeOnStart = ref(readMinimizeOnStart())
  const setMinimizeOnStart = (value: boolean) => {
    minimizeOnStart.value = value
    try {
      localStorage.setItem('settings.minimizeOnStart', value ? 'true' : 'false')
    } catch {
      /* 存储不可用时仅保持本次会话状态 */
    }
  }

  const agentNoTun = ref(false)
  const agentLogLevel = ref<AgentLogLevel>('info')
  const agentSettingsBusy = ref(false)
  const agentSettingsError = ref('')
  const logLevelOptions = computed(() => [
    { label: t('newSettings.logLevelError'), value: 'error' },
    { label: t('newSettings.logLevelWarn'), value: 'warn' },
    { label: t('newSettings.logLevelInfo'), value: 'info' },
    { label: t('newSettings.logLevelDebug'), value: 'debug' },
    { label: t('newSettings.logLevelTrace'), value: 'trace' }
  ])

  // agent 服务端写失败时恢复 UI 原值并提示，避免“看起来已保存”
  const saveAgentSetting = async (
    patch: Parameters<ReturnType<typeof backendSettings>['put']>[0],
    revert: () => void
  ) => {
    agentSettingsBusy.value = true
    try {
      await backendSettings().put(patch)
      agentSettingsError.value = ''
    } catch (e) {
      revert()
      agentSettingsError.value = t('newSettings.agentSettingsSaveFail')
      toast.error(agentSettingsError.value)
      console.error('保存 agent 设置失败:', e)
    } finally {
      agentSettingsBusy.value = false
    }
  }

  // 自动运行设置：写回 store（Pinia 持久化为唯一真源），关闭时同步清除已选配置。
  // agent 只持久化 autoStartLastRunning（恢复上次运行配置），配置名选择不适用。
  const handleAutoRunToggle = (value: boolean) => {
    if (isAgentMode && agentSettingsBusy.value) return
    const previousSetting = store.autoRunNetworkSetting
    const previousConfig = store.autoRunConfigName
    store.autoRunNetworkSetting = value
    if (!value) {
      store.autoRunConfigName = ''
    }
    if (isAgentMode) {
      void saveAgentSetting({ autoStartLastRunning: value }, () => {
        store.autoRunNetworkSetting = previousSetting
        store.autoRunConfigName = previousConfig
      })
    }
  }

  // agent：打开设置时以服务端设置为准（浏览器本地持久化不跨设备）
  const loadAgentSettings = async () => {
    if (!isAgentMode) return
    agentSettingsBusy.value = true
    try {
      const settings = await backendSettings().get()
      store.autoRunNetworkSetting = settings.autoStartLastRunning
      agentNoTun.value = settings.noTun
      agentLogLevel.value = normalizeAgentLogLevel(settings.logLevel)
      agentSettingsError.value = ''
    } catch (e) {
      agentSettingsError.value = t('newSettings.agentSettingsLoadFail')
      console.error('读取设置失败:', e)
    } finally {
      agentSettingsBusy.value = false
    }
  }

  const handleAgentNoTunToggle = (value: boolean) => {
    if (agentSettingsBusy.value) return
    const previous = agentNoTun.value
    agentNoTun.value = value
    void saveAgentSetting({ noTun: value }, () => {
      agentNoTun.value = previous
    })
  }

  const handleAgentLogLevelSelect = (value: string | number | null) => {
    if (agentSettingsBusy.value) return
    const next = normalizeAgentLogLevel(String(value ?? 'info'))
    const previous = agentLogLevel.value
    agentLogLevel.value = next
    void saveAgentSetting({ logLevel: next }, () => {
      agentLogLevel.value = previous
    })
  }

  // 自动运行配置下拉：空字符串表示“上次运行的配置”
  const autoRunConfigOptions = computed(() => [
    { label: t('newSettings.lastRunConfig'), value: '' },
    ...store.configList.map((item) => ({
      label: item.configFileName,
      value: item.configFileName
    }))
  ])

  // 选择/清除自动运行的默认配置（空字符串表示“上次运行的配置”）
  const handleAutoRunConfigChange = (val: string) => {
    store.autoRunConfigName = val
  }
  const handleAutoRunConfigSelect = (value: string | number | null) => {
    handleAutoRunConfigChange(value == null ? '' : String(value))
  }

  // 默认服务安装方式下拉
  const serviceMethodOptions = computed(() => [
    { label: 'NSSM', value: 'nssm' },
    { label: t('newWebConfig.officialCli'), value: 'official' }
  ])
  const handleServiceMethodSelect = (value: string | number | null) => {
    store.defaultServiceInstallMethod = value === 'nssm' ? 'nssm' : 'official'
  }

  return {
    isAgentMode,
    refreshInput,
    refreshError,
    syncRefreshInput,
    commitRefreshInterval,
    minimizeOnStart,
    setMinimizeOnStart,
    agentNoTun,
    agentLogLevel,
    agentSettingsBusy,
    agentSettingsError,
    logLevelOptions,
    handleAutoRunToggle,
    loadAgentSettings,
    handleAgentNoTunToggle,
    handleAgentLogLevelSelect,
    autoRunConfigOptions,
    handleAutoRunConfigSelect,
    serviceMethodOptions,
    handleServiceMethodSelect
  }
}
