// frontend/src/shared/composables/useIslandBridge.ts
import { onScopeDispose, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { t } from '@/shared/i18n/t'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandStore } from '@/shared/store/island'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import { pickLatestManagerRelease } from '@/shared/lib/releaseUtil'
import { compareVersions, getAppVersion } from '@/shared/platform/sysUtil'
import { DEFAULT_CORE_VERSION } from '@/entities/kernel/kernelCompat'

const INITIAL_RETRY_DELAYS = [5_000, 15_000]

async function readAppVersion(): Promise<string> {
  try {
    return isTauri() ? await getAppVersion() : ''
  } catch {
    return ''
  }
}

/**
 * 灵动岛的数据桥：
 * - 首次运行态扫描成功前不建立基线，避免持久化的旧 PID/旧列表触发假掉线；
 * - 扫描失败时保留未初始化状态并按 5s/15s 重试；
 * - 更新检查 24h 一次，失败静默；
 * - 设置页手动检查会通过 absorbManagerRelease 刷新这里的时间戳。
 */
export function useIslandBridge() {
  const island = useIslandStore()
  const easy = useEasyTierStore()

  let initializing = true
  let initialSyncOk = false
  let disposed = false
  let retryTimer = 0

  const sync = useRunningListSync({
    onError: () => {
      initialSyncOk = false
    },
    onSuccess: () => {
      initialSyncOk = true
    }
  })

  const names = () => easy.runningList.map((item) => item.configFileName)

  watch(names, (next) => {
    if (initializing) return
    island.applyRunningNames(next)
  })

  watch(
    () => easy.detectedCoreVersion,
    () => refreshKernelNotice()
  )

  watch(
    () => easy.updateStableOnly,
    () => {
      island.invalidateManagerUpdate()
      island.dismissSource('update:manager')
      void refreshUpdateNotices()
    }
  )

  const refreshKernelNotice = () => {
    if (!island.settings.enabled || !island.settings.types.update) return
    const detected = easy.detectedCoreVersion
    if (!detected) return
    if (compareVersions(DEFAULT_CORE_VERSION, detected) > 0) {
      island.notify({
        type: 'update',
        title: t('newIsland.kernelUpdate', { version: DEFAULT_CORE_VERSION }),
        detail: t('newIsland.kernelUpdateDesc'),
        sourceKey: 'update:kernel',
        action: { kind: 'open-settings', tab: 'core' }
      })
    } else {
      island.dismissSource('update:kernel')
    }
  }

  async function refreshUpdateNotices(): Promise<void> {
    if (!island.settings.enabled || !island.settings.types.update) return

    // 缓存内不重复请求，但仍要把已记录的新版本恢复成角标（应用重启后常见）。
    let version = island.latestManagerVersion
    if (island.shouldCheckManagerUpdate()) {
      island.setUpdateChecking(true)
      try {
        const releases = await easy.refreshManagerReleaseInfo()
        version = pickLatestManagerRelease(releases, easy.updateStableOnly)?.tag_name ?? ''
        island.absorbManagerRelease(version)
      } catch {
        // 网络失败静默：沿用已记录的版本，不把临时错误变成常驻红点
      } finally {
        island.setUpdateChecking(false)
      }
    }

    const appVersion = await readAppVersion()
    if (version && appVersion && compareVersions(version, appVersion) > 0) {
      island.notify({
        type: 'update',
        title: t('newIsland.managerUpdate', { version }),
        detail: t('newIsland.managerUpdateDesc'),
        sourceKey: 'update:manager',
        action: { kind: 'open-settings', tab: 'about' }
      })
    } else {
      island.dismissSource('update:manager')
    }

    refreshKernelNotice()
  }

  async function initialSync(attempt = 0): Promise<void> {
    initialSyncOk = false
    await sync.updateRunningList({ force: true })
    if (disposed) return

    if (initialSyncOk) {
      initializing = false
      island.markBaseline(names())
      void refreshUpdateNotices()
      return
    }

    const delay = INITIAL_RETRY_DELAYS[attempt]
    if (delay === undefined) return
    retryTimer = window.setTimeout(() => {
      void initialSync(attempt + 1)
    }, delay)
  }

  const onVisibility = () => {
    if (document.hidden) return
    if (initializing) return
    void refreshUpdateNotices()
  }

  document.addEventListener('visibilitychange', onVisibility)
  void initialSync()

  onScopeDispose(() => {
    disposed = true
    window.clearTimeout(retryTimer)
    document.removeEventListener('visibilitychange', onVisibility)
  })
}
