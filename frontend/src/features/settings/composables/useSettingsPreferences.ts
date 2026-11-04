/**
 * 通用设置：刷新间隔本地校验、自动运行默认项与默认服务安装方式。
 * 由设置弹窗统一实例化，经 provide/inject 交给通用分类子组件共享。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEasyTierStore } from '@/shared/store/easytier'

export function useSettingsPreferences() {
  const store = useEasyTierStore()
  const { t } = useI18n()

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

  // 自动运行设置：开关写回 store，关闭时同步清除已选配置，并持久化到 localStorage
  const handleAutoRunToggle = (value: boolean) => {
    store.autoRunNetworkSetting = value
    localStorage.setItem('settings.autoRunNetwork', String(value))
    if (!value) {
      store.autoRunConfigName = ''
      localStorage.removeItem('settings.autoRunConfigName')
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
    if (val) {
      localStorage.setItem('settings.autoRunConfigName', val)
    } else {
      localStorage.removeItem('settings.autoRunConfigName')
    }
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
    autoRunConfigOptions,
    handleAutoRunConfigSelect,
    serviceMethodOptions,
    handleServiceMethodSelect
  }
}
