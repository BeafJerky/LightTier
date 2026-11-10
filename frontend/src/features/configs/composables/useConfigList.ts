/**
 * 配置管理页状态：列表搜索、详情 TOML 解析、启停、退出节点路由、Windows 服务与配置增删改。
 *
 * 平台差异：
 * - 桌面：编辑/新增走弹窗（EditDialog / ServiceDialog），宽屏左右分栏并默认选中上次运行配置；
 * - Android：编辑/新增跳二级路由页面，窄屏列表与详情互斥展示，内核在应用进程内运行
 *   （无 pid），同一时刻仅一个实例，启动前二次确认“停旧起新”；
 * - Windows 服务面板与退出节点路由仅非 Android 环境展示；详情读取失败进入错误态。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import * as toml from 'smol-toml'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import {
  SECURITY_FIELD_DEFS,
  ADVANCED_FLAG_DEFS,
  ADVANCED_TOP_SWITCH_DEFS,
  ADVANCED_TOP_TEXT_DEFS
} from '@/entities/config/defaultData'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useMockData } from '@/shared/platform/mockData'
import { useWideLandscape } from '@/shared/composables/useWideLandscape'
import { isAndroid } from '@/shared/platform/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { resourceDir, join } from '@tauri-apps/api/path'
import { openPath } from '@/shared/platform/fileUtil'
import { getErrorMessage } from '@/shared/lib/error'
import {
  setExitRoute,
  clearExitRoute,
  checkExitRouteResidue,
  cleanExitRouteResidue,
  applyExitRouteFromFile
} from '@/shared/platform/routeUtil'
import { useTrendBuffer } from '@/shared/composables/useTrendBuffer'
import { useInstanceActions } from '@/shared/composables/useInstanceActions'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import { isExitRouteEnabled, setExitRouteEnabled } from '@/entities/config/lighttierConfigUtil'
import { useConfigDetail } from './useConfigDetail'
import { useConfigServices } from './useConfigServices'

interface UseConfigListOptions {
  /** 页面级自定义确认弹窗（由壳组件提供，Promise<boolean>） */
  confirm: (title: string, message: string) => Promise<boolean>
}

export function useConfigList(options: UseConfigListOptions) {
  const easyTierStore = useEasyTierStore()
  // Android 平台：无 Windows 服务/系统路由工具，内核进程内运行（无 pid）
  const isAndroidPlatform = isAndroid()
  // 横屏宽屏：列表与详情左右分栏，选中走本地状态而非详情路由
  const isWideLandscape = useWideLandscape()
  // 启动进行中标志：避免连点造成重复启动/路由重复下发
  const isStarting = ref(false)
  // 当前选中配置（列表卡片数据）
  const selectedConfig = ref<RunningItem | null>(null)
  // 退出节点路由与目录操作仅在桌面 Tauri 环境可用（withGlobalTauri 已关闭，统一用 isTauri()）
  const isTauri = isTauriRuntime() && !isAndroidPlatform

  const { show: toast } = useCreamToast()
  const { clearTrend } = useTrendBuffer()
  // 文件/服务操作统一从 useMockData 获取：Tauri 环境走真实实现，浏览器 Mock 环境自动降级
  const { readFileContent, writeFileContent, deleteFileOrDir, checkService } = useMockData()
  const { t } = useI18n()
  const router = useRouter()
  const route = useRoute()

  // Android 详情为独立路由（列表/详情共用本组件），视图切换以路由为准
  const isAndroidDetailRoute = computed(
    () => isAndroidPlatform && route.name === 'NewConfigDetailView'
  )

  // 详情面板 flags：已知字段 key → i18n 标签（与编辑表单同源定义），未知 key 回退原文
  const FLAG_LABEL_KEY_MAP: Record<string, string> = {}
  for (const def of [
    ...SECURITY_FIELD_DEFS,
    ...ADVANCED_FLAG_DEFS,
    ...ADVANCED_TOP_SWITCH_DEFS,
    ...ADVANCED_TOP_TEXT_DEFS
  ]) {
    FLAG_LABEL_KEY_MAP[def.key] = def.labelKey
  }
  const flagLabel = (key: string): string => {
    const labelKey = FLAG_LABEL_KEY_MAP[key]
    return labelKey ? t(labelKey) : key
  }

  // ===== 配置编辑弹窗（仅桌面端；Android 走独立路由页面） =====
  const editVisible = ref(false)
  const editConfigName = ref('')
  const editTomlContent = ref('')
  const editDialogMode = ref<'add' | 'edit'>('edit')

  // ===== Windows 服务面板（仅非 Android） =====
  const {
    svcDialogVisible,
    svcConfigName,
    currentServiceStatus,
    mapServiceStatus,
    refreshServiceStatuses,
    openServiceDialog,
    handleServiceInstalled,
    handleStartService,
    handleStopService,
    handleUninstallService
  } = useConfigServices({ selectedConfig, confirm: options.confirm, isAndroidPlatform })

  // 配置名列表（用于新增时查重）
  const configNameList = computed(() => easyTierStore.configList.map((c) => c.configFileName))

  // 空列表（加载完成且无配置）：横屏分栏下无内容可展示，详情占位需隐藏
  const isListEmpty = computed(
    () => easyTierStore.configList.length === 0 && !easyTierStore.configListLoading
  )

  // ===== 列表与详情加载 =====
  const getRunning = (item: RunningItem) =>
    easyTierStore.runningList.some((i) => i.configFileName === item.configFileName)
  const getRunningItem = (item: RunningItem) =>
    easyTierStore.runningList.find((i) => i.configFileName === item.configFileName)
  const selectedRunning = computed(() =>
    selectedConfig.value ? getRunning(selectedConfig.value) : false
  )

  // 列表搜索：按配置名/文件名不区分大小写过滤；运行中优先且保持原加载顺序（稳定排序）
  const configSearch = ref('')
  // Android 软键盘的“搜索”键：收起键盘，避免遮挡筛选结果
  const blurSearchInput = (e: KeyboardEvent) => (e.target as HTMLInputElement).blur()
  const filteredConfigList = computed(() => {
    const keyword = configSearch.value.trim().toLowerCase()
    return easyTierStore.configList
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !keyword ||
          item.configFileName.toLowerCase().includes(keyword) ||
          (item.fileName || '').toLowerCase().includes(keyword)
      )
      .sort((a, b) => Number(getRunning(b.item)) - Number(getRunning(a.item)) || a.index - b.index)
      .map(({ item }) => item)
  })

  // 桌面端跨页跳转携带 ?name=<configFileName>：返回目标名并立即清除 query，
  // 避免后续刷新/外部刷新回调再次把选中项抢回旧目标（Android 的 name 是详情路由真源，不能清）
  const consumeRouteTargetName = (): string => {
    const name = typeof route.query.name === 'string' ? route.query.name : ''
    if (!name) return ''
    const query = { ...route.query }
    delete query.name
    void router.replace({ query })
    return name
  }

  // 运行时状态刷新（FAB 已负责文件加载）
  const refreshRuntimeState = async () => {
    await updateRunningList()
    // 窄屏（移动端）默认展示清单，不自动进入详情，由用户点卡片跳转；
    // Android 详情由路由驱动，不在此自动选中
    if (!isAndroidPlatform && easyTierStore.configList.length > 0) {
      // 显式目标（总览/监控跳转）优先且不受宽窄屏限制
      const requestedName = consumeRouteTargetName()
      const requested = requestedName
        ? easyTierStore.configList.find((c) => c.configFileName === requestedName)
        : undefined
      if (requested) {
        await selectConfig(requested)
      } else if (window.innerWidth > 900) {
        const last = easyTierStore.getLastRunConfigName()
        const target =
          (last ? easyTierStore.configList.find((c) => c.configFileName === last) : undefined) ||
          easyTierStore.configList[0]
        if (target) await selectConfig(target)
      }
    }
    refreshServiceStatuses()
  }

  // 选中配置卡片：加载详情、重置路由筛选，并记录选择（供下次进入页面恢复）
  const selectConfig = async (item: RunningItem) => {
    // Android 横屏分栏：列表常驻，本地选中即可（不跳详情路由，保留根工具栏与底栏）
    if (isAndroidPlatform && isWideLandscape.value) {
      selectedConfig.value = item
      await loadConfigDetail(item)
      easyTierStore.setLastSelectedConfig(item)
      return
    }
    // Android：先进入详情路由，由 syncDetailFromRoute 统一加载，避免重复请求
    if (isAndroidPlatform && !isAndroidDetailRoute.value) {
      easyTierStore.setLastSelectedConfig(item)
      router.push({ name: 'NewConfigDetailView', query: { name: item.configFileName } })
      return
    }
    selectedConfig.value = item
    await loadConfigDetail(item)
    easyTierStore.setLastSelectedConfig(item)
  }

  // 详情读取与解析状态机（含过期请求丢弃）
  const {
    selectedDetail,
    detailState,
    detailError,
    detailErrorTitle,
    routeFilter,
    filteredRoutes,
    loadConfigDetail,
    resetDetail
  } = useConfigDetail({
    readFileContent,
    writeFileContent,
    isTauri,
    t
  })

  // 移动端 master-detail：从详情返回清单
  const closeDetail = () => {
    // 作废在飞的详情请求，避免关闭后又把内容写回
    resetDetail()
    selectedConfig.value = null
  }

  // Android 详情路由 → 页面状态：进入时加载对应配置，返回列表时清空详情
  const syncDetailFromRoute = async () => {
    if (!isAndroidPlatform) return
    if (!isAndroidDetailRoute.value) {
      closeDetail()
      return
    }
    const name = typeof route.query.name === 'string' ? route.query.name : ''
    if (!name) {
      router.replace({ name: 'NewConfigView' })
      return
    }
    if (!easyTierStore.configListLoaded) await easyTierStore.loadConfigFiles()
    const item = easyTierStore.configList.find((c) => c.configFileName === name)
    if (!item) {
      // 列表仍在加载时不做“配置不存在”判定，加载完成后由 configListLoaded 监听重试
      if (!easyTierStore.configListLoaded) return
      toast(t('newConfig.configNotFound'), 'warning')
      router.replace({ name: 'NewConfigView' })
      return
    }
    selectedConfig.value = item
    await loadConfigDetail(item)
    easyTierStore.setLastSelectedConfig(item)
  }

  // 路由切换（系统返回键 / 直接打开详情）时同步详情态
  watch(
    () => [route.name, route.query.name],
    (next, prev) => {
      if (!isAndroidPlatform) return
      const [name] = next
      const [prevName] = prev
      if (name !== 'NewConfigDetailView' && prevName !== 'NewConfigDetailView') return
      void syncDetailFromRoute()
    }
  )
  // 配置列表加载完成（深链打开详情时列表可能滞后）后重试同步
  watch(
    () => easyTierStore.configListLoaded,
    (loaded) => {
      if (loaded && isAndroidDetailRoute.value && !selectedConfig.value) {
        void syncDetailFromRoute()
      }
    }
  )

  // 错误态重试 / 打开配置目录（桌面）
  const retryDetail = async () => {
    if (!selectedConfig.value) return
    await loadConfigDetail(selectedConfig.value)
  }
  const openConfigDir = async () => {
    if (!isTauri) return
    try {
      const resDir = await resourceDir()
      const opened = await openPath(await join(resDir, CONFIG_PATH))
      if (!opened) toast(t('newConfig.openDirFail'), 'error')
    } catch {
      toast(t('newConfig.openDirFail'), 'error')
    }
  }

  // 运行列表同步统一走 shared 组合式函数
  const { updateRunningList } = useRunningListSync()

  // ===== 启动 / 停止 =====
  const { startInstance, stopInstance } = useInstanceActions({
    confirm: options.confirm,
    // 配置页保留原有文案（总览页使用 compatBlockConfirm）
    compatMessageKey: 'newConfig.compatBlockMsg',
    // 5.9：若配置启用退出路由标记，启动成功后自动配置路由
    afterStart: async (item) => {
      if (isTauri) await applyExitRouteAfterStart(item)
    },
    exitRouteGuard: () => isTauri
  })

  // 启动内核实例：预检/停旧起新/失败回滚由 useInstanceActions 统一处理，此处只做连点防护
  const startAction = async (item: RunningItem) => {
    if (!item.fileName || isStarting.value) return
    isStarting.value = true
    try {
      await startInstance(item)
    } catch {
      /* 失败与取消已在 useInstanceActions 内提示 */
    } finally {
      isStarting.value = false
    }
  }

  // 停止内核实例：Android 停 VPN+内核，桌面结束子进程；成功后恢复跃点并清除该配置的退出路由
  const stopAction = (item: RunningItem) => stopInstance(item)

  // ===== 生命周期 =====
  onMounted(async () => {
    // 深链打开详情时先等列表就绪，避免误判配置不存在
    if (!easyTierStore.configListLoaded) {
      await easyTierStore.loadConfigFiles()
    }
    // 注册到全局刷新回调：托盘/任务栏等外部动作触发时同步刷新本页
    easyTierStore.registerPageRefresh(refreshRuntimeState)
    await refreshRuntimeState()
    if (isAndroidPlatform) await syncDetailFromRoute()
  })

  onUnmounted(() => {
    easyTierStore.clearPageRefresh()
  })

  // ===== 配置增删改 =====
  const openEdit = async () => {
    if (!selectedConfig.value?.fileName) return
    // Android：进入独立编辑页面（移动端不使用弹窗）
    if (isAndroidPlatform) {
      router.push({
        name: 'NewConfigEditView',
        query: { name: selectedConfig.value.configFileName }
      })
      return
    }
    try {
      const raw = (await readFileContent(
        `${CONFIG_PATH}/${selectedConfig.value.fileName}`
      )) as string
      // 必须先切回 edit：openAdd 会把模式置为 add，若不复位会导致后续编辑按“新建”处理
      // （隐藏字段/重名校验/标题错误），也破坏“新建隐藏、存量警告”的版本适配策略
      editDialogMode.value = 'edit'
      editConfigName.value = selectedConfig.value.configFileName
      editTomlContent.value = raw
      editVisible.value = true
    } catch {
      toast(t('newConfig.readFail'), 'error')
    }
  }

  // 编辑/新增弹窗保存回调：备份旧文件 → 写入 TOML → 回调结果（失败时弹窗保持打开）
  const handleSaved = async (name: string, content: string, done: (ok: boolean) => void) => {
    const isAdd = editDialogMode.value === 'add'
    let backupFailed = false
    try {
      if (!isAdd) {
        // 覆盖前备份上一版；备份失败视为保存失败，避免用户误以为有回滚点
        try {
          const previous = (await readFileContent(`${CONFIG_PATH}/${name}.toml`)) as string
          await writeFileContent(`${CONFIG_PATH}/${name}.toml.bak`, previous)
        } catch {
          backupFailed = true
          throw new Error('backup failed')
        }
      }
      await writeFileContent(`${CONFIG_PATH}/${name}.toml`, content)
      // 写盘后必须等写盘前启动的在途加载结束再重读，否则新文件可能不在列表里
      await easyTierStore.reloadConfigFiles()
      if (easyTierStore.configList.some((c) => c.configFileName === name)) {
        toast(isAdd ? t('newCommon.addSuccess') : t('newCommon.saveSuccess'), 'success')
      } else {
        // 文件写入成功但列表没读到：单独提示，避免和写盘失败混淆
        console.warn('[config] saved but missing from list:', `${CONFIG_PATH}/${name}.toml`)
        toast(t('newCommon.savedButUnlisted'), 'warning')
      }
      await refreshRuntimeState()
      done(true)
    } catch (e) {
      console.error('[config] save failed:', `${CONFIG_PATH}/${name}.toml`, e)
      const detail = getErrorMessage(e)
      if (!isAdd && backupFailed) {
        toast(t('newConfig.backupFailed'), 'error')
      } else if (detail) {
        toast(
          t(isAdd ? 'newCommon.addFailDetail' : 'newCommon.saveFailDetail', { msg: detail }),
          'error',
          5000
        )
      } else {
        toast(t(isAdd ? 'newCommon.addFail' : 'newCommon.saveFail'), 'error')
      }
      done(false)
    }
  }

  // 新增配置
  const openAdd = () => {
    // Android：进入独立新增页面（移动端不使用弹窗）
    if (isAndroidPlatform) {
      router.push({ name: 'NewConfigAddView' })
      return
    }
    editDialogMode.value = 'add'
    editConfigName.value = ''
    // 初始模板不写 rpc_portal：v2.5.0 起该字段已从配置移除（桌面运行时由 CLI 参数注入，
    // v2.4.5 也可在表单中手动开启）；避免新建配置即触发“字段已失效”警告
    editTomlContent.value = 'hostname = ""\ninstance_name = ""\ndhcp = true\n'
    editVisible.value = true
  }

  // 删除配置
  const deleteSelectedConfig = async () => {
    if (!selectedConfig.value) return
    const target = selectedConfig.value
    // 运行中的配置不能直接删除：否则内核仍在运行但 UI 已无法停止，形成孤儿进程
    if (easyTierStore.runningList.some((r) => r.configFileName === target.configFileName)) {
      toast(t('newCommon.deleteBlockedRunning'), 'warning', 4000)
      return
    }
    // 已安装 Windows 服务时先卸载，避免服务指向被删除的 TOML。
    // 以实时检测为准：首屏状态尚未返回时，缓存里没有记录，不能据此放行删除。
    if (!isAndroidPlatform) {
      const svcStatus = await checkService(target.configFileName).catch(() => 'unknown')
      if (svcStatus !== 'notInstalled') {
        toast(t('newCommon.deleteBlockedService'), 'warning', 4000)
        return
      }
    }
    const ok = await options.confirm(
      t('newConfig.deleteTitle'),
      t('newConfig.deleteMsg', { name: target.configFileName })
    )
    if (!ok) return
    try {
      // 删除配置前清除该配置持有的退出路由（失败则中止，避免留下无法追踪的残留）
      if (isTauri) {
        const routeResult = await clearExitRoute(target.configFileName)
        if (!routeResult.ok) {
          toast(t('newConfig.exitRouteFail'), 'error', 4000)
          return
        }
      }
      await deleteFileOrDir(`${CONFIG_PATH}/${target.fileName}`)
      clearTrend(target.configFileName)
      toast(t('newCommon.deleteSuccess'), 'success')
      selectedConfig.value = null
      resetDetail()
      await easyTierStore.loadConfigFiles()
      await refreshRuntimeState()
      // Android 详情为独立路由：删除后回到列表页
      if (isAndroidPlatform) await router.replace({ name: 'NewConfigView' })
    } catch {
      toast(t('newCommon.deleteFail'), 'error')
    }
  }

  // ===== 退出节点路由开关（5.9 / 5.10，仅 Tauri 桌面端） =====
  // 判定依据：Tauri 运行时且非 Android（Android 无 route 命令/PowerShell，视为非适用环境）
  const isExitRouteBusy = ref(false)

  // 开关状态：优先 [lighttier].exit_route_enabled，兼容旧 flags / 顶层标记
  const exitRouteFlag = computed(() => isExitRouteEnabled(selectedDetail.value))

  const exitRouteStatus = computed<'enabled' | 'disabled' | 'desktop'>(() => {
    if (!isTauri) return 'desktop'
    return exitRouteFlag.value ? 'enabled' : 'disabled'
  })
  const exitRouteStatusText = computed(() => {
    if (exitRouteStatus.value === 'enabled') return t('newConfig.exitRouteEnabled')
    if (exitRouteStatus.value === 'desktop') return t('newConfig.exitRouteOnlyDesktop')
    return t('newConfig.exitRouteDisabled')
  })

  // 持久化开关标记到配置 TOML 的 [lighttier] 表（同时清除旧版 flags/顶层标记）
  // item 由调用方在操作开始时固定，避免等待期间切换选中项后把标记写进别的配置文件
  const persistExitRouteFlag = async (item: RunningItem, enabled: boolean): Promise<boolean> => {
    if (!item.fileName) return false
    try {
      const raw = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
      const cfg = toml.parse(raw)
      setExitRouteEnabled(cfg, enabled)
      await writeFileContent(`${CONFIG_PATH}/${item.fileName}`, toml.stringify(cfg))
      // 同步内存视图，避免开关状态与文件不一致；选中项已切换时不改其他配置的详情
      const detail = selectedDetail.value
      if (detail && selectedConfig.value?.configFileName === item.configFileName) {
        setExitRouteEnabled(detail, enabled)
      }
      return true
    } catch {
      return false
    }
  }

  const toggleExitRoute = async () => {
    // 操作期间固定目标配置与详情快照：等待路由命令期间用户可能已切换到其他配置
    const item = selectedConfig.value
    const detail = selectedDetail.value
    if (!item || !detail || isExitRouteBusy.value) return
    isExitRouteBusy.value = true
    try {
      if (exitRouteFlag.value) {
        // 停用：只清理当前配置的路由，失败时保留标记以便重试
        const result = await clearExitRoute(item.configFileName)
        if (result.ok) {
          await persistExitRouteFlag(item, false)
          toast(t('newConfig.exitRouteCleared'), 'success')
        } else {
          toast(t('newConfig.exitRouteFail'), 'error')
        }
      } else {
        // 启用：添加路由 + 写入标记
        const res = await setExitRoute(detail, item.configFileName)
        if (res.ok) {
          await persistExitRouteFlag(item, true)
          toast(t('newConfig.exitRouteSuccess'), 'success')
        } else if (res.reason === 'no-exit') {
          toast(t('newConfig.exitRouteNoExit'), 'warning')
        } else if (res.reason === 'precondition') {
          toast(t('newConfig.exitRoutePrecondition'), 'warning', 4000)
        } else if (res.reason === 'non-tauri') {
          toast(t('newConfig.exitRouteOnlyDesktop'), 'warning')
        } else {
          toast(
            t('newConfig.exitRouteFail') + '：' + t('newConfig.exitRouteAdminHint'),
            'error',
            4000
          )
        }
      }
    } finally {
      isExitRouteBusy.value = false
    }
  }

  // 5.10：残留检查（对比持久化记录与系统路由表，可确认清理）
  const openRouteCheck = async () => {
    if (isExitRouteBusy.value) return
    isExitRouteBusy.value = true
    try {
      const res = await checkExitRouteResidue()
      const fmt = (r: { target: string; mask: string; gateway: string; metric: number }) =>
        `${r.target} mask ${r.mask} → ${r.gateway} (metric ${r.metric})`
      const parts: string[] = []
      if (res.active.length > 0) {
        parts.push(
          t('newConfig.exitRouteCheckActive', { n: res.active.length }) +
            '\n' +
            res.active.map(fmt).join('\n')
        )
      }
      if (res.missing.length > 0) {
        parts.push(
          t('newConfig.exitRouteCheckMissing', { n: res.missing.length }) +
            '\n' +
            res.missing.map(fmt).join('\n')
        )
      }
      if (res.suspicious.length > 0) {
        parts.push(
          t('newConfig.exitRouteCheckSuspicious', { n: res.suspicious.length }) +
            '\n' +
            res.suspicious.map(fmt).join('\n')
        )
      }
      if (parts.length === 0) {
        toast(t('newConfig.exitRouteCheckNone'), 'success')
        return
      }
      const clearable = res.active.length > 0
      const confirmMsg =
        parts.join('\n\n') +
        (clearable
          ? '\n\n' + t('newConfig.exitRouteCheckConfirmClear', { n: res.active.length })
          : '')
      const ok = await options.confirm(t('newConfig.exitRouteCheckTitle'), confirmMsg)
      if (!ok || !clearable) return
      const clean = await cleanExitRouteResidue(true)
      if (clean.failed > 0) {
        toast(t('newConfig.exitRouteResidueFail'), 'error')
      } else if (clean.cleared > 0) {
        toast(t('newConfig.exitRouteResidueCleared', { n: clean.cleared }), 'success')
      }
    } finally {
      isExitRouteBusy.value = false
    }
  }

  // 启动成功后自动配置退出节点路由（与概览页共用同一实现；可能不是当前选中项）
  const applyExitRouteAfterStart = async (item: RunningItem) => {
    const res = await applyExitRouteFromFile(item.configFileName, item.fileName)
    if (res.ok) toast(t('newConfig.exitRouteAutoApplied'), 'success')
    else if (res.reason === 'precondition')
      toast(t('newConfig.exitRoutePrecondition'), 'warning', 4000)
    else if (res.reason === 'no-exit') toast(t('newConfig.exitRouteNoExit'), 'warning')
    else if (res.reason === 'command') {
      const detail = res.message ? `（${res.message}）` : ''
      toast(t('newConfig.exitRouteFail') + detail, 'error', 5000)
    } else if (res.reason === 'read-failed') {
      toast(t('newConfig.exitRouteFail'), 'error', 3000)
    }
  }

  return {
    isAndroidPlatform,
    isWideLandscape,
    isAndroidDetailRoute,
    isListEmpty,
    isTauri,
    selectedConfig,
    selectedDetail,
    selectedRunning,
    detailState,
    detailError,
    detailErrorTitle,
    configSearch,
    filteredConfigList,
    blurSearchInput,
    routeFilter,
    filteredRoutes,
    flagLabel,
    mapServiceStatus,
    getRunning,
    getRunningItem,
    selectConfig,
    closeDetail,
    retryDetail,
    openConfigDir,
    startAction,
    stopAction,
    isExitRouteBusy,
    exitRouteFlag,
    exitRouteStatus,
    exitRouteStatusText,
    toggleExitRoute,
    openRouteCheck,
    currentServiceStatus,
    openServiceDialog,
    handleServiceInstalled,
    handleStartService,
    handleStopService,
    handleUninstallService,
    editVisible,
    editConfigName,
    editTomlContent,
    editDialogMode,
    configNameList,
    openEdit,
    openAdd,
    handleSaved,
    deleteSelectedConfig,
    svcDialogVisible,
    svcConfigName
  }
}

export type ConfigListApi = ReturnType<typeof useConfigList>
