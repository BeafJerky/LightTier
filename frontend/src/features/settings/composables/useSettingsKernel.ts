/**
 * 核心管理：内核版本检测、核心路径、版本下载 / 安装 / 删除，以及加速源管理。
 *
 * 版本列表为固定清单（entities/kernel/kernelCompat.ts），安装包不再内置，必须先下载；
 * 下载与测速共用同一加速源选择（useMirrorProbe 实例由设置弹窗统一持有）。
 * 版本下拉为自定义弹层（原生 <select> 由系统绘制，无法跟随主题）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useCoreInstall } from '@/shared/composables/useCoreInstall'
import {
  useMirrorProbe,
  MIRROR_SOURCE_KEY,
  LATENCY_GOOD,
  LATENCY_BAD
} from '@/shared/composables/useMirrorProbe'
import { useEasyTierStore } from '@/shared/store/easytier'
import { deleteFileOrDir, downloadFile, listFiles, openPath } from '@/shared/platform/fileUtil'
import { formatBytes } from '@/shared/lib/monitorFormat'
import { getArch, getOsType } from '@/shared/platform/sysUtil'
import { CORE_VERSION_OPTIONS, DEFAULT_CORE_VERSION } from '@/entities/kernel/kernelCompat'
import { CORE_PATH, getCoreDownloadUrl, getCoreFileName } from '@/shared/constants/easytier'
import { resourceDir, join } from '@tauri-apps/api/path'
import type { SettingsConfirm } from './settingsTypes'

interface SettingsKernelOptions {
  confirm: SettingsConfirm
  mirror: ReturnType<typeof useMirrorProbe>
  isDesktopRuntime: boolean
  isAndroidPlatform: boolean
}

export function useSettingsKernel(options: SettingsKernelOptions) {
  const { confirm, mirror, isDesktopRuntime, isAndroidPlatform } = options
  const {
    sources: mirrorSources,
    probing: mirrorProbing,
    selected: mirrorSelected,
    probeAll,
    probeSource,
    waitForProbe,
    selectSource: mirrorSelect,
    addSource: mirrorAddSource,
    removeSource: mirrorRemoveSource,
    canRestoreDefaults,
    restoreDefaults: mirrorRestoreDefaults
  } = mirror

  const store = useEasyTierStore()
  const toast = useCreamToast()
  const { t } = useI18n()
  const { installing: installingCore, installCore } = useCoreInstall()

  // 内核版本展示：优先用全局探测结果（规范化前原文），探测中显示占位
  const coreVersion = computed(() => {
    if (store.coreVersionDetecting) return t('newCommon.checking')
    return store.coreVersionRaw || t('newSettings.notInstalled')
  })

  // 核心管理状态
  const checkingCore = ref(false)
  const corePath = ref('')
  // 可下载版本为固定列表（constants/kernelCompat.ts），默认选中最新正式版（需自行下载）
  const coreVerOptions = CORE_VERSION_OPTIONS
  const coreVerSelect = ref(DEFAULT_CORE_VERSION)
  const downloadingCore = ref(false)
  const deletingCore = ref(false)
  // 是否已进入实际下载阶段（自动测速阶段不展示 0% 进度条）
  const downloadActive = ref(false)
  // 下载进度：total 为 null 表示服务端未返回 Content-Length（进度条转为不确定态）
  const downloadReceived = ref(0)
  const downloadTotal = ref<number | null>(null)
  const downloadPercent = computed<number | null>(() => {
    if (!downloadTotal.value) return null
    return Math.min(
      100,
      Math.max(0, Math.round((downloadReceived.value / downloadTotal.value) * 100))
    )
  })
  const downloadProgressText = computed(() => {
    const total = downloadTotal.value
    if (downloadPercent.value === null || !total) {
      return t('newSettings.downloadProgressReceived', {
        size: formatBytes(downloadReceived.value)
      })
    }
    return t('newSettings.downloadProgressPercent', {
      percent: downloadPercent.value,
      received: formatBytes(downloadReceived.value),
      total: formatBytes(total)
    })
  })
  const coreFileName = ref('')
  // 已下载的内核安装包版本（扫描 resource/core 下的 zip；安装后仍保留）
  const downloadedCoreVersions = ref<string[]>([])
  const isSelectedCoreDownloaded = computed(() =>
    downloadedCoreVersions.value.includes(coreVerSelect.value)
  )
  // 以本地 zip 实际存在为准：安装包不再内置，必须先下载
  const selectedCoreReady = computed(() => isSelectedCoreDownloaded.value)
  const corePackageStatusText = computed(() =>
    isSelectedCoreDownloaded.value
      ? t('newSettings.corePackageDownloaded')
      : t('newSettings.corePackageNotDownloaded')
  )

  // 按当前所选版本拼出内核压缩包文件名（纯字符串拼接，避免 CSP 拦截 lodash.template 的 new Function）
  const updateCoreFileName = () => {
    try {
      coreFileName.value = getCoreFileName(getOsType(), getArch(), coreVerSelect.value)
    } catch (e) {
      console.error('生成内核文件名失败:', e)
      coreFileName.value = ''
    }
  }

  // 版本切换后同步刷新下载文件名
  watch(coreVerSelect, () => {
    updateCoreFileName()
  })

  // 扫描 core 目录，按当前平台/架构的压缩包名判断各版本下载状态
  const refreshDownloadedCores = async () => {
    if (!isDesktopRuntime) return
    try {
      const files = new Set(await listFiles(CORE_PATH))
      downloadedCoreVersions.value = coreVerOptions
        .filter((o) => files.has(getCoreFileName(getOsType(), getArch(), o.tag_name)))
        .map((o) => o.tag_name)
    } catch (e) {
      console.error('扫描内核安装包失败:', e)
      downloadedCoreVersions.value = []
    }
  }

  // 内核版本自定义下拉：原生 <select> 的弹层由系统绘制，无法跟随主题
  // LtButton 的 ref 为组件实例，统一经 $el 取根按钮用于定位与焦点恢复
  const coreVerTriggerRef = ref<{ $el?: HTMLButtonElement } | null>(null)
  const coreVerTriggerEl = (): HTMLButtonElement | null => coreVerTriggerRef.value?.$el ?? null
  const coreVerMenuRef = ref<HTMLElement | null>(null)
  // 模板 ref 由分类面板绑定：组件内以函数 ref 回写，避免拆页后引用丢失
  const setCoreVerTriggerRef = (el: unknown) => {
    coreVerTriggerRef.value = (el as { $el?: HTMLButtonElement } | null) ?? null
  }
  const setCoreVerMenuRef = (el: unknown) => {
    coreVerMenuRef.value = (el as HTMLElement | null) ?? null
  }
  const coreVerDropdownOpen = ref(false)
  const coreVerHighlighted = ref(0)
  const coreVerMenuStyle = ref<Record<string, string>>({})

  const coreVerOptionLabel = (tag: string) => {
    const item = coreVerOptions.find((o) => o.tag_name === tag)
    if (!item) return tag
    const channel =
      item.channel === 'prerelease'
        ? t('newSettings.channelPrerelease')
        : t('newSettings.channelStable')
    const downloaded = downloadedCoreVersions.value.includes(tag)
      ? ` · ${t('newSettings.downloadedBadge')}`
      : ''
    const installed =
      tag === store.detectedCoreVersion ? ` · ${t('newSettings.installedBadge')}` : ''
    return `${tag} · ${channel}${downloaded}${installed}`
  }

  // 弹层 Teleport 到 body，用 fixed 坐标贴合触发器；空间不足时向上展开
  const positionCoreVerMenu = () => {
    const trigger = coreVerTriggerEl()
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const menuHeight = coreVerMenuRef.value?.offsetHeight || coreVerOptions.length * 32 + 10
    // WebView 在极端情况下可能报告 0 视口，回退到触发器尺寸避免负数宽度
    const viewportWidth = window.innerWidth || rect.width + 16
    const viewportHeight = window.innerHeight || rect.bottom + menuHeight + 8
    const openUp = viewportHeight - rect.bottom < menuHeight + 8 && rect.top > menuHeight + 8
    const width = Math.max(120, Math.min(rect.width, viewportWidth - 16))
    coreVerMenuStyle.value = {
      left: `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`,
      width: `${width}px`,
      ...(openUp
        ? { bottom: `${viewportHeight - rect.top + 4}px` }
        : { top: `${rect.bottom + 4}px` })
    }
  }

  const focusCoreVerOption = (idx: number) => {
    const options = coreVerMenuRef.value?.querySelectorAll<HTMLElement>('[role="option"]')
    if (!options?.length) return
    const next = ((idx % options.length) + options.length) % options.length
    coreVerHighlighted.value = next
    options[next].focus()
  }

  const openCoreVerDropdown = async (direction = 0) => {
    if (downloadingCore.value) return
    coreVerDropdownOpen.value = true
    const selectedIdx = Math.max(
      0,
      coreVerOptions.findIndex((o) => o.tag_name === coreVerSelect.value)
    )
    coreVerHighlighted.value =
      direction === 0
        ? selectedIdx
        : (selectedIdx + direction + coreVerOptions.length) % coreVerOptions.length
    await nextTick()
    positionCoreVerMenu()
    focusCoreVerOption(coreVerHighlighted.value)
  }

  const closeCoreVerDropdown = (restoreFocus = false) => {
    if (!coreVerDropdownOpen.value) return
    coreVerDropdownOpen.value = false
    // 指针选择后不还原焦点，避免触发器陷入 Naive 的 focus 配色（键盘选择仍还原）
    if (restoreFocus && document.documentElement.dataset.input !== 'pointer') {
      nextTick(() => coreVerTriggerEl()?.focus())
    }
  }

  const toggleCoreVerDropdown = () => {
    if (coreVerDropdownOpen.value) closeCoreVerDropdown()
    else void openCoreVerDropdown()
  }

  const selectCoreVersion = (tag: string) => {
    coreVerSelect.value = tag
    closeCoreVerDropdown(true)
  }

  const handleCoreVerOutsideClick = (e: MouseEvent) => {
    if (!coreVerDropdownOpen.value) return
    const target = e.target as Node
    if (coreVerTriggerEl()?.contains(target) || coreVerMenuRef.value?.contains(target)) return
    closeCoreVerDropdown()
  }

  // 内容区滚动或窗口尺寸变化时关闭，避免弹层与触发器分离
  const handleCoreVerViewportChange = () => closeCoreVerDropdown()

  onMounted(() => {
    document.addEventListener('click', handleCoreVerOutsideClick)
    window.addEventListener('resize', handleCoreVerViewportChange)
    window.addEventListener('scroll', handleCoreVerViewportChange, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleCoreVerOutsideClick)
    window.removeEventListener('resize', handleCoreVerViewportChange)
    window.removeEventListener('scroll', handleCoreVerViewportChange, true)
  })

  // 当前内核的适配档案说明：让用户确认切换后表单/命令会跟随版本变化
  const compatProfileDesc = computed(() => {
    if (store.coreVersionDetecting) return t('newCommon.checking')
    const caps = store.coreCaps
    const version = store.detectedCoreVersion
    if (!version) return t('newSettings.compatUnknown')
    if (!caps) return t('newSettings.compatUnknown')
    if (!caps.known) return t('newSettings.compatOutOfRange', { version })
    return t('newSettings.compatKnown', {
      version,
      flags: caps.flags?.size ?? 0,
      strict: caps.flagsStrict ? t('newSettings.compatStrict') : ''
    })
  })

  // 5.10：加速源管理（下载安装区块的下级弹窗）
  // 加速源弹窗：入口按钮展示当前选中的源名，新增输入与错误提示随弹窗关闭清空
  const mirrorDialogVisible = ref(false)
  const mirrorInput = ref('')
  const mirrorAddError = ref('')
  // 未指定加速源时的自动测速每个设置会话只尝试一次，失败后直接回退官方源
  let autoMirrorProbeAttempted = false

  // 弹窗每次打开重置自动测速尝试标记（关闭时不重置，与原实现一致）
  const resetMirrorSession = () => {
    autoMirrorProbeAttempted = false
  }

  const currentMirrorLabel = computed(() => {
    if (mirrorProbing.value) return t('newSettings.mirrorProbing')
    const current = mirrorSources.value.find((s) => s.value === mirrorSelected.value)
    return current
      ? current.label || t('newSettings.mirrorOfficial')
      : t('newSettings.mirrorOfficial')
  })

  // 下载按钮文案：自动测速阶段优先展示“测速中…”，避免误以为已在下载
  const downloadBtnText = computed(() => {
    if (mirrorProbing.value) return t('newSettings.mirrorProbing')
    return downloadingCore.value ? t('newSettings.downloading') : t('newSettings.downloadCore')
  })

  const openMirrorDialog = () => {
    mirrorAddError.value = ''
    mirrorDialogVisible.value = true
    // 未指定加速源时，打开弹窗即自动测速并选用最快源；已显式选择则保留原选择
    if (
      !localStorage.getItem(MIRROR_SOURCE_KEY) &&
      coreFileName.value &&
      !autoMirrorProbeAttempted
    ) {
      autoMirrorProbeAttempted = true
      void probeAll(coreVerSelect.value, coreFileName.value)
    }
  }

  // 测速全部镜像源（目标为所选版本的真实内核包），全部失败时给出提示
  const handleProbeMirrors = async () => {
    if (!coreFileName.value) {
      toast.warning(t('newSettings.selectVersionFirst'))
      return
    }
    await probeAll(coreVerSelect.value, coreFileName.value)
    if (mirrorSources.value.every((s) => s.latency === null)) {
      toast.warning(t('newSettings.mirrorProbeFail'))
    }
  }

  // 新增自定义加速源：成功后自动选中并即时测速；不可达则回落到新增前的选择
  const handleAddMirror = async () => {
    const previous = mirrorSelected.value
    const result = mirrorAddSource(mirrorInput.value)
    if (!result.ok) {
      mirrorAddError.value =
        result.reason === 'duplicate'
          ? t('newSettings.mirrorAddDuplicate')
          : t('newSettings.mirrorAddInvalid')
      return
    }
    mirrorInput.value = ''
    mirrorAddError.value = ''
    // 无版本目标或已有测速任务时跳过即时测速（未测不视为不可达）
    if (!coreFileName.value || mirrorProbing.value) return
    const latency = await probeSource(result.value, coreVerSelect.value, coreFileName.value)
    if (latency === null) {
      mirrorSelect(previous)
      toast.warning(t('newSettings.mirrorAddUnreachable'))
    }
  }

  // 删除加速源：内置源可通过“恢复内置源”找回，自定义源需重新添加
  const handleRemoveMirror = (value: string) => {
    mirrorRemoveSource(value)
  }

  // 整行可点选（删除按钮除外），与旧版整行 label 的点击范围保持一致
  const handleMirrorRowClick = (e: MouseEvent, value: string) => {
    if ((e.target as HTMLElement).closest('button')) return
    mirrorSelect(value)
  }

  // 恢复被删除的内置镜像（保留自定义源与已有测速结果）
  const handleRestoreMirrors = () => {
    mirrorRestoreDefaults()
  }

  // 延迟展示：null 显示占位符，否则套用毫秒文案模板
  const latencyText = (lat: number | null): string => {
    if (lat === null) return '—'
    return t('newSettings.mirrorLatencyMs', { ms: lat })
  }

  // 延迟着色：优/中/差三档（阈值常量来自 useMirrorProbe）
  const latencyClass = (lat: number | null): string => {
    if (lat === null) return 'lat-unknown'
    if (lat < LATENCY_GOOD) return 'lat-good'
    if (lat >= LATENCY_BAD) return 'lat-bad'
    return 'lat-mid'
  }

  // 手动重新检测内核版本（403 等异常值在 store 内统一视为未安装）
  const handleCheckCore = async () => {
    checkingCore.value = true
    try {
      await store.detectCoreVersion()
    } finally {
      checkingCore.value = false
    }
  }

  // 打开内核所在目录（资源目录下的 CORE_PATH）
  const handleOpenCorePath = async () => {
    try {
      const resDir = await resourceDir()
      await openPath(await join(resDir, CORE_PATH))
    } catch (e) {
      console.error(e)
    }
  }

  // 打开配置文件所在目录
  const handleOpenConfigPath = async () => {
    try {
      const resDir = await resourceDir()
      await openPath(await join(resDir, 'config'))
    } catch (e) {
      console.error(e)
    }
  }

  // 下载所选版本内核安装包（优先镜像源加速，见 5.10）
  const handleDownloadCore = async () => {
    if (!coreFileName.value) {
      toast.warning(t('newSettings.selectVersionFirst'))
      return
    }
    downloadingCore.value = true
    try {
      // 未指定加速源：先测速并自动选用最快源，再按该源下载
      if (
        !localStorage.getItem(MIRROR_SOURCE_KEY) &&
        coreFileName.value &&
        !autoMirrorProbeAttempted
      ) {
        autoMirrorProbeAttempted = true
        toast.info(t('newSettings.mirrorAutoSelecting'))
        await probeAll(coreVerSelect.value, coreFileName.value)
        await waitForProbe()
      }
      // 镜像前缀需要拼接完整 GitHub URL（官方源直链），与测速使用同一拼接规则
      const url = getCoreDownloadUrl(mirrorSelected.value, coreVerSelect.value, coreFileName.value)
      downloadReceived.value = 0
      downloadTotal.value = null
      downloadActive.value = true
      // 进度条已常驻展示，不再重复弹“正在下载”提示
      const ok = await downloadFile(url, (progress) => {
        downloadReceived.value = progress.received
        downloadTotal.value = progress.total
      })
      if (ok) {
        toast.success(t('newSettings.downloadSuccess'))
        // 安装包保留在 core 目录，立即刷新“已下载”状态
        await refreshDownloadedCores()
      } else {
        toast.error(t('newSettings.downloadFail'))
      }
    } catch (e) {
      console.error('下载失败:', e)
      toast.error(t('newSettings.downloadFailFull') + ': ' + String(e))
    } finally {
      downloadingCore.value = false
      downloadActive.value = false
    }
  }

  // 删除所选版本的本地安装包；已安装的内核文件与运行状态不受影响
  const handleDeleteCorePackage = async () => {
    if (!isSelectedCoreDownloaded.value || !coreFileName.value) return
    const version = coreVerSelect.value
    if (
      !(await confirm(
        t('newSettings.deleteCorePackageTitle'),
        t('newSettings.deleteCorePackageMsg', { version })
      ))
    )
      return
    deletingCore.value = true
    try {
      await deleteFileOrDir(await join(CORE_PATH, coreFileName.value))
      await refreshDownloadedCores()
      toast.success(t('newSettings.deleteCorePackageSuccess', { version }))
    } catch (e) {
      console.error('删除内核安装包失败:', e)
      toast.error(t('newSettings.deleteCorePackageFail') + ': ' + String(e))
    } finally {
      deletingCore.value = false
    }
  }

  // 安装所选版本内核（切换前停止全部实例与服务，成功后重新检测版本）
  const handleInstallCore = async () => {
    const target = coreVerSelect.value
    // 只有已下载的 zip 才能安装（按钮已禁用，这里兜底提示）
    if (!selectedCoreReady.value) {
      toast.warning(t('newSettings.corePackageNotDownloaded'))
      return
    }
    const runningCount = store.runningList.length
    const serviceHint = isAndroidPlatform ? '' : t('newSettings.installConfirmServiceHint')
    if (
      !(await confirm(
        t('newSettings.installConfirmTitle'),
        t('newSettings.installConfirmMsg', { version: target, count: runningCount, serviceHint })
      ))
    )
      return
    const ok = await installCore(target)
    if (ok) {
      toast.success(t('newSettings.installSuccess', { version: target }))
      // installCore 内部已重新探测；这里兜底刷新一次展示态
      await handleCheckCore()
      // 切换后恢复自动运行循环的停止标记，允许后续手动启动新实例
      store.stopLoop = false
    } else {
      toast.error(t('newSettings.installFail'))
    }
  }

  // 打开设置时加载核心路径，并按已安装版本选中下拉项（桌面 Tauri 专属）
  const loadCoreState = async () => {
    if (!isDesktopRuntime) return
    // 加载核心路径（仅桌面 Tauri；浏览器预览避免调用 plugin-os/path）
    try {
      corePath.value = await join(await resourceDir(), CORE_PATH)
    } catch {
      corePath.value = t('newSettings.unknown')
    }
    // 固定版本列表：已安装版本在列表内则默认选中它，否则回退最新正式版
    const installed = store.detectedCoreVersion
    const match = coreVerOptions.find((o) => o.tag_name === installed)
    coreVerSelect.value = match ? match.tag_name : DEFAULT_CORE_VERSION
    updateCoreFileName()
    await refreshDownloadedCores()
  }

  return {
    checkingCore,
    corePath,
    coreVerOptions,
    coreVerSelect,
    downloadingCore,
    deletingCore,
    downloadActive,
    downloadReceived,
    downloadTotal,
    downloadPercent,
    downloadProgressText,
    coreFileName,
    downloadedCoreVersions,
    isSelectedCoreDownloaded,
    selectedCoreReady,
    corePackageStatusText,
    refreshDownloadedCores,
    updateCoreFileName,
    coreVersion,
    compatProfileDesc,
    setCoreVerTriggerRef,
    setCoreVerMenuRef,
    coreVerDropdownOpen,
    coreVerHighlighted,
    coreVerMenuStyle,
    coreVerOptionLabel,
    positionCoreVerMenu,
    focusCoreVerOption,
    openCoreVerDropdown,
    closeCoreVerDropdown,
    toggleCoreVerDropdown,
    selectCoreVersion,
    handleCheckCore,
    handleOpenCorePath,
    handleOpenConfigPath,
    handleDownloadCore,
    handleDeleteCorePackage,
    handleInstallCore,
    installingCore,
    mirrorSources,
    mirrorProbing,
    mirrorSelected,
    mirrorSelect,
    mirrorDialogVisible,
    mirrorInput,
    mirrorAddError,
    currentMirrorLabel,
    downloadBtnText,
    openMirrorDialog,
    handleProbeMirrors,
    handleAddMirror,
    handleRemoveMirror,
    handleMirrorRowClick,
    handleRestoreMirrors,
    canRestoreDefaults,
    latencyText,
    latencyClass,
    loadCoreState,
    resetMirrorSession
  }
}
