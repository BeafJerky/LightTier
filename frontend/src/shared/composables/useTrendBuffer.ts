// === 5.16 历史趋势缓冲（每配置环形缓冲区，模块级存活，跨页面不丢） ===

/** 趋势采样点：速率（B/s）与平均延迟（ms） */
export interface TrendPoint {
  ts: number
  txRate: number
  rxRate: number
  latency: number
}

/** 图表可容纳的采样点上限（由 TrendChart 按容器宽度回写，画不出的旧点直接丢弃） */
const DEFAULT_CAPACITY = 256
let capacity = DEFAULT_CAPACITY

const buffers = new Map<string, TrendPoint[]>()

export const useTrendBuffer = () => {
  /** 同步图表可见容量：缩窗时立即裁掉已经无法展示的历史点 */
  const setCapacity = (next: number): void => {
    const normalized = Math.max(2, Math.floor(next))
    if (normalized === capacity) return
    capacity = normalized
    for (const buf of buffers.values()) {
      if (buf.length > capacity) buf.splice(0, buf.length - capacity)
    }
  }

  /** 取某配置的趋势点（副本） */
  const getTrend = (configName: string): TrendPoint[] => [...(buffers.get(configName) || [])]

  /** 追加采样点（只保留图表当前画得出来的最近 capacity 个点） */
  const pushTrend = (configName: string, point: TrendPoint): void => {
    let buf = buffers.get(configName)
    if (!buf) {
      buf = []
      buffers.set(configName, buf)
    }
    buf.push(point)
    if (buf.length > capacity) buf.splice(0, buf.length - capacity)
  }

  /** 清空某配置缓冲（配置停止/删除时调用） */
  const clearTrend = (configName: string): void => {
    buffers.delete(configName)
  }

  return { setCapacity, getTrend, pushTrend, clearTrend }
}
