<template>
  <div class="nd">
    <div v-if="isQueued" class="nd-queue-bar">
      <span class="nd-queue-icon">⟳</span>
      <span class="nd-queue-text">
        {{ t('newOverview.queueStarting', { name: queueRunningName, left: queueLeftCount }) }}
      </span>
    </div>

    <div class="nd-section">
      <div class="nd-stats">
        <div class="nd-stat-card">
          <div class="nd-stat-icon running">▶</div>
          <div class="nd-stat-body">
            <span class="nd-stat-num">{{ runningCount }}</span>
            <span class="nd-stat-lbl">{{ t('newCommon.running') }}</span>
          </div>
        </div>
        <div class="nd-stat-card">
          <div class="nd-stat-icon stopped">■</div>
          <div class="nd-stat-body">
            <span class="nd-stat-num">{{ stoppedCount }}</span>
            <span class="nd-stat-lbl">{{ t('newCommon.stopped') }}</span>
          </div>
        </div>
        <div class="nd-stat-card">
          <div class="nd-stat-icon total">◈</div>
          <div class="nd-stat-body">
            <span class="nd-stat-num">{{ totalCount }}</span>
            <span class="nd-stat-lbl">{{ t('newOverview.totalConfig') }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="nd-section">
      <div class="nd-grid" v-loading="easyTierStore.configListLoading">
        <div
          v-for="cfg in displayList"
          :key="cfg.configFileName"
          class="nd-config-card"
          :class="{ 'ndc-conflict': cfg.conflictPorts.length > 0 }"
        >
          <div class="ndc-top">
            <div class="ndc-status">
              <span class="ndc-dot" :class="cfg.running ? 'on' : 'off'"></span>
              <span class="ndc-status-text">{{
                cfg.running ? t('newCommon.running') : t('newCommon.stopped')
              }}</span>
            </div>
            <div class="ndc-top-right">
              <span v-if="cfg.conflictPorts.length > 0" class="ndc-conflict-badge"
                >⚠ {{ cfg.conflictPorts.join(', ') }}</span
              >
              <span v-if="cfg.pid" class="ndc-pid">PID{{ cfg.pid }}</span>
              <span v-if="cfg.virtualIp" class="ndc-vip">{{ cfg.virtualIp }}</span>
            </div>
          </div>
          <div class="ndc-name">{{ cfg.configFileName }}</div>
          <div v-if="cfg.running" class="ndc-summary">
            <template v-if="summaryMap[cfg.configFileName]">
              ● {{ summaryMap[cfg.configFileName].nodeCount }} {{ t('newOverview.nodes') }} ·
              {{ summaryMap[cfg.configFileName].avgLatency }}
            </template>
            <template v-else>…</template>
          </div>
          <div class="ndc-actions">
            <button class="ndc-btn ndc-btn-run" :disabled="cfg.running" @click="startAction(cfg)">{{
              t('newCommon.start')
            }}</button>
            <button
              class="ndc-btn ndc-btn-stop"
              :disabled="!cfg.running"
              @click="stopAction(cfg)"
              >{{ t('newCommon.stop') }}</button
            >
          </div>
        </div>
        <div v-if="displayList.length === 0 && !easyTierStore.configListLoading" class="nd-empty">
          <p>{{ t('newCommon.noConfig') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * overview — 网络总览页（统计卡片 + 配置卡片网格）
 *
 * 核心职责：展示各配置的运行状态与监控摘要（5.2 monitorSummary），提供启动/停止入口。
 * 启动链路（与 config-view 的差异）：入队串行启动（useStartQueue）→ 端口冲突预检
 * → Android 单实例“停旧起新”→ autoMetric 记录 → 失败回滚兜底。
 * 自动运行：首次加载时按持久化设置（localStorage settings.autoRunNetwork）自动启动指定配置。
 * 平台差异：Android 卡片展示虚拟 IP（无 PID）；桌面展示 PID。
 */
import { useEasyTierStore } from '@/store/modules/easytier'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useCreamToast } from '@/hooks/useCreamToast'
import { useI18n } from 'vue-i18n'
import { useAutoMetric } from '@/hooks/useAutoMetric'
import { useStartQueue } from '@/hooks/useStartQueue'
import { useMockData } from '@/hooks/useMockData'
import * as coreApi from '@/utils/coreApi'
import * as toml from 'smol-toml'
import { CONFIG_PATH } from '@/constants/easytier'
import { checkConfigCompat } from '@/utils/kernelCompatUtil'
import { migrateLightTierConfig } from '@/utils/lighttierConfigUtil'
import { isAndroid } from '@/utils/platformUtil'

defineOptions({ name: 'NewOverview' })

const easyTierStore = useEasyTierStore()
// 启动队列：避免并发启动导致端口抢占与状态错乱
const { runningFileName, queueLength, isQueued, enqueue } = useStartQueue()

const { show: toast } = useCreamToast()
const { t } = useI18n()
const { readFileContent, writeFileContent } = useMockData()
// 自动跃点：启动前记录、停止后恢复
const { beforeStart: autoMetricBeforeStart, afterStop: autoMetricAfterStop } = useAutoMetric()

// 当前内核下该配置的兼容性错误（会阻止内核启动）；读取/解析失败时不做拦截
const getCompatErrors = async (fileName: string) => {
  try {
    const raw = (await readFileContent(`${CONFIG_PATH}/${fileName}`)) as string
    const cfg = toml.parse(raw) as Record<string, any>
    // 旧版 LightTier 私有标记先迁移并落盘：v2.7.0 会把 flags._enable_exit_route 当作未知键拒绝启动
    if (migrateLightTierConfig(cfg)) {
      try {
        await writeFileContent(`${CONFIG_PATH}/${fileName}`, toml.stringify(cfg))
      } catch {
        /* 回写失败不阻断校验，下次启动/编辑会再次尝试 */
      }
    }
    return checkConfigCompat(cfg, easyTierStore.detectedCoreVersion).filter(
      (i) => i.level === 'error'
    )
  } catch {
    return []
  }
}
const formatCompatIssues = (issues: { code: string; params?: Record<string, any> }[]): string =>
  issues.map((i) => t(`coreCompat.${i.code}`, i.params || {})).join('\n')

// 顶部统计：运行中 / 已停止 / 配置总数
const runningCount = computed(() => easyTierStore.runningList.length)
const stoppedCount = computed(
  () => easyTierStore.configList.length - easyTierStore.runningList.length
)
const totalCount = computed(() => easyTierStore.configList.length)

// 5.2：监控摘要快照（monitor 轮询成功后写入，无缓存显示兜底）
const summaryMap = computed(() => easyTierStore.monitorSummaryMap)

// 配置卡片数据：合并运行状态（pid / 虚拟 IP）与端口冲突标记
const displayList = computed(() => {
  const runningSet = new Set(easyTierStore.runningList.map((r) => r.configFileName))
  const runMap = new Map(easyTierStore.runningList.map((r) => [r.configFileName, r]))
  return easyTierStore.configList.map((c) => ({
    ...c,
    running: runningSet.has(c.configFileName),
    pid: runMap.get(c.configFileName)?.pid,
    // Android：实例虚拟 IP（桌面恒为 undefined）
    virtualIp: runMap.get(c.configFileName)?.virtualIp,
    // 端口冲突定位：非空时卡片描红闪烁（conflictMap 由启动预检写入）
    conflictPorts: conflictMap.value[c.configFileName] || []
  }))
})

// 队列提示：正在启动的配置名与剩余排队数
const queueRunningName = computed(() => runningFileName.value.replace('.toml', ''))
const queueLeftCount = computed(() => Math.max(0, queueLength.value - 1))

// 端口冲突定位：configFileName → 冲突端口列表，驱动卡片描红闪烁（toast 生命周期内自动恢复）
const conflictMap = ref<Record<string, number[]>>({})
let conflictTimer: TimeoutHandle | null = null
// 清理冲突高亮定时器（重复冲突或页面卸载时调用，避免残留计时）
const clearConflictTimer = () => {
  if (conflictTimer) {
    clearTimeout(conflictTimer)
    conflictTimer = null
  }
}

// 运行时状态刷新（FAB 已负责文件加载）
const refreshRuntimeState = async () => {
  await updateRunningList()
}

// 从内核拉取运行实例列表，浏览器环境静默忽略
const updateRunningList = async () => {
  try {
    const names = easyTierStore.configList.map((c) => c.configFileName)
    const newList = await coreApi.getRunningList(names)
    easyTierStore.setRunningList(newList)
  } catch {
    /* non-Tauri */
  }
}

// 启动配置：经启动队列串行执行（含版本兼容预检、端口预检、Android 停旧起新、失败回滚与提示）
// auto=true 时用于冷启动自动运行：兼容错误只提示并跳过，不弹确认框
const startAction = async (item: RunningItem, opts: { auto?: boolean } = {}) => {
  if (!item.fileName) return
  // 入队串行启动：冲突/失败项跳过，不阻塞剩余队列
  await enqueue(item.fileName, async (fileName) => {
    // 版本兼容预检：当前内核会拒绝的配置（如 v2.7.0 未知 flag）拦截启动
    const compatErrors = await getCompatErrors(fileName)
    if (compatErrors.length > 0) {
      const issues = formatCompatIssues(compatErrors)
      if (opts.auto) {
        toast(
          t('newOverview.compatAutoRunSkipped', { name: item.configFileName, issues }),
          'warning',
          7000
        )
        throw new Error('compat-blocked')
      }
      const confirmed = window.confirm(
        t('newOverview.compatBlockConfirm', { name: item.configFileName, issues })
      )
      if (!confirmed) throw new Error('compat-cancelled')
    }
    // 启动前端口预检：监听端口与运行中配置冲突时直接跳过并提示
    const conflicts = await coreApi.checkPortConflicts(fileName)
    if (conflicts.length > 0) {
      // 定位冲突根源：正在占用端口的配置卡片描红闪烁，toast 展示被占配置名与端口
      const occupied: Record<string, number[]> = {}
      conflicts.forEach((c) => {
        const name = c.conflictConfig.replace('.toml', '')
        occupied[name] = [...new Set([...(occupied[name] || []), c.port])]
      })
      conflictMap.value = { ...conflictMap.value, ...occupied }
      clearConflictTimer()
      conflictTimer = setTimeout(() => {
        conflictMap.value = {}
      }, 4000)
      const configNames = [
        ...new Set(conflicts.map((c) => c.conflictConfig.replace('.toml', '')))
      ].join(', ')
      const ports = [...new Set(conflicts.map((c) => c.port))].join(', ')
      toast(t('newOverview.portConflict', { config: configNames, port: ports }), 'error', 4000)
      throw new Error('port-conflict')
    }
    // Android 单实例模型：已有其他配置运行时，二次确认后停旧起新
    if (isAndroid()) {
      const current = easyTierStore.runningList.find(
        (r) => r.configFileName !== item.configFileName
      )
      if (current) {
        const confirmed = window.confirm(
          t('newOverview.androidSwitchConfirm', {
            current: current.configFileName,
            next: item.configFileName
          })
        )
        if (!confirmed) throw new Error('switch-cancelled')
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
      easyTierStore.setStopLoop(false)
      easyTierStore.setP2pNotify(true)
      easyTierStore.setLastRunConfigName(item)
      await updateRunningList()
      toast(t('newCommon.startSuccess'), 'success')
    } catch (e: any) {
      // 失败自动回滚该配置的 AutoMetric 状态
      await autoMetricAfterStop()
      // 展示内核真实错误，便于定位（invoke 拒绝值可能是字符串或 Error）
      const detail = typeof e === 'string' ? e : e?.message
      const base = isAndroid() ? t('newOverview.startFailAndroid') : t('newOverview.startFailCore')
      toast(detail ? `${base}（${detail}）` : base, 'error', 6000)
      // 抛出时附上 cause，便于上层定位原始错误
      throw new Error('start-failed', { cause: e })
    }
  })
}

// 停止配置：Android 停 VPN+内核，桌面结束子进程；随后恢复网卡跃点
const stopAction = async (item: RunningItem) => {
  const running = easyTierStore.runningList.find((r) => r.configFileName === item.configFileName)
  // Android：停 VPN + 内核实例（无 pid）；桌面：结束子进程
  if (isAndroid() || running?.pid) {
    const ok = await coreApi.stopConfig(running ?? item)
    if (ok) {
      easyTierStore.setStopLoop(true)
      easyTierStore.removeRunningList(item.configFileName)
      toast(t('newCommon.stoppedSuccess'), 'success')
    } else {
      toast(t('newCommon.stoppedFail'), 'error')
    }
  } else {
    easyTierStore.removeRunningList(item.configFileName)
  }
  await autoMetricAfterStop()
}

// ===== 生命周期 =====
onMounted(async () => {
  // 注册当前页刷新回调（悬浮快捷菜单调用）
  easyTierStore.registerPageRefresh(refreshRuntimeState)
  // 如果 store 尚未加载，先加载
  if (!easyTierStore.configListLoaded) {
    await easyTierStore.loadConfigFiles()
  }
  await updateRunningList()
  // 冷启动自动运行
  if (easyTierStore.isFirstLoad) {
    easyTierStore.isFirstLoad = false
    try {
      // 恢复持久化设置
      const savedAutoRun = localStorage.getItem('settings.autoRunNetwork')
      if (savedAutoRun !== null) {
        easyTierStore.setAutoRunNetworkSetting(savedAutoRun === 'true')
      }
      const savedConfigName = localStorage.getItem('settings.autoRunConfigName')
      if (savedConfigName) {
        easyTierStore.setAutoRunConfigName(savedConfigName)
      }

      if (!easyTierStore.autoRunNetworkSetting) return
      // 如果已有运行中的配置，不自动运行
      if (easyTierStore.runningList.length > 0) return

      // 确定要自动运行的配置
      const targetFileName = easyTierStore.autoRunConfigName || easyTierStore.getLastRunConfigName()
      if (!targetFileName) return

      const target = easyTierStore.configList.find((c) => c.configFileName === targetFileName)
      if (target) {
        toast(t('newOverview.autoRunning'), 'success', 3000)
        await startAction(target, { auto: true })
      }
    } catch (e) {
      console.warn('[AutoRun] 自动运行失败:', e)
    }
  }
})

onUnmounted(() => {
  easyTierStore.clearPageRefresh()
  clearConflictTimer()
})
</script>

<style scoped>
.nd {
  font-family: var(--theme-font-body);
}

.nd-queue-bar {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  margin-bottom: var(--theme-space-4);
  background: color-mix(in srgb, var(--theme-accent-primary) 8%, transparent);
  border: 1.5px dashed color-mix(in srgb, var(--theme-accent-primary) 35%, transparent);
  border-radius: var(--theme-radius-lg);
  animation: ndQueueIn 0.3s var(--theme-ease-spring);
  align-items: center;
  gap: var(--theme-space-2);
}

.nd-queue-icon {
  display: inline-block;
  font-size: 14px;
  color: var(--theme-accent-primary);
  animation: ndQueueSpin 1.2s linear infinite;
}

.nd-queue-text {
  font-size: 12px;
  color: var(--theme-text-primary);
}

@keyframes ndQueueIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes ndQueueSpin {
  to {
    transform: rotate(360deg);
  }
}

.nd-section {
  padding: var(--theme-space-5);
  margin-bottom: var(--theme-space-4);
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
}

.nd-stats {
  display: flex;
  gap: var(--theme-space-4);
}

.nd-stat-card {
  display: flex;
  padding: var(--theme-space-4);
  background: var(--theme-bg);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-lg);
  transition: all 0.25s;
  flex: 1;
  align-items: center;
  gap: var(--theme-space-4);
}

.nd-stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--theme-shadow-sm);
}

.nd-stat-icon {
  display: flex;
  width: 38px;
  height: 38px;
  font-size: 15px;
  border-radius: var(--theme-radius-lg);
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nd-stat-icon.running {
  color: var(--theme-color-success);
  background: color-mix(in srgb, var(--theme-color-success) 10%, transparent);
}

.nd-stat-icon.stopped {
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-text-muted) 12%, transparent);
}

.nd-stat-icon.total {
  color: var(--theme-accent-secondary);
  background: color-mix(in srgb, var(--theme-accent-secondary) 10%, transparent);
}

.nd-stat-body {
  display: flex;
  flex-direction: column;
}

.nd-stat-num {
  font-family: var(--theme-font-display);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--theme-text-primary);
}

.nd-stat-lbl {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--theme-space-3);
  min-height: 100px;
}

.nd-config-card {
  padding: var(--theme-space-4);
  background: var(--theme-bg);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-lg);
  transition: all 0.3s var(--theme-ease-spring);
}

.nd-config-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--theme-shadow-md);
}

.ndc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--theme-space-2);
}

.ndc-top-right {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.ndc-conflict-badge {
  padding: 2px var(--theme-space-2);
  font-size: 11px;
  color: var(--theme-color-danger);
  background: color-mix(in srgb, var(--theme-color-danger) 12%, transparent);
  border-radius: var(--theme-radius-pill);
}

.ndc-conflict {
  animation: ndcConflictFlash 0.3s var(--theme-ease-spring) 4;
}

@keyframes ndcConflictFlash {
  0%,
  100% {
    border-color: var(--theme-border-light);
  }

  50% {
    border-color: var(--theme-color-danger);
    box-shadow: 0 0 12px color-mix(in srgb, var(--theme-color-danger) 35%, transparent);
  }
}

.ndc-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.ndc-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--theme-radius-round);
}

.ndc-dot.on {
  background: var(--theme-color-success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--theme-color-success) 40%, transparent);
}

.ndc-dot.off {
  background: var(--theme-text-muted);
}

.ndc-status-text {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.ndc-pid {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.ndc-vip {
  padding: 1px var(--theme-space-2);
  font-family: var(--theme-font-display);
  font-size: 11px;
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 10%, transparent);
  border-radius: var(--theme-radius-pill);
}

.ndc-name {
  margin-bottom: var(--theme-space-2);
  font-family: var(--theme-font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.ndc-summary {
  display: flex;
  min-height: 14px;
  margin-bottom: var(--theme-space-3);
  font-size: 11px;
  color: var(--theme-text-muted);
  align-items: center;
  gap: var(--theme-space-1);
}

.ndc-summary::first-letter {
  color: var(--theme-color-success);
}

.ndc-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.ndc-btn {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
}

.ndc-btn-run {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-color-success) 20%, transparent);
}

.ndc-btn-run:hover:not(:disabled) {
  transform: scale(1.04);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--theme-color-success) 30%, transparent);
}

.ndc-btn-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.ndc-btn-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
  transform: scale(1.04);
}

.ndc-btn:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
}

.nd-empty {
  display: flex;
  padding: var(--theme-space-10) 0;
  font-size: 14px;
  color: var(--theme-text-muted);
  grid-column: 1 / -1;
  align-items: center;
  justify-content: center;
}

/* 移动端适配：统计卡片换行、配置卡片单列排布 */
@media (width <= 900px) {
  .nd-stats {
    flex-wrap: wrap;
  }

  .nd-stat-card {
    flex: 1 1 140px;
  }

  .nd-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}
</style>
