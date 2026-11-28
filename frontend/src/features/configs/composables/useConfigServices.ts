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
import { resolveServiceStatuses, clearServiceStatusCache } from '@/shared/lib/serviceStatusCache'
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
      case 'starting':
        return t('newCommon.starting')
      case 'stopped':
        return t('newConfig.stoppedStatus')
      case 'stopping':
        return t('newCommon.stopping')
      case 'paused':
        return t('newCommon.paused')
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

  // 手动重新检测：忽略 TTL 缓存，用于“未知/启动中/停止中”状态恢复
  const refreshServiceStatus = async () => {
    if (!selectedConfig.value) return
    const name = selectedConfig.value.configFileName
    // 先回到“检测中”，避免点击后长时间仍显示旧的未知状态
    serviceStatusMap.value.delete(name)
    await loadServiceStatus(name, true)
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
    const configName = selectedConfig.value.configFileName
    let ok: boolean
    try {
      ok = await startService(configName)
    } catch {
      ok = false
    }
    // 无论命令成败都以服务真实状态为准：慢启动超过等待窗口时仍可能是 starting
    await loadServiceStatus(configName, true)
    if (ok) {
      toast(t('newConfig.svcStartSuccess'), 'success')
    } else if (currentServiceStatus.value === 'starting') {
      toast(t('newConfig.svcStartPending'), 'warning', 5000)
    } else {
      toast(t('newConfig.svcStartFail'), 'error')
    }
    // 服务启停会改变内核运行状态：强制重扫，避免等待后端扫描周期
    await updateRunningList({ force: true })
  }

  // 停止 Windows 服务（停止后提示内核已断开）
  const handleStopService = async () => {
    if (!selectedConfig.value) return
    const configName = selectedConfig.value.configFileName
    let ok: boolean
    try {
      ok = await stopService(configName)
    } catch {
      ok = false
    }
    await loadServiceStatus(configName, true)
    if (ok) {
      toast(t('newConfig.svcStopSuccess'), 'success')
      toast(t('newConfig.svcStopHint'), 'success', 3000)
    } else if (currentServiceStatus.value === 'stopping') {
      toast(t('newConfig.svcStopPending'), 'warning', 5000)
    } else {
      toast(t('newConfig.svcStopFail'), 'error')
    }
    // 服务启停会改变内核运行状态：强制重扫，避免等待后端扫描周期
    await updateRunningList({ force: true })
  }

  // 卸载 Windows 服务（二次确认后执行）；状态未知时走显式清理通道
  const handleUninstallService = async () => {
    if (!selectedConfig.value) return
    const configName = selectedConfig.value.configFileName
    const unknown = currentServiceStatus.value === 'unknown'
    const transitioning =
      currentServiceStatus.value === 'starting' || currentServiceStatus.value === 'stopping'
    const ok = await options.confirm(
      t(unknown ? 'newConfig.cleanupServiceTitle' : 'newConfig.uninstallTitle'),
      t(unknown ? 'newConfig.cleanupServiceMsg' : 'newConfig.uninstallMsg', {
        name: configName
      })
    )
    if (!ok) return
    try {
      const result = await uninstallService(
        configName,
        unknown || transitioning ? { force: true } : undefined
      )
      if (result) {
        // 卸载成功后立即落定，避免状态查询仍失败时回退成“未知”
        applyServiceStatus(configName, 'notInstalled')
        clearServiceStatusCache(SERVICE_STATUS_SCOPE, configName)
        toast(t('newConfig.svcUninstallSuccess'), 'success')
        await updateRunningList({ force: true })
      } else {
        toast(t('newConfig.svcUninstallFail'), 'error')
        await loadServiceStatus(configName, true)
      }
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
    refreshServiceStatus,
    refreshServiceStatuses,
    openServiceDialog,
    handleServiceInstalled,
    handleStartService,
    handleStopService,
    handleUninstallService
  }
}
