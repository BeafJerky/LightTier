<template>
  <div
    class="nm-root"
    :class="{
      'nm-android': isAndroidPlatform,
      'nm-detail-open': !!selectedConfig,
      'nm-ls-split': isAndroidPlatform && isWideLandscape && !!selectedData
    }"
  >
    <!-- 左侧配置列表（桌面 master-detail；Android 单实例直接展示详情） -->
    <div v-if="!isAndroidPlatform" class="nm-left">
      <div class="nm-left-scroll lt-loading-host">
        <LoadingOverlay :show="easyTierStore.configListLoading" />
        <div
          v-for="item in displayList"
          :key="item.configFileName"
          class="nm-card"
          :class="{ active: selectedConfig?.configFileName === item.configFileName }"
          @click="selectConfig(item)"
        >
          <div class="nmc-top">
            <div class="nmc-status">
              <span class="nmc-dot" :class="item.running ? 'on' : 'off'"></span>
              <span class="nmc-status-text">{{
                item.running ? t('newCommon.running') : t('newCommon.stopped')
              }}</span>
            </div>
            <span v-if="item.pid" class="nmc-pid">PID {{ item.pid }}</span>
          </div>
          <div class="nmc-name">{{ item.configFileName }}</div>
        </div>
        <!-- 空态分流：无配置 / 有配置但无运行实例，避免同一句“暂无配置”误导 -->
        <div
          v-if="easyTierStore.configList.length === 0 && !easyTierStore.configListLoading"
          class="nm-empty-cards"
        >
          <span class="nm-empty-icon">✦</span>
          <p>{{ t('newMonitor.emptyNoConfig') }}</p>
          <LtButton
            variant="primary"
            :size="isAndroidPlatform ? 'lg' : 'md'"
            class="nm-empty-cta"
            @click="goCreateConfig"
            >{{ t('newCommon.createConfig') }}</LtButton
          >
        </div>
        <div v-else-if="displayList.length === 0 && !loading" class="nm-empty-cards">
          <span class="nm-empty-icon">✦</span>
          <p>{{ t('newMonitor.emptyNoRunning') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.emptyNoRunningDesc') }}</span>
          <LtButton
            variant="primary"
            :size="isAndroidPlatform ? 'lg' : 'md'"
            class="nm-empty-cta"
            @click="goConfigPage"
            >{{ t('newCommon.goConfig') }}</LtButton
          >
        </div>
      </div>
    </div>

    <!-- 右侧详情 -->
    <div class="nm-right" v-if="selectedData">
      <div class="nm-main-col">
        <!-- Android：单实例，直接以总览式主卡展示当前运行配置 -->
        <MonitorHero
          v-if="isAndroidPlatform"
          :name="selectedConfig?.configFileName"
          :running="selectedRunning"
          :virtual-ip="selectedVirtualIp"
          :description="heroDescription"
          :peer-count="selectedData.peerList.length"
          :avg-latency="selectedData.avgLatency"
          :last-update-text="formatTime(selectedData.lastUpdate)"
          :refresh-interval="easyTierStore.refreshInterval || 3"
          :stopping="stopping"
          @stop="stopSelected"
          @config="openSelectedConfig"
        />

        <MonitorHeader
          v-else
          :name="selectedConfig?.configFileName"
          :running="selectedRunning"
          :rpc-portal="selectedConfig?.rpcPortal"
          :show-back="true"
          :show-status="true"
          @back="closeMonitorDetail"
        />

        <!-- UX-108：失败时保留最后一次快照，明确提示数据可能过期，可手动重试 -->
        <div
          v-if="consecutiveFailures > 0"
          class="nm-stale-banner"
          :class="{ warn: pollFailed }"
          role="alert"
        >
          <span class="nm-stale-text">
            {{
              pollFailed
                ? t('newMonitor.staleBanner', { count: consecutiveFailures })
                : t('newMonitor.retrying')
            }}
          </span>
          <span class="nm-stale-time">{{
            t('newCommon.lastUpdated', { time: formatTime(selectedData.lastUpdate) })
          }}</span>
          <LtButton
            v-if="pollFailed"
            variant="primary"
            size="xs"
            class="nm-stale-retry"
            @click="retryPolling"
          >
            {{ t('newCommon.retry') }}
          </LtButton>
        </div>

        <div v-if="isAndroidPlatform && selectedRunning" class="nm-traffic">
          <div class="nm-traffic-card">
            <span class="nm-traffic-label">{{ t('newMonitor.totalUpload') }}</span>
            <strong class="nm-traffic-value">{{ formatBytes(selectedData.txTotal) }}</strong>
          </div>
          <div class="nm-traffic-card">
            <span class="nm-traffic-label">{{ t('newMonitor.totalDownload') }}</span>
            <strong class="nm-traffic-value">{{ formatBytes(selectedData.rxTotal) }}</strong>
          </div>
        </div>

        <div
          v-if="!isAndroidPlatform && selectedRunning && selectedData.peerList.length > 0"
          class="nm-peer-summary"
        >
          <div class="nm-peer-stat">
            <span class="nm-ps-num">{{ formatBytes(selectedData.txTotal) }}</span>
            <span class="nm-ps-lbl">{{ t('newMonitor.totalUpload') }}</span>
          </div>
          <div class="nm-peer-stat">
            <span class="nm-ps-num">{{ formatBytes(selectedData.rxTotal) }}</span>
            <span class="nm-ps-lbl">{{ t('newMonitor.totalDownload') }}</span>
          </div>
          <div class="nm-peer-stat">
            <span class="nm-ps-num">{{ selectedData.avgLatency }}</span>
            <span class="nm-ps-lbl">{{ t('newMonitor.avgLatency') }}</span>
          </div>
          <div class="nm-peer-stat">
            <span class="nm-ps-num">{{ selectedData.peerList.length }}</span>
            <span class="nm-ps-lbl">{{ t('newMonitor.peerNodes') }}</span>
          </div>
        </div>

        <NodeTable :node-info="selectedData.nodeInfo" />
      </div>

      <div class="nm-side-col">
        <!-- 5.16：趋势（固定点距的速率/延迟曲线，折叠） -->
        <details class="nm-trend-collapse" open>
          <summary class="nm-trend-summary">
            <span class="nm-trend-label">{{ t('newMonitor.trend') }}</span>
          </summary>
          <div class="nm-trend-body">
            <TrendChart :points="trendPoints" />
          </div>
        </details>

        <PeerTable v-if="selectedData.peerList.length > 0" :peers="selectedData.peerList" />

        <div v-if="selectedData.lastUpdate" class="nm-update-time">
          {{ t('newMonitor.lastUpdate') }}: {{ formatTime(selectedData.lastUpdate) }}
        </div>
      </div>
    </div>

    <!-- 已选中但尚未拿到快照：明确区分加载中 / 未运行 / 从未成功，避免空白误导 -->
    <div class="nm-right" v-else-if="selectedConfig">
      <MonitorHeader
        :name="selectedConfig.configFileName"
        :running="selectedRunning"
        :show-back="!isAndroidPlatform"
        :show-status="false"
        @back="closeMonitorDetail"
      />
      <div class="nm-state">
        <template v-if="!selectedRunning">
          <span class="nm-state-icon">○</span>
          <p class="nm-state-title">{{ t('newMonitor.emptyNoRunning') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.emptyNoRunningDesc') }}</span>
          <LtButton
            variant="primary"
            :size="isAndroidPlatform ? 'lg' : 'md'"
            class="nm-empty-cta"
            @click="goConfigPage"
            >{{ t('newCommon.goConfig') }}</LtButton
          >
        </template>
        <template v-else-if="pollFailed">
          <span class="nm-state-icon">!</span>
          <p class="nm-state-title">{{ t('newMonitor.fetchFailed') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.fetchFailedDesc') }}</span>
          <LtButton
            variant="primary"
            :size="isAndroidPlatform ? 'lg' : 'md'"
            class="nm-empty-cta"
            @click="retryPolling"
            >{{ t('newCommon.retry') }}</LtButton
          >
        </template>
        <template v-else>
          <span class="nm-state-spinner" aria-hidden="true"></span>
          <p class="nm-state-title">{{ t('newMonitor.loadingData') }}</p>
        </template>
      </div>
    </div>

    <div class="nm-right" v-else>
      <!-- Android：单实例，无运行配置时给出空态与去配置入口 -->
      <template v-if="isAndroidPlatform">
        <div v-if="loading || easyTierStore.configListLoading" class="nm-state" aria-live="polite">
          <span class="nm-state-spinner" aria-hidden="true"></span>
          <p class="nm-state-title">{{ t('newMonitor.loadingData') }}</p>
        </div>
        <div v-else class="nm-empty-cards">
          <span class="nm-empty-icon">✦</span>
          <p>{{
            easyTierStore.configList.length === 0
              ? t('newMonitor.emptyNoConfig')
              : t('newMonitor.emptyNoRunning')
          }}</p>
          <span class="nm-empty-desc">{{
            easyTierStore.configList.length === 0
              ? t('newOverview.emptyNoConfigDesc')
              : t('newMonitor.emptyNoRunningDesc')
          }}</span>
          <LtButton variant="primary" size="lg" class="nm-empty-cta" @click="goMonitoringCta">
            {{
              easyTierStore.configList.length === 0
                ? t('newCommon.createConfig')
                : t('newCommon.goConfig')
            }}
          </LtButton>
        </div>
      </template>
      <div v-else class="nm-empty">
        <span class="nm-empty-icon">✦</span>
        <p>{{ t('newMonitor.selectConfig') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * monitor — 运行监控页（左侧运行中实例列表 + 右侧实时详情，master-detail 布局）
 *
 * 数据链路：定时轮询 coreApi（桌面 easytier-cli / Android 进程内 RPC 均由 coreApi 分发）
 * → processPeerData 归一化 peer 列表 → 生成快照写入 selectedData，同时：
 * - 同步总览摘要（monitorSummary）与趋势缓冲（useTrendBuffer，5.16）
 * - 全部远端 Peer 均 P2P 直连时一次性通知（5.4，p2pNotify 去重）
 * 可靠性：页面隐藏时暂停轮询、连续失败 3 次自动停止；诊断日志缓冲后批量落盘。
 * 平台差异：浏览器用 mockPeers / mockNodeInfo 演示。
 * 查询/轮询见 useMonitorQuery，趋势采样见 useTrendSeries。
 */
import { useEasyTierStore } from '@/shared/store/easytier'
import { formatBytes, routeCost } from '@/shared/lib/monitorFormat'
import { useIslandStore } from '@/shared/store/island'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as coreApi from '@/shared/platform/coreApi'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getErrorMessage } from '@/shared/lib/error'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useWideLandscape } from '@/shared/composables/useWideLandscape'
import TrendChart from '@/features/instances/components/TrendChart.vue'
import { LtButton } from '@/shared/ui'
import LoadingOverlay from '@/shared/ui/LoadingOverlay.vue'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import {
  useMonitorQuery,
  type MonitorSnapshot
} from '@/features/instances/composables/useMonitorQuery'
import { useTrendSeries } from '@/features/instances/composables/useTrendSeries'
import MonitorHero from './MonitorHero.vue'
import MonitorHeader from './MonitorHeader.vue'
import NodeTable from './NodeTable.vue'
import PeerTable from './PeerTable.vue'

defineOptions({ name: 'NewMonitor' })

const easyTierStore = useEasyTierStore()
const islandStore = useIslandStore()
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const isAndroidPlatform = isAndroid()
// 横屏宽屏：运行态仪表盘左右分栏（左：主卡/流量/节点信息，右：趋势/对等节点）
const isWideLandscape = useWideLandscape()
const { show: toast } = useCreamToast()

// 页面加载态 / 当前选中实例（列表卡片数据）
const loading = ref(false)
const selectedConfig = ref<RunningItem | null>(null)
// 断开连接请求在飞时禁用按钮，避免连点重复停机
const stopping = ref(false)

const { updateRunningList } = useRunningListSync({
  // 监控页需要诊断日志：扫描失败直接打印（浏览器 Mock 同样可见）
  onError: (e) => console.error('刷新运行状态失败:', e)
})

// 当前选中实例是否运行中（控制 badge 展示与轮询启停）
const selectedRunning = computed(() => {
  return selectedConfig.value
    ? easyTierStore.runningList.some(
        (r) => r.configFileName === selectedConfig.value?.configFileName
      )
    : false
})

// 运行中配置名集合（O(1) 判断，多处复用）
const runningSet = computed(() => new Set(easyTierStore.runningList.map((r) => r.configFileName)))

// Android 总览式主卡：虚拟 IP 来自运行实例（桌面为 undefined）
const selectedVirtualIp = computed(() =>
  selectedConfig.value
    ? easyTierStore.runningList.find(
        (r) => r.configFileName === selectedConfig.value?.configFileName
      )?.virtualIp
    : undefined
)

// 左侧列表仅展示运行中的实例（与监控目标一致），并带出 pid / rpcPortal
const displayList = computed(() => {
  const pidMap = new Map(easyTierStore.runningList.map((r) => [r.configFileName, r.pid]))
  const rpcPortalMap = new Map(
    easyTierStore.runningList.map((r) => [r.configFileName, r.rpcPortal])
  )
  return easyTierStore.configList
    .filter((c) => runningSet.value.has(c.configFileName))
    .map((c) => ({
      ...c,
      running: true,
      pid: pidMap.get(c.configFileName),
      rpcPortal: rpcPortalMap.get(c.configFileName)
    }))
})

// 时间戳 → 本地时间字符串（24 小时制）
const formatTime = (ts: number): string => {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

const { trendPoints, syncTrend, recordTrend, resetBaseline, clearConfigTrend } = useTrendSeries({
  selectedConfig
})

// --- 快照落地：写总览摘要（5.2）+ P2P 全直连通知（5.4） ---
const handleSnapshotSuccess = (configName: string, snapshot: MonitorSnapshot) => {
  // 5.2：总览摘要快照（单写多读，总览页不复制轮询）
  easyTierStore.setMonitorSummary(configName, {
    nodeCount: snapshot.peerList.length,
    avgLatency: snapshot.avgLatency
  })
  // 灵动岛连接质量采样：只看远端 peer，空值不当作 0
  const qualityPeers = snapshot.peerList.filter((peer) => peer.cost !== routeCost('Local'))
  const latencies = qualityPeers
    .filter((peer) => peer.lat_ms.trim() !== '')
    .map((peer) => Number(peer.lat_ms))
    .filter((value) => Number.isFinite(value))
  const losses = qualityPeers
    .filter((peer) => peer.loss_rate.trim() !== '')
    .map((peer) => Number(peer.loss_rate))
    .filter((value) => Number.isFinite(value))
  if (latencies.length) {
    islandStore.reportQuality(configName, {
      avgLatencyMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      lossRate: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0,
      peerCount: qualityPeers.length
    })
  }
  // 5.4：全部远端 Peer 均 P2P 直连时一次性通知（排除本机项，去重复用 p2pNotify 标志位）
  if (!easyTierStore.p2pNotifySetting || !easyTierStore.p2pNotify) return
  const remotePeers = snapshot.peerList.filter((p) => p.cost !== routeCost('Local'))
  if (remotePeers.length > 0 && remotePeers.every((p) => p.cost === routeCost('p2p'))) {
    easyTierStore.p2pNotify = false
    toast(t('newMonitor.p2pAllConnected'), 'success', 4000)
  }
}

const {
  selectedData,
  consecutiveFailures,
  pollFailed,
  startPolling,
  stopPolling,
  retryPolling,
  resetFailures
} = useMonitorQuery({
  selectedConfig,
  runningSet,
  refreshInterval: () => easyTierStore.refreshInterval || 3,
  onSnapshot: (configName, snapshot) => {
    handleSnapshotSuccess(configName, snapshot)
    recordTrend(configName, snapshot)
  }
})

const heroDescription = computed(() => {
  if (selectedData.value) return t('newMonitor.androidLiveDesc')
  if (pollFailed.value) return t('newMonitor.fetchFailedDesc')
  return t('newMonitor.loadingData')
})

// --- 页面可见性（后台标签页暂停轮询，恢复时立即补一次数据） ---
const visibilityHandler = () => {
  if (document.hidden) {
    stopPolling()
    return
  }
  const cfg = selectedConfig.value
  if (!cfg || !runningSet.value.has(cfg.configFileName)) return
  // 隐藏期间累计流量差分跨度可能长达数分钟：重置基线，避免恢复后出现失真低点
  resetBaseline(cfg.configFileName)
  // 只走 startPolling（内部立即拉取一次），不再手动 fetch，避免同一轮请求两次
  startPolling()
}

// 清除已消费的 ?name=，避免后续刷新或再次进入时被旧目标覆盖
const clearRequestedName = () => {
  if (typeof route.query.name !== 'string') return
  const query = { ...route.query }
  delete query.name
  void router.replace({ query })
}

// --- 数据获取 ---
// 初始化：加载配置列表与运行状态；桌面端自动选中上次运行配置（窄屏保持清单视图）
const loadConfigs = async () => {
  loading.value = true
  try {
    // 如果 store 尚未加载，先加载
    if (!easyTierStore.configListLoaded) {
      await easyTierStore.loadConfigFiles()
    }
    await updateRunningList()

    // 从运行中的配置（displayList）中选择，避免选中已停止的配置导致左侧无高亮卡片。
    // 总览卡片跳转携带 ?name= 时优先命中目标；窄屏仅在显式指定目标时自动进入详情，
    // 其余情况保持清单视图。
    if (!isAndroidPlatform && displayList.value.length > 0) {
      const requestedName = typeof route.query.name === 'string' ? route.query.name : ''
      const requested = requestedName
        ? displayList.value.find((c) => c.configFileName === requestedName)
        : undefined
      const last = easyTierStore.getLastRunConfigName()
      const fallback =
        (last ? displayList.value.find((c) => c.configFileName === last) : undefined) ||
        displayList.value[0]
      const target = requested || (window.innerWidth > 900 ? fallback : undefined)
      if (target) selectConfig(target)
      if (requestedName) clearRequestedName()
    }
  } catch (e) {
    console.error('加载监控配置失败:', e)
  } finally {
    loading.value = false
  }
}

// 运行时状态刷新（FAB 已负责文件加载）
const refreshRuntimeState = async () => {
  await updateRunningList()
}

// --- 选中配置 ---
// selectedWasRunning 与 selectConfig 中的手动启停同步，避免选中配置时重复启动；
// 关闭详情（selectedConfig 置空）不清趋势，重新打开时仍可看到本段运行历史。
let selectedWasRunning = false

// 切换选中实例：重置详情/失败计数与趋势，运行中则开始轮询，否则停轮询
const selectConfig = (item: RunningItem) => {
  selectedConfig.value = item
  syncTrend()
  selectedData.value = null
  resetFailures()
  // 切换/重新选中：丢弃旧的累计流量基线，首个新采样仅作为基线不画速率点
  resetBaseline(item.configFileName)
  easyTierStore.setLastSelectedConfig(item)

  if (runningSet.value.has(item.configFileName)) {
    selectedWasRunning = true
    startPolling()
  } else {
    selectedWasRunning = false
    stopPolling()
  }
}

// 移动端 master-detail：从详情返回清单
const closeMonitorDetail = () => {
  stopPolling()
  selectedConfig.value = null
  selectedData.value = null
  resetFailures()
}

// Android 单实例：监控页始终跟随当前运行中的配置（无运行项则展示空态）
const syncAndroidSelection = async () => {
  if (!isAndroidPlatform) return
  if (!easyTierStore.configListLoaded) await easyTierStore.loadConfigFiles()
  // 从其他页面切换过来时运行态可能尚未刷新，补一次扫描再判定
  if (displayList.value.length === 0) await updateRunningList()
  const running = displayList.value[0]
  if (!running) {
    if (selectedConfig.value) closeMonitorDetail()
    return
  }
  // 同一实例只同步 pid / 虚拟 IP 等运行态字段，不重置快照与轮询
  if (selectedConfig.value?.configFileName === running.configFileName) {
    selectedConfig.value = running
    return
  }
  selectConfig(running)
}

// 已在监控页时再次下发 ?name=：桌面端跟随目标切换实例（Android 单实例由运行态自动跟随）
watch(
  () => route.query.name,
  (name) => {
    if (isAndroidPlatform || typeof name !== 'string' || !name) return
    const target = displayList.value.find((c) => c.configFileName === name)
    if (target) selectConfig(target)
    clearRequestedName()
  }
)

// 运行实例集合变化（启动 / 停止 / 切换）时重新对齐选中项
watch(
  () => easyTierStore.runningList.map((r) => r.configFileName).join('|'),
  () => {
    if (isAndroidPlatform) void syncAndroidSelection()
  }
)
watch(
  () => easyTierStore.configListLoaded,
  (loaded) => {
    if (loaded && isAndroidPlatform) void syncAndroidSelection()
  }
)

// 空态 CTA：无配置时去新建，有配置无运行实例时去配置页
const goCreateConfig = () => {
  router.push(isAndroidPlatform ? '/new/config-add' : '/new/config?create=1')
}
const goConfigPage = () => {
  router.push('/new/config')
}
const goMonitoringCta = () => {
  if (easyTierStore.configList.length === 0) goCreateConfig()
  else goConfigPage()
}

// Android 主卡：断开当前运行实例
const stopSelected = async () => {
  const running = selectedConfig.value
    ? easyTierStore.runningList.find(
        (r) => r.configFileName === selectedConfig.value?.configFileName
      )
    : undefined
  if (!running || stopping.value) return
  stopping.value = true
  try {
    const ok = await coreApi.stopConfig(running)
    if (ok) {
      easyTierStore.stopLoop = true
      easyTierStore.removeRunningList(running.configFileName)
      clearConfigTrend(running.configFileName)
      toast(t('newCommon.stoppedSuccess'), 'success')
    } else {
      toast(t('newCommon.stoppedFail'), 'error')
    }
  } catch (e) {
    toast(`${t('newCommon.stoppedFail')}（${getErrorMessage(e)}）`, 'error')
  } finally {
    stopping.value = false
  }
}

// 主卡：跳转到当前配置详情
const openSelectedConfig = () => {
  const name = selectedConfig.value?.configFileName
  if (!name) return
  router.push({
    name: isAndroidPlatform ? 'NewConfigDetailView' : 'NewConfigView',
    query: { name }
  })
}

// 运行状态变化（外部启停/服务变化）：重新运行 → 重置差分基线并恢复轮询；
// 停止 → 停轮询并清空该配置趋势，避免停机前后的曲线被直接连起来。
watch(selectedRunning, (running) => {
  const cfg = selectedConfig.value
  if (!cfg) {
    selectedWasRunning = false
    return
  }
  if (running === selectedWasRunning) return
  selectedWasRunning = running
  if (running) {
    resetBaseline(cfg.configFileName)
    startPolling()
  } else {
    stopPolling()
    resetBaseline(cfg.configFileName)
    clearConfigTrend(cfg.configFileName)
    syncTrend()
    resetFailures()
  }
})

// --- 生命周期 ---
onMounted(async () => {
  easyTierStore.registerPageRefresh(refreshRuntimeState)
  await loadConfigs()
  if (isAndroidPlatform) await syncAndroidSelection()
  document.addEventListener('visibilitychange', visibilityHandler)
})

onUnmounted(() => {
  stopPolling()
  easyTierStore.clearPageRefresh()
  document.removeEventListener('visibilitychange', visibilityHandler)
})
</script>

<style scoped lang="less">
@import url('./styles/page.less');
</style>
