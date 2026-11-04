/**
 * 监控趋势采样：在轮询快照之上计算速率差分，并同步到共享趋势缓冲（5.16）。
 * 只负责采样与图表可见数据，不持有轮询状态；缓冲本体仍在 shared/composables/useTrendBuffer。
 */
import { ref, type Ref } from 'vue'
import { useTrendBuffer, type TrendPoint } from '@/shared/composables/useTrendBuffer'

interface TrendSnapshot {
  txTotal: number
  rxTotal: number
  avgLatency: string
}

interface UseTrendSeriesOptions {
  /** 当前选中实例（趋势跟随选中项切换） */
  selectedConfig: Ref<RunningItem | null>
}

export function useTrendSeries(options: UseTrendSeriesOptions) {
  const { getTrend, pushTrend, clearTrend } = useTrendBuffer()

  // 缓冲为模块级非响应式结构：computed 只依赖 selectedConfig 无法感知原地 push，
  // 故用 ref + push 后手动替换引用（syncTrend）保证图表实时刷新
  const trendPoints = ref<TrendPoint[]>([])
  // 上次累计流量样本（用于速率差分）
  const lastRateSample = ref<Record<string, { tx: number; rx: number; ts: number }>>({})

  const syncTrend = (configName?: string) => {
    if (configName && configName !== options.selectedConfig.value?.configFileName) return
    trendPoints.value = options.selectedConfig.value
      ? getTrend(options.selectedConfig.value.configFileName)
      : []
  }

  const recordTrend = (configName: string, snapshot: TrendSnapshot) => {
    const prev = lastRateSample.value[configName]
    const now = Date.now()
    if (prev && now > prev.ts) {
      const dt = (now - prev.ts) / 1000
      pushTrend(configName, {
        ts: now,
        txRate: Math.max(0, (snapshot.txTotal - prev.tx) / dt),
        rxRate: Math.max(0, (snapshot.rxTotal - prev.rx) / dt),
        latency: parseFloat(snapshot.avgLatency) || 0
      })
      syncTrend(configName)
    }
    lastRateSample.value[configName] = { tx: snapshot.txTotal, rx: snapshot.rxTotal, ts: now }
  }

  /** 丢弃累计流量基线：隐藏期间差分跨度可能失真，恢复/切换后首个采样仅作基线 */
  const resetBaseline = (configName: string) => {
    delete lastRateSample.value[configName]
  }

  /** 清空某配置的趋势缓冲（实例停止时调用） */
  const clearConfigTrend = (configName: string) => {
    clearTrend(configName)
  }

  return { trendPoints, syncTrend, recordTrend, resetBaseline, clearConfigTrend }
}
