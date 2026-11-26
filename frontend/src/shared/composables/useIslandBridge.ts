// frontend/src/shared/composables/useIslandBridge.ts
import { onScopeDispose, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { t } from '@/shared/i18n/t'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandStore } from '@/shared/store/island'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import { pickLatestManagerRelease } from '@/shared/lib/releaseUtil'
import { collectQualitySamples } from '@/shared/lib/island/health'
import { compareVersions, getAppVersion } from '@/shared/platform/sysUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { backendMode, backendRuntime } from '@/shared/platform/backend'
import {
  onHealthSnapshot,
  runtimeAvailable,
  subscribeHealth,
  toRuntimeInstance,
  unsubscribeHealth
} from '@/shared/platform/runtimeApi'
import { DEFAULT_CORE_VERSION } from '@/entities/kernel/kernelCompat'

const INITIAL_RETRY_DELAYS = [5_000, 15_000]
const INITIAL_RETRY_MAX_MS = 30_000
/** 后台健康采样节奏；后端下限 5s，监控页活跃时由后端自动让行 */
const HEALTH_INTERVAL_MS = 10_000

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
  let healthUnlisten: UnlistenFn | null = null
  let healthKey = ''
  let healthSyncChain: Promise<void> = Promise.resolve()
  let agentHealthTimer = 0
  let agentHealthKey = ''

  const sync = useRunningListSync({
    onError: () => {
      initialSyncOk = false
    },
    onSuccess: () => {
      initialSyncOk = true
    }
  })

  const names = () => easy.runningList.map((item) => item.configFileName)

  const healthWanted = (): boolean =>
    !isAndroid() && island.settings.enabled && island.settings.types.quality

  const stopHealth = async (): Promise<void> => {
    if (!runtimeAvailable() || !healthKey) return
    healthKey = ''
    try {
      await unsubscribeHealth()
    } catch {
      /* 后端已随应用退出时忽略 */
    }
  }

  const syncHealth = async (): Promise<void> => {
    if (!runtimeAvailable() || disposed) return
    if (!healthWanted()) {
      await stopHealth()
      return
    }
    const instances = easy.runningList.map(toRuntimeInstance)
    if (!instances.length) {
      await stopHealth()
      return
    }
    const key = instances.map((item) => item.configFileName).join('|')
    if (key === healthKey) return
    healthKey = key
    try {
      await subscribeHealth(instances, HEALTH_INTERVAL_MS)
    } catch {
      // 失败后允许下一次运行态变化重新订阅
      healthKey = ''
    }
  }

  const agentHealthWanted = (): boolean =>
    backendMode() === 'agent' &&
    island.settings.enabled &&
    island.settings.types.quality &&
    easy.runningList.length > 0

  const stopAgentHealth = (): void => {
    agentHealthKey = ''
    window.clearTimeout(agentHealthTimer)
    agentHealthTimer = 0
  }

  const agentHealthTick = async (key: string): Promise<void> => {
    if (disposed || agentHealthKey !== key) return
    if (!agentHealthWanted() || document.visibilityState !== 'visible') {
      stopAgentHealth()
      return
    }
    try {
      const snapshot = await backendRuntime().health()
      // 实例集合已变化或已卸载：旧请求的结果不再上报，也不再续期
      if (disposed || agentHealthKey !== key) return
      for (const { name, sample } of collectQualitySamples(snapshot.instances)) {
        island.reportQuality(name, sample)
      }
    } catch {
      // 采样失败静默跳过本轮，按原节奏等下一轮，不做连续重试
    }
    if (disposed || agentHealthKey !== key) return
    if (!agentHealthWanted() || document.visibilityState !== 'visible') {
      stopAgentHealth()
      return
    }
    agentHealthTimer = window.setTimeout(() => {
      agentHealthTimer = 0
      void agentHealthTick(key)
    }, HEALTH_INTERVAL_MS)
  }

  const syncAgentHealth = (): void => {
    if (backendMode() !== 'agent' || disposed) return
    if (!agentHealthWanted() || document.visibilityState !== 'visible') {
      stopAgentHealth()
      return
    }
    const key = names().join('|')
    if (key === agentHealthKey) return
    stopAgentHealth()
    agentHealthKey = key
    void agentHealthTick(key)
  }

  const scheduleHealthSync = (): void => {
    healthSyncChain = healthSyncChain.then(syncHealth).catch(() => {})
    syncAgentHealth()
  }

  if (runtimeAvailable()) {
    void onHealthSnapshot((snapshot) => {
      if (!healthWanted()) return
      for (const { name, sample } of collectQualitySamples(snapshot.instances)) {
        island.reportQuality(name, sample)
      }
    })
      .then((unlisten) => {
        if (disposed) {
          void unlisten()
          return
        }
        healthUnlisten = unlisten
      })
      .catch(() => {})
  }

  watch(names, (next) => {
    if (initializing) return
    island.applyRunningNames(next)
    scheduleHealthSync()
  })

  watch(
    () => [island.settings.enabled, island.settings.types.quality],
    () => scheduleHealthSync()
  )

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
      const generation = island.beginManagerUpdateCheck()
      try {
        const releases = await easy.refreshManagerReleaseInfo()
        if (!island.isManagerUpdateCheckCurrent(generation)) return
        version = pickLatestManagerRelease(releases, easy.updateStableOnly)?.tag_name ?? ''
        island.absorbManagerRelease(version)
      } catch {
        // 网络失败静默：沿用已记录的版本，不把临时错误变成常驻红点
      } finally {
        island.finishManagerUpdateCheck(generation)
      }
    }

    const appVersion = await readAppVersion()
    if (version !== island.latestManagerVersion) return
    if (version && appVersion && compareVersions(version, appVersion) > 0) {
      const present = island.shouldPresentManagerUpdate(version)
      island.notify({
        type: 'update',
        title: t('newIsland.managerUpdate', { version }),
        detail: t('newIsland.managerUpdateDesc'),
        sourceKey: 'update:manager',
        action: { kind: 'open-settings', tab: 'about' },
        quiet: !present
      })
      if (present) island.markManagerUpdatePresented(version)
    } else {
      island.dismissSource('update:manager')
    }

    refreshKernelNotice()
  }

  let initialSyncing = false
  let initialAttempt = 0

  async function initialSync(): Promise<void> {
    if (initialSyncing || disposed) return
    initialSyncing = true
    initialSyncOk = false
    try {
      await sync.updateRunningList({ force: true })
    } finally {
      initialSyncing = false
    }
    if (disposed) return

    if (initialSyncOk) {
      initializing = false
      initialAttempt = 0
      island.markBaseline(names())
      scheduleHealthSync()
      void refreshUpdateNotices()
      return
    }

    const delay = INITIAL_RETRY_DELAYS[initialAttempt] ?? INITIAL_RETRY_MAX_MS
    initialAttempt += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      void initialSync()
    }, delay)
  }

  const onVisibility = () => {
    if (document.hidden) {
      stopAgentHealth()
      return
    }
    syncAgentHealth()
    if (initializing) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
      void initialSync()
      return
    }
    void refreshUpdateNotices()
  }

  document.addEventListener('visibilitychange', onVisibility)
  scheduleHealthSync()
  void initialSync()

  onScopeDispose(() => {
    disposed = true
    window.clearTimeout(retryTimer)
    stopAgentHealth()
    document.removeEventListener('visibilitychange', onVisibility)
    healthUnlisten?.()
    healthUnlisten = null
    void stopHealth()
  })
}
