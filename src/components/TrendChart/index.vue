<template>
  <div ref="rootEl" class="tc-root" role="img" :aria-label="summary">
    <!-- 当前值：替代旧图例，让「哪条线是什么、现在多少」一眼可读 -->
    <div class="tc-metrics" aria-hidden="true">
      <div class="tc-metric">
        <span class="tc-metric-label">
          <i class="tc-swatch tc-swatch-tx"></i>{{ t('newMonitor.trendTx') }}
        </span>
        <span class="tc-metric-value">
          {{ rateValue(last?.txRate) }}<small>{{ rateUnit(last?.txRate) }}</small>
        </span>
      </div>
      <div class="tc-metric">
        <span class="tc-metric-label">
          <i class="tc-swatch tc-swatch-rx"></i>{{ t('newMonitor.trendRx') }}
        </span>
        <span class="tc-metric-value">
          {{ rateValue(last?.rxRate) }}<small>{{ rateUnit(last?.rxRate) }}</small>
        </span>
      </div>
      <div class="tc-metric">
        <span class="tc-metric-label">
          <i class="tc-swatch tc-swatch-lat"></i>{{ t('newMonitor.trendLatency') }}
        </span>
        <span class="tc-metric-value">
          {{ last && last.latency > 0 ? last.latency.toFixed(1) : '—'
          }}<small v-if="last && last.latency > 0">ms</small>
        </span>
      </div>
    </div>

    <div
      v-if="plotPoints.length > 0"
      ref="plotEl"
      class="tc-plot"
      @pointermove="onPointerMove"
      @pointerdown="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <svg
        class="tc-svg"
        :viewBox="`0 0 ${chartWidth} ${CHART_H}`"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="tc-grad-tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="tc-stop-tx-top" />
            <stop offset="100%" class="tc-stop-tx-bottom" />
          </linearGradient>
          <linearGradient id="tc-grad-rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="tc-stop-rx-top" />
            <stop offset="100%" class="tc-stop-rx-bottom" />
          </linearGradient>
          <linearGradient id="tc-grad-lat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="tc-stop-lat-top" />
            <stop offset="100%" class="tc-stop-lat-bottom" />
          </linearGradient>
        </defs>

        <!-- 速率窗格：上限 / 中位 / 零三条刻度 -->
        <g>
          <line
            v-for="tick in rateTicks"
            :key="tick.key"
            :x1="PLOT_LEFT"
            :x2="plotRight"
            :y1="tick.y"
            :y2="tick.y"
            class="tc-grid"
            :class="{ 'tc-grid-base': tick.key === 'zero' }"
          />
          <text
            v-for="tick in rateTicks"
            :key="`label-${tick.key}`"
            :x="PLOT_LEFT - 7"
            :y="tick.y + 3.5"
            class="tc-axis-text"
            text-anchor="end"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- 时间刻度跟随真实采样点：数据未铺满时只出现在右侧，不悬在空白区域 -->
        <line
          v-if="midPoint"
          :x1="midPoint.x"
          :x2="midPoint.x"
          :y1="RATE_TOP"
          :y2="LAT_BOTTOM"
          class="tc-grid tc-grid-v"
        />
        <text
          v-if="firstPoint && showStartTime"
          :x="firstPoint.x"
          :y="X_LABEL_Y"
          class="tc-axis-text"
          text-anchor="start"
        >
          {{ clock(firstPoint.ts) }}
        </text>
        <text
          v-if="midPoint && showMidTime"
          :x="midPoint.x"
          :y="X_LABEL_Y"
          class="tc-axis-text"
          text-anchor="middle"
        >
          {{ clock(midPoint.ts) }}
        </text>
        <text :x="plotRight" :y="X_LABEL_Y" class="tc-axis-text" text-anchor="end">
          {{ t('newMonitor.trendNow') }}
        </text>

        <!-- 上传 / 下载共享字节轴（面积衬底 + 折线，按采样中断分段） -->
        <template v-for="(seg, index) in segmentPaths" :key="`rate-${index}`">
          <path :d="seg.rxArea" class="tc-area" fill="url(#tc-grad-rx)" />
          <path :d="seg.txArea" class="tc-area" fill="url(#tc-grad-tx)" />
          <path :d="seg.txLine" class="tc-line tc-line-tx" />
          <path :d="seg.rxLine" class="tc-line tc-line-rx" />
        </template>

        <!-- 延迟独立成条：不再与速率挤在同一坐标系 -->
        <rect
          :x="PLOT_LEFT"
          :y="LAT_TOP - 6"
          :width="plotWidth"
          :height="LAT_BOTTOM - LAT_TOP + 12"
          rx="8"
          class="tc-lat-bg"
        />
        <line
          :x1="PLOT_LEFT"
          :x2="plotRight"
          :y1="(LAT_TOP + LAT_BOTTOM) / 2"
          :y2="(LAT_TOP + LAT_BOTTOM) / 2"
          class="tc-grid tc-grid-lat"
        />
        <template v-for="(seg, index) in segmentPaths" :key="`lat-${index}`">
          <path v-if="seg.latArea" :d="seg.latArea" class="tc-area" fill="url(#tc-grad-lat)" />
          <path v-if="hasLatency && seg.latLine" :d="seg.latLine" class="tc-line tc-line-lat" />
        </template>
        <text :x="PLOT_LEFT - 7" :y="LAT_TOP + 3.5" class="tc-axis-text" text-anchor="end">
          {{ Math.round(maxLatency) }} ms
        </text>
        <text
          :x="PLOT_LEFT - 7"
          :y="(LAT_TOP + LAT_BOTTOM) / 2 + 3.5"
          class="tc-axis-text"
          text-anchor="end"
        >
          {{ Math.round(maxLatency / 2) }} ms
        </text>
        <text :x="PLOT_LEFT - 7" :y="LAT_BOTTOM + 3.5" class="tc-axis-text" text-anchor="end">
          0 ms
        </text>

        <!-- 当前采样端点 -->
        <circle
          :cx="lastPoint.x"
          :cy="rateY(lastPoint.txRate)"
          r="2.6"
          class="tc-endpoint tc-endpoint-tx"
        />
        <circle
          :cx="lastPoint.x"
          :cy="rateY(lastPoint.rxRate)"
          r="2.6"
          class="tc-endpoint tc-endpoint-rx"
        />
        <circle
          v-if="hasLatency"
          :cx="lastPoint.x"
          :cy="latY(lastPoint.latency)"
          r="2.6"
          class="tc-endpoint tc-endpoint-lat"
        />

        <!-- 悬停十字线与取值点 -->
        <g v-if="hoverPoint">
          <line
            :x1="hoverPoint.x"
            :x2="hoverPoint.x"
            :y1="RATE_TOP"
            :y2="LAT_BOTTOM"
            class="tc-crosshair"
          />
          <circle
            :cx="hoverPoint.x"
            :cy="rateY(hoverPoint.txRate)"
            r="3.2"
            class="tc-endpoint tc-endpoint-tx"
          />
          <circle
            :cx="hoverPoint.x"
            :cy="rateY(hoverPoint.rxRate)"
            r="3.2"
            class="tc-endpoint tc-endpoint-rx"
          />
          <circle
            v-if="hasLatency"
            :cx="hoverPoint.x"
            :cy="latY(hoverPoint.latency)"
            r="3.2"
            class="tc-endpoint tc-endpoint-lat"
          />
        </g>
      </svg>

      <div v-if="hoverPoint" class="tc-tooltip" :style="tooltipStyle" aria-hidden="true">
        <div class="tc-tooltip-time">{{ clockSec(hoverPoint.ts) }}</div>
        <div class="tc-tooltip-row">
          <span class="tc-tooltip-key">
            <i class="tc-swatch tc-swatch-tx"></i>{{ t('newMonitor.trendTx') }}
          </span>
          <span class="tc-tooltip-val">{{ fmtRate(hoverPoint.txRate) }}</span>
        </div>
        <div class="tc-tooltip-row">
          <span class="tc-tooltip-key">
            <i class="tc-swatch tc-swatch-rx"></i>{{ t('newMonitor.trendRx') }}
          </span>
          <span class="tc-tooltip-val">{{ fmtRate(hoverPoint.rxRate) }}</span>
        </div>
        <div class="tc-tooltip-row">
          <span class="tc-tooltip-key">
            <i class="tc-swatch tc-swatch-lat"></i>{{ t('newMonitor.trendLatency') }}
          </span>
          <span class="tc-tooltip-val">
            {{ hoverPoint.latency > 0 ? hoverPoint.latency.toFixed(1) + ' ms' : '—' }}
          </span>
        </div>
      </div>
    </div>

    <div v-else class="tc-empty">
      <span class="tc-empty-pulse" aria-hidden="true"></span>
      <span>{{ t('newMonitor.trendEmpty') }}</span>
      <span class="tc-empty-hint">{{ t('newMonitor.trendEmptyHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TrendChart — 运行趋势图（5.16，纯 SVG 手绘，遵循 KISS：不引图表库）
 *
 * 布局：上传/下载共用「速率」窗格，延迟下沉为独立窄条，不再把三种量纲叠在
 * 同一坐标系里。宽度用 ResizeObserver 实测后按 1:1 画布绘制，文本与线宽不会
 * 随容器拉伸；曲线用单调三次插值（Fritsch–Carlson）避免尖峰前后过冲。
 * 横轴采用固定点距并右对齐：采样不足时数据只占右侧，新点始终贴右边界；
 * 可见容量回写给缓冲层，画不出的历史点不再保留。
 * 悬浮十字线 + 浮层给出单点精确值；触屏按下同样可取点。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTrendBuffer, type TrendPoint } from '@/hooks/useTrendBuffer'

const props = defineProps<{ points: TrendPoint[] }>()

const { t } = useI18n()
const { setCapacity } = useTrendBuffer()

// 画布几何：高度固定，宽度为容器实测值（CSS px == SVG 用户单位）
const CHART_H = 200
const PLOT_LEFT = 58
const PLOT_RIGHT = 12
const RATE_TOP = 10
const RATE_BOTTOM = 110
const LAT_TOP = 138
const LAT_BOTTOM = 166
const X_LABEL_Y = 190
const MIN_BYTES_AXIS = 2 // 最小 2 B/s，避免 0/0.5 刻度取整后重复
const MIN_LATENCY_AXIS = 100
const TOOLTIP_WIDTH = 156
const POINT_SPACING = 8 // 每个采样点的固定横轴间距（px）

const rootEl = ref<HTMLElement | null>(null)
const plotEl = ref<HTMLElement | null>(null)
const chartWidth = ref(640)
let widthObserver: ResizeObserver | null = null

const measureWidth = (): void => {
  const width = rootEl.value?.clientWidth ?? 0
  if (width > 0) chartWidth.value = Math.max(280, Math.round(width))
}

onMounted(() => {
  measureWidth()
  setCapacity(pointCapacity.value)
  // 首帧后补测一次：挂载瞬间滚动条尚未落定，容器宽度可能还会变化
  requestAnimationFrame(() => {
    measureWidth()
    setCapacity(pointCapacity.value)
  })
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    widthObserver = new ResizeObserver(measureWidth)
    widthObserver.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  widthObserver?.disconnect()
  widthObserver = null
})

const plotWidth = computed(() => Math.max(120, chartWidth.value - PLOT_LEFT - PLOT_RIGHT))
const plotRight = computed(() => PLOT_LEFT + plotWidth.value)

// 可见容量：固定点距下容器最多摆几个点；回写缓冲层用于丢弃画不出的旧采样
const pointCapacity = computed(() => Math.max(2, Math.floor(plotWidth.value / POINT_SPACING) + 1))
// 画布实测宽度后才回写容量：挂载前的默认宽度较窄，过早裁剪会误删宽屏可显示的点
watch(pointCapacity, (next) => setCapacity(next))
// 每次采样追加时同步一次实测宽度：覆盖滚动条出现/消失等不触发窗口 resize 的布局变化
watch(() => props.points, measureWidth)

const visiblePoints = computed(() => {
  const cap = pointCapacity.value
  return props.points.length > cap ? props.points.slice(-cap) : props.points
})
const last = computed(() => visiblePoints.value[visiblePoints.value.length - 1])

// 轴上限取整（1/2/5 × 10ⁿ）：避免轮询追加采样点时纵轴随细微波动反复重排
const niceCeil = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 5]) {
    if (value <= step * exp) return step * exp
  }
  return 10 * exp
}

// 速率轴按展示单位（B/KB/MB 均以 1024 进位）取整，
// 保证刻度落到「200 KB/s」而不是 195.3 KB/s 这类零碎值
const niceAxisBytes = (value: number): number => {
  const K = 1024
  const M = K * K
  if (value <= K) return Math.max(MIN_BYTES_AXIS, niceCeil(value))
  if (value < M) return niceCeil(value / K) * K
  return niceCeil(value / M) * M
}

const rawMaxBytes = computed(() => {
  let max = MIN_BYTES_AXIS
  for (const p of visiblePoints.value) {
    max = Math.max(max, p.txRate, p.rxRate)
  }
  return max
})
const rawMaxLatency = computed(() => {
  let max = MIN_LATENCY_AXIS
  for (const p of visiblePoints.value) {
    max = Math.max(max, p.latency)
  }
  return max
})

// 轴上限迟滞：变大立即跟随；仅当原始值低于当前档位 1/4 时才收缩，
// 防止轮询时在档位边界来回切换导致整条曲线上下跳动（观感类似闪屏）
const maxBytes = ref(MIN_BYTES_AXIS)
const maxLatency = ref(MIN_LATENCY_AXIS)
watch(
  rawMaxBytes,
  (raw) => {
    const desired = niceAxisBytes(raw)
    if (desired > maxBytes.value || raw * 4 < maxBytes.value) maxBytes.value = desired
  },
  { immediate: true }
)
watch(
  rawMaxLatency,
  (raw) => {
    const desired = Math.max(MIN_LATENCY_AXIS, niceCeil(raw))
    if (desired > maxLatency.value || raw * 4 < maxLatency.value) maxLatency.value = desired
  },
  { immediate: true }
)
const hasLatency = computed(() => visiblePoints.value.some((p) => p.latency > 0))

interface PlotPoint extends TrendPoint {
  x: number
}

const plotPoints = computed<PlotPoint[]>(() => {
  const pts = visiblePoints.value
  const count = pts.length
  if (count === 0) return []
  // 固定点距 + 右对齐：采样不足时数据只占右侧，随采样增加向左铺开
  return pts.map((p, i) => ({ ...p, x: plotRight.value - (count - 1 - i) * POINT_SPACING }))
})
const firstPoint = computed(() => plotPoints.value[0])
const lastPoint = computed(() => plotPoints.value[plotPoints.value.length - 1])
const dataSpan = computed(() => Math.max(0, plotPoints.value.length - 1) * POINT_SPACING)
// 点数很少时首/中刻度会挤在右侧甚至互相重叠，空间足够后再显示
const showStartTime = computed(() => dataSpan.value >= 96)
const showMidTime = computed(() => dataSpan.value >= 160)
// 中点参考线取中间采样点本身，刻度与横轴位置严格对应
const midPoint = computed(() => {
  const pts = plotPoints.value
  if (pts.length < 3 || dataSpan.value < 160) return null
  return pts[Math.floor((pts.length - 1) / 2)]
})

const rateY = (value: number): number => {
  const ratio = Math.min(1, Math.max(0, value / maxBytes.value))
  return RATE_BOTTOM - ratio * (RATE_BOTTOM - RATE_TOP)
}
const latY = (value: number): number => {
  const ratio = Math.min(1, Math.max(0, value / maxLatency.value))
  return LAT_BOTTOM - ratio * (LAT_BOTTOM - LAT_TOP)
}

interface XY {
  x: number
  y: number
}

// 单调三次 Hermite 插值（Fritsch–Carlson）：曲线穿过全部采样点且不过冲，
// 避免 Catmull-Rom 在尖峰两侧拉出低于 0 或高于峰值的假波动
const monotonePath = (pts: XY[]): string => {
  const count = pts.length
  if (count < 2) return ''
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < count - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    slope[i] = (pts[i + 1].y - pts[i].y) / (dx[i] || 1)
  }
  const tangent: number[] = new Array(count).fill(0)
  tangent[0] = slope[0]
  tangent[count - 1] = slope[count - 2]
  for (let i = 1; i < count - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0
      continue
    }
    const w1 = 2 * dx[i] + dx[i - 1]
    const w2 = dx[i] + 2 * dx[i - 1]
    tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < count - 1; i++) {
    const h = dx[i] / 3
    const c1x = pts[i].x + h
    const c1y = pts[i].y + tangent[i] * h
    const c2x = pts[i + 1].x - h
    const c2y = pts[i + 1].y - tangent[i + 1] * h
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`
  }
  return d
}

const areaPath = (line: string, pts: XY[], baseline: number): string => {
  if (!line || pts.length < 2) return ''
  const first = pts[0]
  const end = pts[pts.length - 1]
  return `${line} L ${end.x.toFixed(1)} ${baseline} L ${first.x.toFixed(1)} ${baseline} Z`
}

// 采样中断阈值：超过该间隔（页面隐藏/轮询停止）曲线断开，不跨空档直接连线
const GAP_BREAK_MS = 60_000
const segments = computed<PlotPoint[][]>(() => {
  const pts = plotPoints.value
  const result: PlotPoint[][] = []
  let current: PlotPoint[] = []
  pts.forEach((p, i) => {
    if (i > 0 && p.ts - pts[i - 1].ts > GAP_BREAK_MS && current.length > 0) {
      result.push(current)
      current = []
    }
    current.push(p)
  })
  if (current.length > 0) result.push(current)
  return result
})

// 每段独立生成折线/面积路径；只有 1 个点的段不画线（端点圆点仍会显示最新值）
const segmentPaths = computed(() =>
  segments.value.map((seg) => {
    const txPts = seg.map((p) => ({ x: p.x, y: rateY(p.txRate) }))
    const rxPts = seg.map((p) => ({ x: p.x, y: rateY(p.rxRate) }))
    const latPts = seg.map((p) => ({ x: p.x, y: latY(p.latency) }))
    const txLine = monotonePath(txPts)
    const rxLine = monotonePath(rxPts)
    const latLine = monotonePath(latPts)
    return {
      txLine,
      rxLine,
      latLine,
      txArea: areaPath(txLine, txPts, RATE_BOTTOM),
      rxArea: areaPath(rxLine, rxPts, RATE_BOTTOM),
      latArea: hasLatency.value ? areaPath(latLine, latPts, LAT_BOTTOM) : ''
    }
  })
)

const rateTicks = computed(() => [
  { key: 'max', y: RATE_TOP, label: fmtRate(maxBytes.value) },
  { key: 'mid', y: (RATE_TOP + RATE_BOTTOM) / 2, label: fmtRate(maxBytes.value / 2) },
  { key: 'zero', y: RATE_BOTTOM, label: fmtRate(0) }
])

// 字节速率格式化（自适应精度）：B/s → KB/s → MB/s
const fmtRate = (v?: number): string => {
  if (v === undefined || v === null || v < 0) return '—'
  if (v >= 1024 * 1024) {
    const n = v / 1024 / 1024
    return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)} MB/s`
  }
  if (v >= 1024) {
    const n = v / 1024
    return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} KB/s`
  }
  return `${Math.round(v)} B/s`
}

// 数值与单位拆开排版：数值承担主层级，单位退为小字
const rateValue = (v?: number): string => fmtRate(v).split(' ')[0]
const rateUnit = (v?: number): string => {
  const parts = fmtRate(v).split(' ')
  return parts.length > 1 ? parts[1] : ''
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
// 时间窗口较短时补上次秒，避免首尾落在同一分钟导致两个刻度显示相同时间
const clock = (ts: number): string => {
  const pts = visiblePoints.value
  const shortSpan = pts.length >= 2 && pts[pts.length - 1].ts - pts[0].ts < 180_000
  const d = new Date(ts)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return shortSpan ? `${hm}:${pad2(d.getSeconds())}` : hm
}
const clockSec = (ts: number): string => {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 悬浮取点：按 x 距离找最近的采样点；空白左区不弹浮层，避免指向远端旧点
const hoverPoint = ref<PlotPoint | null>(null)

const onPointerMove = (event: PointerEvent): void => {
  const el = plotEl.value
  if (!el || plotPoints.value.length < 2) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const x = ((event.clientX - rect.left) / rect.width) * chartWidth.value
  const firstX = plotPoints.value[0].x
  if (x < firstX - POINT_SPACING / 2) {
    hoverPoint.value = null
    return
  }
  let nearest: PlotPoint | null = null
  let nearestDistance = Infinity
  for (const p of plotPoints.value) {
    const distance = Math.abs(p.x - x)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = p
    }
  }
  hoverPoint.value = nearest
}

const onPointerLeave = (): void => {
  hoverPoint.value = null
}

const tooltipStyle = computed(() => {
  const point = hoverPoint.value
  if (!point) return {}
  const gap = 12
  const preferLeft = point.x > chartWidth.value / 2
  const rawLeft = preferLeft ? point.x - gap - TOOLTIP_WIDTH : point.x + gap
  const left = Math.min(Math.max(rawLeft, 2), chartWidth.value - TOOLTIP_WIDTH - 2)
  return { left: `${(left / chartWidth.value) * 100}%` }
})

// 读屏摘要：当前上传/下载/延迟（图为纯装饰，摘要承担无障碍信息）
const summary = computed(() =>
  t('newMonitor.trendAria', {
    tx: fmtRate(last.value?.txRate),
    rx: fmtRate(last.value?.rxRate),
    latency: last.value && last.value.latency > 0 ? last.value.latency.toFixed(1) + ' ms' : '—'
  })
)
</script>

<style scoped>
.tc-root {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--theme-space-3);
}

/* ===== 顶部当前值：三列统计，同时充当图例 ===== */
.tc-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: var(--theme-space-1) var(--theme-space-4);
}

.tc-metric {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--theme-space-1);
  align-items: flex-start;
}

/* 分隔线两侧留出呼吸位，窄屏下文字也不会贴线 */
.tc-metric:first-child {
  padding-right: var(--theme-space-3);
}

.tc-metric + .tc-metric {
  padding-left: var(--theme-space-3);
  border-left: 1px solid var(--theme-border);
}

/* 左/中/右三锚点：数值变宽时位置不漂移，整行铺满卡片宽度 */
.tc-metric:nth-child(2) {
  padding-right: var(--theme-space-3);
  align-items: center;
}

.tc-metric:last-child {
  align-items: flex-end;
}

.tc-metric-label {
  display: inline-flex;
  font-family: var(--theme-font-body);
  font-size: 11px;
  letter-spacing: 0.3px;
  color: var(--theme-text-secondary);
  align-items: center;
  gap: 6px;
}

.tc-metric-value {
  overflow: hidden;
  font-family: var(--theme-font-display);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--theme-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tc-metric-value small {
  margin-left: 5px;
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 500;
  color: var(--theme-text-secondary);
}

.tc-swatch {
  display: inline-block;
  width: 12px;
  height: 3px;
  border-radius: 2px;
}

.tc-swatch-tx {
  background: var(--theme-color-success, #7fba8a);
}

.tc-swatch-rx {
  background: var(--theme-color-info, #8fb8d8);
}

.tc-swatch-lat {
  background: var(--theme-color-warning, #e6a23c);
}

/* ===== 画布：独立面板底色，与折叠卡片外层的标签色拉开层级 ===== */
.tc-plot {
  position: relative;
  min-width: 0;
  padding: var(--theme-space-2) 0;
  overflow: hidden;
  background: var(--theme-bg-card, #fff);
  border-radius: var(--theme-radius-md, 12px);
  box-shadow: inset 0 0 0 1px var(--theme-border, #ede4db);
  touch-action: pan-y;
  user-select: none;
}

.tc-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.tc-grid {
  stroke: var(--theme-border, #ede4db);
  stroke-width: 1;
  stroke-opacity: 0.55;
}

.tc-grid-base {
  stroke-opacity: 0.85;
}

.tc-grid-v {
  stroke-dasharray: 3 5;
  stroke-opacity: 0.4;
}

.tc-grid-lat {
  stroke-dasharray: 3 5;
  stroke-opacity: 0.45;
}

.tc-axis-text {
  font-family: var(--theme-font-body);
  font-size: 10px;
  font-variant-numeric: tabular-nums;

  /* 轴刻度和时间标签是要读的信息，用次级文字色保证 10px 下仍可辨认 */
  fill: var(--theme-text-secondary, #7a6e5e);
}

.tc-line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tc-line-tx {
  stroke: var(--theme-color-success, #7fba8a);
}

.tc-line-rx {
  stroke: var(--theme-color-info, #8fb8d8);
}

.tc-line-lat {
  stroke: var(--theme-color-warning, #e6a23c);
  stroke-width: 1.75;
}

.tc-stop-tx-top {
  stop-color: var(--theme-color-success, #7fba8a);
  stop-opacity: 0.18;
}

.tc-stop-tx-bottom {
  stop-color: var(--theme-color-success, #7fba8a);
  stop-opacity: 0.01;
}

.tc-stop-rx-top {
  stop-color: var(--theme-color-info, #8fb8d8);
  stop-opacity: 0.14;
}

.tc-stop-rx-bottom {
  stop-color: var(--theme-color-info, #8fb8d8);
  stop-opacity: 0.01;
}

.tc-stop-lat-top {
  stop-color: var(--theme-color-warning, #e6a23c);
  stop-opacity: 0.16;
}

.tc-stop-lat-bottom {
  stop-color: var(--theme-color-warning, #e6a23c);
  stop-opacity: 0.01;
}

/* 延迟窄条底：用主题标签色轻染，形成独立量纲分区但不喧宾夺主 */
.tc-lat-bg {
  fill: var(--theme-bg-tag, #f5ede6);
  fill-opacity: 0.55;
  stroke: var(--theme-border, #ede4db);
  stroke-opacity: 0.35;
  stroke-width: 1;
}

.tc-endpoint {
  stroke: var(--theme-bg-card, #fff);
  stroke-width: 1.5;
}

.tc-endpoint-tx {
  fill: var(--theme-color-success, #7fba8a);
}

.tc-endpoint-rx {
  fill: var(--theme-color-info, #8fb8d8);
}

.tc-endpoint-lat {
  fill: var(--theme-color-warning, #e6a23c);
  stroke: var(--theme-bg-tag, #f5ede6);
}

.tc-crosshair {
  stroke: var(--theme-text-muted, #c8bdb2);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  stroke-opacity: 0.6;
}

/* ===== 悬浮浮层 ===== */
.tc-tooltip {
  position: absolute;
  top: calc(var(--theme-space-2) + 2px);
  z-index: 2;
  width: 156px;
  padding: 6px 8px;
  pointer-events: none;
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-sm, 10px);
  box-shadow: var(--theme-shadow-sm, 0 8px 28px rgb(74 55 40 / 6%));
  box-sizing: border-box;
}

.tc-tooltip-time {
  margin-bottom: 4px;
  font-family: var(--theme-font-body);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-muted, #c8bdb2);
}

.tc-tooltip-row {
  display: flex;
  font-family: var(--theme-font-body);
  font-size: 11px;
  color: var(--theme-text-secondary, #7a6e5e);
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tc-tooltip-row + .tc-tooltip-row {
  margin-top: 2px;
}

.tc-tooltip-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.tc-tooltip-val {
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-primary, #4a3728);
}

/* ===== 空态 ===== */
.tc-empty {
  display: flex;
  min-height: 216px;
  padding: var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  text-align: center;
  background: var(--theme-bg-card, #fff);
  border: 1px dashed var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--theme-space-1);
}

.tc-empty-hint {
  font-size: 11px;
  opacity: 0.8;
}

.tc-empty-pulse {
  width: 6px;
  height: 6px;
  margin-bottom: 2px;
  background: var(--theme-accent-primary, #e8a0a0);
  border-radius: 50%;
  animation: tc-pulse 1.8s ease-in-out infinite;
}

@keyframes tc-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tc-empty-pulse {
    opacity: 0.8;
    animation: none;
  }
}
</style>
