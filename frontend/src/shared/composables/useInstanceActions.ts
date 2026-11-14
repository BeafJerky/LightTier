/**
 * 内核实例启停链路
 *
 * 总览页与配置管理页共用的「预检 → 启动 → 失败回滚 → 停止清理」流程：
 * - 兼容性预检：当前内核会拒绝的配置（如 v2.7.0 未知 flag）需确认后才启动；
 * - 端口冲突预检（可选）：运行中配置占用监听/RPC 端口时直接跳过并提示；
 * - Android 单实例：已有其他配置运行时确认后「停旧起新」；
 * - autoMetric：启动前记录、失败/停止后恢复网卡自动跃点；
 * - 停止后清理趋势缓冲与出口路由。
 *
 * 确认弹窗、出口路由应用与兼容跳过提示由调用页注入，保持各页交互与文案不变。
 * 启动失败会抛出异常，便于总览页的串行队列跳过该项继续执行。
 */
import { useI18n } from 'vue-i18n'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandStore } from '@/shared/store/island'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useAutoMetric } from '@/shared/composables/useAutoMetric'
import { useTrendBuffer } from '@/shared/composables/useTrendBuffer'
import { useConfigCompatCheck } from '@/shared/composables/useConfigCompatCheck'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import * as coreApi from '@/shared/platform/coreApi'
import { isAndroid } from '@/shared/platform/platformUtil'
import { isTauri } from '@tauri-apps/api/core'
import { clearExitRoute } from '@/shared/platform/routeUtil'

export interface InstanceActionsOptions {
  /** 确认弹窗（由页面注入，复用各页自己的 CreamDialog） */
  confirm: (title: string, message: string) => Promise<boolean>
  /** 兼容性拦截确认文案 key（参数 {name} / {issues}） */
  compatMessageKey?: string
  /** 启动前端口冲突预检（总览页启用） */
  portConflictCheck?: boolean
  /** 端口冲突定位回调：配置名（不带 .toml）→ 冲突端口列表 */
  onPortConflict?: (occupied: Record<string, number[]>) => void
  /** 自动运行遇兼容错误时的提示；未提供则静默跳过 */
  onAutoCompatSkip?: (configFileName: string, issues: string) => void
  /** 停止后清理出口路由的守卫（缺省仅桌面） */
  exitRouteGuard?: () => boolean
  /** 启动成功后的额外动作（出口路由等），自身异常不影响启动结果 */
  afterStart?: (item: RunningItem, auto: boolean) => Promise<void>
}

export function useInstanceActions(options: InstanceActionsOptions) {
  const easyTierStore = useEasyTierStore()
  const { t } = useI18n()
  const { show: toast } = useCreamToast()
  const { getCompatIssues } = useConfigCompatCheck()
  const { updateRunningList } = useRunningListSync()
  const { beforeStart: autoMetricBeforeStart, afterStop: autoMetricAfterStop } = useAutoMetric()
  const { clearTrend } = useTrendBuffer()
  const isAndroidPlatform = isAndroid()
  const island = useIslandStore()
  // 灵动岛只在桌面布局挂载，Android 只保留原有 toast
  const reportIsland = !isAndroidPlatform
  const compatMessageKey = options.compatMessageKey ?? 'newConfig.compatBlockMsg'

  const formatCompatIssues = (issues: { code: string; params?: Record<string, any> }[]): string =>
    issues.map((i) => t(`coreCompat.${i.code}`, i.params || {})).join('\n')

  const startInstance = async (item: RunningItem, opts: { auto?: boolean } = {}): Promise<void> => {
    if (!item.fileName) return
    const fileName = item.fileName

    // 版本兼容预检：当前内核会拒绝的配置拦截启动，自动运行只提示并跳过
    const compatErrors = (await getCompatIssues(fileName)).filter((i) => i.level === 'error')
    if (compatErrors.length > 0) {
      const issues = formatCompatIssues(compatErrors)
      if (opts.auto) {
        options.onAutoCompatSkip?.(item.configFileName, issues)
        throw new Error('compat-blocked')
      }
      const confirmed = await options.confirm(
        t('newConfig.compatBlockTitle'),
        t(compatMessageKey, { name: item.configFileName, issues })
      )
      if (!confirmed) throw new Error('compat-cancelled')
    }

    // 启动前端口预检：监听端口与运行中配置冲突时直接跳过并提示
    if (options.portConflictCheck) {
      const conflicts = await coreApi.checkPortConflicts(fileName)
      if (conflicts.length > 0) {
        // 定位冲突根源：正在占用端口的配置卡片描红闪烁，toast 展示被占配置名与端口
        const occupied: Record<string, number[]> = {}
        conflicts.forEach((c) => {
          const name = c.conflictConfig.replace('.toml', '')
          occupied[name] = [...new Set([...(occupied[name] || []), c.port])]
        })
        options.onPortConflict?.(occupied)
        const configNames = [
          ...new Set(conflicts.map((c) => c.conflictConfig.replace('.toml', '')))
        ].join(', ')
        const ports = [...new Set(conflicts.map((c) => c.port))].join(', ')
        toast(t('newOverview.portConflict', { config: configNames, port: ports }), 'error', 4000)
        if (reportIsland) {
          island.notify({
            type: 'error',
            title: t('newIsland.portConflict', { name: item.configFileName }),
            detail: t('newIsland.portConflictDesc', { port: ports, conflict: configNames }),
            sourceKey: `feedback:port:${item.configFileName}`,
            quiet: true
          })
        }
        throw new Error('port-conflict')
      }
    }

    // Android 单实例模型：已有其他配置运行时，二次确认后停旧起新
    if (isAndroidPlatform) {
      const current = easyTierStore.runningList.find(
        (r) => r.configFileName !== item.configFileName
      )
      if (current) {
        const confirmed = await options.confirm(
          t('newOverview.androidSwitchTitle'),
          t('newOverview.androidSwitchConfirm', {
            current: current.configFileName,
            next: item.configFileName
          })
        )
        if (!confirmed) throw new Error('switch-cancelled')
        if (reportIsland) island.expectStop(current.configFileName)
        const stopped = await coreApi.stopConfig(current)
        if (!stopped) {
          toast(t('newCommon.stoppedFail'), 'error')
          throw new Error('stop-old-failed')
        }
        easyTierStore.removeRunningList(current.configFileName)
      }
    }

    try {
      await autoMetricBeforeStart(fileName)
      await coreApi.startConfig(fileName)
      easyTierStore.stopLoop = false
      easyTierStore.p2pNotify = true
      easyTierStore.setLastRunConfigName(item)
      await updateRunningList({ force: true })
      // 同一事件只走一条通道：岛可用时由岛确认，否则回退 toast
      const handledByIsland =
        reportIsland &&
        island.notify({
          type: 'feedback',
          title: t('newIsland.startOk', { name: item.configFileName })
        })
      if (!handledByIsland) toast(t('newCommon.startSuccess'), 'success')
    } catch (e: any) {
      // 失败自动回滚该配置的 AutoMetric 状态（不影响其他配置的持有计数）
      await autoMetricAfterStop(fileName)
      // 展示内核真实错误，便于定位（invoke 拒绝值可能是字符串或 Error）
      const detail = typeof e === 'string' ? e : e?.message
      const base = isAndroidPlatform
        ? t('newOverview.startFailAndroid')
        : t('newOverview.startFailCore')
      toast(detail ? `${base}（${detail}）` : base, 'error', 6000)
      if (reportIsland) {
        // 失败详情必须留在 toast；岛上只补一个不展开的角标
        island.notify({
          type: 'error',
          title: t('newIsland.startFailed', { name: item.configFileName }),
          detail,
          sourceKey: `feedback:start:${item.configFileName}`,
          quiet: true
        })
      }
      throw new Error('start-failed', { cause: e })
    }

    if (options.afterStart) {
      try {
        await options.afterStart(item, Boolean(opts.auto))
      } catch (e) {
        if (isTauri()) console.warn('[InstanceActions] 启动后处理失败:', e)
      }
    }
  }

  // 停止配置：Android 停 VPN+内核，桌面结束子进程；成功后恢复网卡跃点并清理出口路由
  const stopInstance = async (item: RunningItem): Promise<boolean> => {
    const running = easyTierStore.runningList.find((r) => r.configFileName === item.configFileName)
    let stopped = true
    // 主动停止是预期行为：先登记，运行态差集才不会误报为掉线
    if (reportIsland) island.expectStop(item.configFileName)
    // Android：停 VPN + 内核实例（无 pid）；桌面：结束子进程
    if (isAndroidPlatform || running?.pid) {
      const ok = await coreApi.stopConfig(running ?? item)
      if (ok) {
        easyTierStore.stopLoop = true
        easyTierStore.removeRunningList(item.configFileName)
        const handledByIsland =
          reportIsland &&
          island.notify({
            type: 'feedback',
            title: t('newIsland.stopOk', { name: item.configFileName })
          })
        if (!handledByIsland) toast(t('newCommon.stoppedSuccess'), 'success')
      } else {
        stopped = false
        toast(t('newCommon.stoppedFail'), 'error')
        if (reportIsland) {
          island.notify({
            type: 'error',
            title: t('newIsland.stopFailed', { name: item.configFileName }),
            sourceKey: `feedback:stop:${item.configFileName}`,
            quiet: true
          })
        }
      }
    } else {
      easyTierStore.removeRunningList(item.configFileName)
    }
    if (!stopped) return false
    await autoMetricAfterStop(item.fileName)
    clearTrend(item.configFileName)
    // 只清理当前配置持有的出口路由；失败时保留记录以便重试/残留检查
    const shouldClearRoute = options.exitRouteGuard
      ? options.exitRouteGuard()
      : isTauri() && !isAndroidPlatform
    if (shouldClearRoute) {
      const routeResult = await clearExitRoute(item.configFileName)
      if (routeResult.failed > 0) {
        toast(t('newConfig.exitRouteFail'), 'error', 4000)
      } else if (routeResult.cleared > 0) {
        toast(t('newConfig.exitRouteAutoCleared'), 'success')
      }
    }
    // 停止后立即对齐后端运行态，避免残留条目等到下一个扫描周期
    await updateRunningList({ force: true })
    return true
  }

  return { startInstance, stopInstance }
}
