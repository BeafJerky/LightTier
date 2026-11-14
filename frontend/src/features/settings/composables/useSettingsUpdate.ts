/**
 * 关于页：应用版本、检查更新（5.11）与应用内更新下载安装。
 *
 * 检查更新按 GitHub Release 列表比对，默认只认正式版；应用内更新按同一加速源
 * 把安装包下载到 resource/update，完成后一键拉起安装器（Rust 侧复制到临时目录再启动，
 * 避免安装器覆盖运行中的自身被文件锁挡住）。浏览器预览走新标签页下载，Android 不展示。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandStore } from '@/shared/store/island'
import { pickLatestManagerRelease } from '@/shared/lib/releaseUtil'
import type { useMirrorProbe } from '@/shared/composables/useMirrorProbe'
import { MIRROR_SOURCE_KEY } from '@/shared/composables/useMirrorProbe'
import { downloadFile, listFiles } from '@/shared/platform/fileUtil'
import { formatBytes } from '@/shared/lib/monitorFormat'
import { getAppVersion, getOsType, compareVersions } from '@/shared/platform/sysUtil'
import { UPDATE_PATH, MANAGER_REPO_URL, getMirrorUrl } from '@/shared/constants/easytier'
import { pickManagerInstaller, type ReleaseAsset } from '@/shared/platform/updateUtil'
import { invoke, isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'
import pkg from '../../../../../package.json'
import type { SettingsConfirm } from './settingsTypes'

/** 检查更新入口开关：GitHub Release 已发布，入口开放 */
export const UPDATE_CHECK_ENABLED = true

interface SettingsUpdateOptions {
  confirm: SettingsConfirm
  mirror: ReturnType<typeof useMirrorProbe>
  isDesktopRuntime: boolean
  isAndroidPlatform: boolean
}

type AndroidInstallStatus =
  | 'started'
  | 'permission'
  | 'missing'
  | 'invalid'
  | 'error'
  | 'unavailable'

declare global {
  interface Window {
    /** MainActivity 注入的系统安装器桥（仅 Android） */
    LTAndroidInstaller?: { installApk: (fileName: string) => string }
  }
}

export function useSettingsUpdate(options: SettingsUpdateOptions) {
  const { confirm, mirror, isDesktopRuntime, isAndroidPlatform } = options
  const store = useEasyTierStore()
  const island = useIslandStore()
  const toast = useCreamToast()
  const { t } = useI18n()
  const { selected: mirrorSelected, probing: mirrorProbing, probeAllWith, waitForProbe } = mirror

  // 应用版本：getAppVersion() 为权威值，浏览器预览回退构建期版本号
  const appVersion = ref('...')
  const loadAppVersion = async () => {
    try {
      appVersion.value = await getAppVersion()
    } catch {
      // 浏览器预览无 Tauri IPC：回退构建期版本号，让“检查更新”在 Mock 下也能判出更新
      appVersion.value = pkg.version
    }
  }

  // 关于：检查更新（5.11，版本基准用 getAppVersion() 权威值）
  // 三态：有更新（版本号 + 前往下载）/ 已是最新 / 请求失败或空列表（错误提示，重试按钮复用检查按钮）
  const checkingUpdate = ref(false)
  const updateCheckError = ref(false)
  const latestManagerVersion = ref('')
  const hasManagerUpdate = computed(() => {
    if (
      updateCheckError.value ||
      !latestManagerVersion.value ||
      !appVersion.value ||
      appVersion.value === '...' ||
      appVersion.value === t('newSettings.unknown')
    )
      return false
    return compareVersions(latestManagerVersion.value, appVersion.value) > 0
  })
  const updateDesc = computed(() => {
    if (updateCheckError.value) return t('newSettings.checkUpdateFail')
    if (hasManagerUpdate.value)
      return t('newSettings.updateAvailable', { version: latestManagerVersion.value })
    if (latestManagerVersion.value) return t('newSettings.upToDateDesc')
    return t('newSettings.checkUpdateDesc')
  })

  // 切换更新通道：清掉上次结果，避免“只更新稳定版”下仍显示 nightly 版本号
  const handleUpdateStableOnlyToggle = (value: boolean) => {
    store.updateStableOnly = value
    latestManagerVersion.value = ''
    updateCheckError.value = false
    // 切换通道后让灵动岛的 24h 缓存一并失效，避免旧通道结果继续提示
    island.invalidateManagerUpdate()
    island.dismissSource('update:manager')
    resetManagerUpdateState()
  }

  const handleCheckUpdate = async () => {
    checkingUpdate.value = true
    updateCheckError.value = false
    // 每次重新检查都丢弃上一次的资产与下载状态，避免拿旧版本的包安装
    resetManagerUpdateState()
    try {
      const data = await store.refreshManagerReleaseInfo(mirrorSelected.value)
      // 空列表是接口异常，不能误报“已是最新”
      if (!Array.isArray(data) || data.length === 0) throw new Error('empty release list')
      // 默认只认正式版：nightly 等预发布只在该开关关闭时参与比较
      const latest = pickLatestManagerRelease(data, store.updateStableOnly)
      if (!latest) {
        latestManagerVersion.value = ''
        island.absorbManagerRelease('')
        island.dismissSource('update:manager')
        toast.success(t('newSettings.upToDate'))
        return
      }
      const latestVersion = latest.tag_name || ''
      if (!latestVersion) throw new Error('missing tag_name')
      latestManagerVersion.value = latestVersion
      island.absorbManagerRelease(latestVersion)
      latestManagerAssets.value = Array.isArray(latest.assets) ? latest.assets : null
      if (hasManagerUpdate.value) {
        island.notify({
          type: 'update',
          title: t('newIsland.managerUpdate', { version: latestVersion }),
          detail: t('newIsland.managerUpdateDesc'),
          sourceKey: 'update:manager',
          action: { kind: 'open-settings', tab: 'about' }
        })
        toast.info(t('newSettings.updateAvailable', { version: latestManagerVersion.value }))
        // 应用目录里已有同版本安装包时直接进入“立即安装”，不必重复下载
        void restoreManagerUpdatePackage()
      } else {
        island.dismissSource('update:manager')
        toast.success(t('newSettings.upToDate'))
      }
    } catch (e) {
      console.error('检查更新失败:', e)
      latestManagerVersion.value = ''
      updateCheckError.value = true
      toast.error(t('newSettings.checkUpdateFail'))
    } finally {
      checkingUpdate.value = false
    }
  }

  // 安卓 WebView 不处理 target="_blank" 的新窗口请求，链接必须经 plugin-shell 走系统浏览器
  const openExternalLink = async (url: string) => {
    // 浏览器预览没有 plugin-shell：直接用新标签页打开，避免静默失败
    if (!isTauriRuntime()) {
      window.open(url, '_blank', 'noopener')
      return
    }
    try {
      await invoke('open_external_url', { url })
    } catch (e) {
      console.error('打开外部链接失败:', e)
      toast.error(t('newSettings.openLinkFail'))
    }
  }

  const handleOpenManagerReleases = () => openExternalLink(MANAGER_REPO_URL)

  // === 应用内更新（5.11 的检查更新下载环节）
  const latestManagerAssets = ref<ReleaseAsset[] | null>(null)
  // 仅 Windows 桌面走 exe 应用内更新；浏览器预览按桌面 UI 展示，便于验证布局
  const isWindowsDesktop = (() => {
    if (isAndroidPlatform) return false
    if (!isDesktopRuntime) return true
    try {
      return getOsType() === 'windows'
    } catch {
      return false
    }
  })()
  // Android 走 APK 应用内下载 + 系统安装器
  const updatePlatform: 'windows' | 'android' | 'other' = isAndroidPlatform
    ? 'android'
    : isWindowsDesktop
      ? 'windows'
      : 'other'
  const updating = ref(false)
  const launchingInstaller = ref(false)
  // 是否进入实际下载阶段（自动测速阶段不展示 0% 进度条）
  const updateActive = ref(false)
  const updateDownloaded = ref(false)
  const updateReceived = ref(0)
  const updateTotal = ref<number | null>(null)
  // 未指定加速源时的自动测速每个设置会话只尝试一次
  let autoUpdateProbeAttempted = false

  const managerInstaller = computed(() =>
    pickManagerInstaller(latestManagerAssets.value, updatePlatform)
  )
  const canInAppUpdate = computed(() => hasManagerUpdate.value && !!managerInstaller.value)
  const updatePercent = computed<number | null>(() => {
    if (!updateTotal.value) return null
    return Math.min(100, Math.max(0, Math.round((updateReceived.value / updateTotal.value) * 100)))
  })
  const updateProgressText = computed(() => {
    const total = updateTotal.value
    if (updatePercent.value === null || !total) {
      return t('newSettings.downloadProgressReceived', { size: formatBytes(updateReceived.value) })
    }
    return t('newSettings.downloadProgressPercent', {
      percent: updatePercent.value,
      received: formatBytes(updateReceived.value),
      total: formatBytes(total)
    })
  })
  const updateDownloadBtnText = computed(() => {
    if (mirrorProbing.value) return t('newSettings.mirrorProbing')
    return updating.value ? t('newSettings.downloading') : t('newSettings.downloadUpdate')
  })
  const inAppUpdateDesc = computed(() => {
    // Android 的文件落在私有目录，路径对用户无意义，改用流程说明
    if (updatePlatform === 'android') {
      return updateDownloaded.value
        ? t('newSettings.updatePackageReadyAndroid')
        : t('newSettings.updateSavePathAndroid')
    }
    return updateDownloaded.value
      ? t('newSettings.updatePackageReady', { path: UPDATE_PATH })
      : t('newSettings.updateSavePath', { path: UPDATE_PATH })
  })

  const resetManagerUpdateState = () => {
    latestManagerAssets.value = null
    updating.value = false
    launchingInstaller.value = false
    updateActive.value = false
    updateDownloaded.value = false
    updateReceived.value = 0
    updateTotal.value = null
  }

  // 复用应用目录里已有的同版本安装包（上次下载后未安装即可直接安装，无需重复下载）
  const restoreManagerUpdatePackage = async () => {
    const asset = managerInstaller.value
    if (!asset || !isTauriRuntime()) return
    const names = await listFiles(UPDATE_PATH, true)
    if (!names.includes(asset.fileName)) return
    updateDownloaded.value = true
    updateTotal.value = asset.size
    updateReceived.value = asset.size ?? 0
  }

  const handleDownloadManagerUpdate = async () => {
    const asset = managerInstaller.value
    if (!asset) {
      toast.warning(t('newSettings.updateAssetMissing'))
      return
    }
    // 浏览器预览写不了本地目录：走新标签页下载，保证入口不静默失败
    if (!isTauriRuntime()) {
      openExternalLink(asset.url)
      return
    }
    updating.value = true
    try {
      if (!localStorage.getItem(MIRROR_SOURCE_KEY) && !autoUpdateProbeAttempted) {
        autoUpdateProbeAttempted = true
        toast.info(t('newSettings.mirrorAutoSelecting'))
        // 与内核下载同一规则：对真实安装包地址测速，自动选用最快可用加速源
        await probeAllWith((base) => getMirrorUrl(base, asset.url))
        await waitForProbe()
      }
      updateReceived.value = 0
      updateTotal.value = asset.size
      updateActive.value = true
      const ok = await downloadFile(
        getMirrorUrl(mirrorSelected.value, asset.url),
        (progress) => {
          updateReceived.value = progress.received
          updateTotal.value = progress.total ?? asset.size
        },
        // 以官方包体长度兜底校验：半包（浏览器中断、镜像截断）不落盘
        { dir: UPDATE_PATH, expectedSize: asset.size }
      )
      if (ok) {
        updateDownloaded.value = true
        toast.success(
          isAndroidPlatform
            ? t('newSettings.updateDownloadSuccessAndroid')
            : t('newSettings.updateDownloadSuccess', { path: UPDATE_PATH })
        )
      } else {
        toast.error(t('newSettings.updateDownloadFail'))
      }
    } catch (e) {
      console.error('下载更新失败:', e)
      toast.error(t('newSettings.updateDownloadFail') + ': ' + String(e))
    } finally {
      updating.value = false
      updateActive.value = false
    }
  }

  // Android：APK 已下载到应用数据目录（Tauri AppData → dataDir/resource/update），
  // 交系统安装器（桥内复制到 cacheDir 后经 FileProvider 共享）。
  // 没有“安装未知应用”权限时，桥会先拉起系统设置页，用户授权后再点一次即可。
  const runAndroidInstaller = (fileName: string) => {
    let status: AndroidInstallStatus
    try {
      status =
        (window.LTAndroidInstaller?.installApk(fileName) as AndroidInstallStatus) ?? 'unavailable'
    } catch (e) {
      console.error('启动安卓安装器失败:', e)
      status = 'error'
    }
    if (status === 'started') {
      toast.success(t('newSettings.installerLaunchedAndroid'))
      return
    }
    if (status === 'permission') {
      toast.warning(t('newSettings.installPermissionNeeded'))
      return
    }
    if (status === 'missing') {
      // 本地包被清理/删除：回到“下载更新”态，避免按钮一直可点却装不上
      updateDownloaded.value = false
      toast.error(t('newSettings.installPackageMissing'))
      return
    }
    toast.error(t('newSettings.installLaunchFail'))
  }

  const handleRunManagerInstaller = async () => {
    const asset = managerInstaller.value
    if (!asset || !updateDownloaded.value) {
      toast.warning(t('newSettings.updatePackageNotDownloaded'))
      return
    }
    if (updatePlatform === 'android') {
      runAndroidInstaller(asset.fileName)
      return
    }
    if (!(await confirm(t('newSettings.runInstallerTitle'), t('newSettings.runInstallerMsg')))) {
      return
    }
    launchingInstaller.value = true
    try {
      // 安装器会在启动后约 1.5 秒结束本进程，先落盘窗口状态（与托盘“退出”同一处理）
      await saveWindowState(StateFlags.ALL)
      await invoke('launch_update_installer', { installer: asset.fileName })
      toast.success(t('newSettings.installerLaunched'))
    } catch (e) {
      console.error('启动安装器失败:', e)
      launchingInstaller.value = false
      toast.error(t('newSettings.installLaunchFail') + ': ' + String(e))
    }
  }

  return {
    appVersion,
    loadAppVersion,
    checkingUpdate,
    updateCheckError,
    latestManagerVersion,
    hasManagerUpdate,
    updateDesc,
    handleUpdateStableOnlyToggle,
    handleCheckUpdate,
    openExternalLink,
    handleOpenManagerReleases,
    canInAppUpdate,
    updating,
    launchingInstaller,
    updateActive,
    updateDownloaded,
    updatePercent,
    updateProgressText,
    updateDownloadBtnText,
    inAppUpdateDesc,
    handleDownloadManagerUpdate,
    handleRunManagerInstaller,
    mirrorProbing
  }
}
