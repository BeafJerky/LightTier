/**
 * Windows 服务面板：服务状态缓存、安装/启停/卸载与安装前兼容性确认。
 * Android 无服务模型，面板整体隐藏，状态检测直接跳过。
 */
import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ServiceInstallConfig } from '@/entities/config/formTypes'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useMockData } from '@/shared/platform/mockData'
import { resolveServiceStatuses } from '@/shared/lib/serviceStatusCache'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import { useConfigCompatCheck } from '@/shared/composables/useConfigCompatCheck'

interface UseConfigServicesOptions {
  selectedConfig: Ref<RunningItem | null>
  confirm: (title: string, message: string) => Promise<boolean>
  isAndroidPlatform: boolean
}

// 服务状态缓存按 scope 存于 shared/lib：跨页面挂载复用，避免每次进入配置页重跑全部服务查询
const SERVICE_STATUS_SCOPE = 'config'

export function useConfigServices(options: UseConfigServicesOptions) {
  const { selectedConfig, isAndroidPlatform } = options
  const easyTierStore = useEasyTierStore()
  const { show: toast } = useCreamToast()
  const { t } = useI18n()
  const { checkService, installService, uninstallService, startService, stopService } =
    useMockData()
  const { updateRunningList } = useRunningListSync()
  const { getCompatIssues } = useConfigCompatCheck()

  const svcDialogVisible = ref(false)
  const svcConfigName = ref('')
  const serviceStatusMap = ref<Map<string, string>>(new Map())

  const currentServiceStatus = computed(() => {
    if (!selectedConfig.value) return ''
    // 未返回结果前保持空串（UI 显示“检测中”），不能默认成“未安装”误导用户去重复安装
    return serviceStatusMap.value.get(selectedConfig.value.configFileName) || ''
  })

  // 将 useMockData 返回的原始状态 key 映射为国际化字符串
  const mapServiceStatus = (key: string): string => {
    switch (key) {
      case 'running':
        return t('newCommon.running')
      case 'stopped':
        return t('newConfig.stoppedStatus')
      case 'stopping':
        return t('newCommon.stopping')
      case 'notInstalled':
        return t('newConfig.notInstalled')
      case 'unknown':
        return t('newSettings.unknown')
      default:
        return key
    }
  }

  const formatCompatIssues = (issues: { code: string; params?: Record<string, any> }[]): string =>
    issues.map((i) => t(`coreCompat.${i.code}`, i.params || {})).join('\n')

  const applyServiceStatus = (configFileName: string, status: string) => {
    serviceStatusMap.value.set(configFileName, status)
  }

  const loadServiceStatus = async (configFileName: string, force = false) => {
    // Windows 服务专属能力；Android 无此模型（服务面板整体隐藏）
    if (isAndroidPlatform) return
    // 检测失败由 resolveServiceStatuses 回传 unknown 且不写缓存：
    // 不能伪装成“未安装”，unknown 会同时阻止删除，避免遗留孤儿服务
    await resolveServiceStatuses(
      SERVICE_STATUS_SCOPE,
      [configFileName],
      checkService,
      applyServiceStatus,
      { force }
    )
  }

  // 列表加载后刷新全部服务状态：优先回传 TTL 缓存，缺失项限流并发检测，不阻塞列表渲染
  const refreshServiceStatuses = () => {
    if (isAndroidPlatform) return
    void resolveServiceStatuses(
      SERVICE_STATUS_SCOPE,
      easyTierStore.configList.map((c) => c.configFileName),
      checkService,
      applyServiceStatus
    )
  }

  // 打开服务安装弹窗（选择 nssm / 官方服务等安装方式）
  const openServiceDialog = () => {
    if (!selectedConfig.value) return
    svcConfigName.value = selectedConfig.value.configFileName
    svcDialogVisible.value = true
  }

  // 服务安装完成回调：安装后刷新该配置的服务状态
  const handleServiceInstalled = async (
    configName: string,
    serviceOptions: ServiceInstallConfig
  ) => {
    try {
      // 服务会以当前内核启动该配置：存在版本错误时先提示，避免装完即失败
      const errors = (await getCompatIssues(`${configName}.toml`)).filter(
        (i) => i.level === 'error'
      )
      if (errors.length) {
        const confirmed = await options.confirm(
          t('newConfig.compatBlockTitle'),
          t('newConfig.compatBlockMsg', {
            name: configName,
            issues: formatCompatIssues(errors)
          })
        )
        if (!confirmed) return
      }
      // 安装方式参数随当前内核版本适配（v2.7.0+ 使用 --core-args），避免重复探测
      const ok = await installService(configName, {
        ...serviceOptions,
        coreVersion: easyTierStore.detectedCoreVersion
      })
      if (ok) {
        toast(t('newConfig.svcInstallSuccess'), 'success')
      } else {
        toast(t('newConfig.svcInstallFail'), 'error')
      }
      await loadServiceStatus(configName, true)
    } catch {
      toast(t('newConfig.svcInstallFail'), 'error')
    }
  }

  // 启动 Windows 服务
  const handleStartService = async () => {
    if (!selectedConfig.value) return
    try {
      const ok = await startService(selectedConfig.value.configFileName)
      toast(
        ok ? t('newConfig.svcStartSuccess') : t('newConfig.svcStartFail'),
        ok ? 'success' : 'error'
      )
      await loadServiceStatus(selectedConfig.value.configFileName, true)
      // 服务启停会改变内核运行状态：强制重扫，避免等待后端扫描周期
      await updateRunningList({ force: true })
    } catch {
      toast(t('newConfig.svcStartFail'), 'error')
    }
  }

  // 停止 Windows 服务（停止后提示内核已断开）
  const handleStopService = async () => {
    if (!selectedConfig.value) return
    try {
      const ok = await stopService(selectedConfig.value.configFileName)
      toast(
        ok ? t('newConfig.svcStopSuccess') : t('newConfig.svcStopFail'),
        ok ? 'success' : 'error'
      )
      // 仅在真正停止后提示；失败时不再补一条“已停止”的成功 toast
      if (ok) toast(t('newConfig.svcStopHint'), 'success', 3000)
      await loadServiceStatus(selectedConfig.value.configFileName, true)
      // 服务启停会改变内核运行状态：强制重扫，避免等待后端扫描周期
      await updateRunningList({ force: true })
    } catch {
      toast(t('newConfig.svcStopFail'), 'error')
    }
  }

  // 卸载 Windows 服务（二次确认后执行）
  const handleUninstallService = async () => {
    if (!selectedConfig.value) return
    const ok = await options.confirm(
      t('newConfig.uninstallTitle'),
      t('newConfig.uninstallMsg', { name: selectedConfig.value.configFileName })
    )
    if (!ok) return
    try {
      const result = await uninstallService(selectedConfig.value.configFileName)
      toast(
        result ? t('newConfig.svcUninstallSuccess') : t('newConfig.svcUninstallFail'),
        result ? 'success' : 'error'
      )
      await loadServiceStatus(selectedConfig.value.configFileName, true)
    } catch {
      toast(t('newConfig.svcUninstallFail'), 'error')
    }
  }

  return {
    svcDialogVisible,
    svcConfigName,
    serviceStatusMap,
    currentServiceStatus,
    mapServiceStatus,
    loadServiceStatus,
    refreshServiceStatuses,
    openServiceDialog,
    handleServiceInstalled,
    handleStartService,
    handleStopService,
    handleUninstallService
  }
}
