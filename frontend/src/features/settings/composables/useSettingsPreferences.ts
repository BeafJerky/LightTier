/**
 * 通用设置：刷新间隔本地校验、自动运行默认项与默认服务安装方式。
 * 由设置弹窗统一实例化，经 provide/inject 交给通用分类子组件共享。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEasyTierStore } from '@/shared/store/easytier'
import { backendMode, backendSettings } from '@/shared/platform/backend'

export function useSettingsPreferences() {
  const store = useEasyTierStore()
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

  // 自动运行设置：写回 store（Pinia 持久化为唯一真源），关闭时同步清除已选配置
  // agent 模式额外落到服务端设置（`autoStartLastRunning`），由 Agent 在下次启动时恢复
  const handleAutoRunToggle = (value: boolean) => {
    store.autoRunNetworkSetting = value
    if (!value) {
      store.autoRunConfigName = ''
    }
    if (isAgentMode) {
      backendSettings()
        .put({ autoStartLastRunning: value })
        .catch((e: unknown) => console.error('保存自动运行设置失败:', e))
    }
  }

  // agent：打开设置时以服务端设置为准（浏览器本地持久化不跨设备）
  const loadAgentSettings = async () => {
    if (!isAgentMode) return
    try {
      const settings = await backendSettings().get()
      store.autoRunNetworkSetting = settings.autoStartLastRunning
    } catch (e) {
      console.error('读取设置失败:', e)
    }
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
    refreshInput,
    refreshError,
    syncRefreshInput,
    commitRefreshInterval,
    handleAutoRunToggle,
    loadAgentSettings,
    autoRunConfigOptions,
    handleAutoRunConfigSelect,
    serviceMethodOptions,
    handleServiceMethodSelect
  }
}
