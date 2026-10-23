<template>
  <div
    class="nm-root"
    :class="{
      'nm-android': isAndroidPlatform,
      'nm-detail-open': isAndroidPlatform ? isAndroidDetailRoute : !!selectedConfig
    }"
  >
    <!-- 左侧配置列表 -->
    <div class="nm-left">
      <div class="nm-left-header">
        <div class="nm-left-label">{{ t('newMonitor.monitorLabel') }}</div>
      </div>
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
          <!-- Android 列表卡片即详情入口，补右侧箭头提示可点击 -->
          <svg
            v-if="isAndroidPlatform"
            class="nmc-chev"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
        <!-- 空态分流：无配置 / 有配置但无运行实例，避免同一句“暂无配置”误导 -->
        <div
          v-if="easyTierStore.configList.length === 0 && !easyTierStore.configListLoading"
          class="nm-empty-cards"
        >
          <span class="nm-empty-icon">✦</span>
          <p>{{ t('newMonitor.emptyNoConfig') }}</p>
          <button class="nm-empty-cta" @click="goCreateConfig">{{
            t('newCommon.createConfig')
          }}</button>
        </div>
        <div v-else-if="displayList.length === 0 && !loading" class="nm-empty-cards">
          <span class="nm-empty-icon">✦</span>
          <p>{{ t('newMonitor.emptyNoRunning') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.emptyNoRunningDesc') }}</span>
          <button class="nm-empty-cta" @click="goConfigPage">{{ t('newCommon.goConfig') }}</button>
        </div>
      </div>
    </div>

    <!-- 右侧详情 -->
    <div class="nm-right" v-if="selectedData">
      <div class="nm-detail-header">
        <div class="nm-detail-title-row">
          <button v-if="!isAndroidPlatform" class="nm-back-btn" @click="closeMonitorDetail">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {{ t('newCommon.back') }}
          </button>
          <h3 class="nm-detail-title">{{ selectedConfig?.configFileName }}</h3>
          <span class="nm-badge" :class="selectedRunning ? 'on' : 'off'">
            {{ selectedRunning ? '● ' + t('newCommon.running') : '○ ' + t('newCommon.stopped') }}
          </span>
          <span v-if="selectedConfig?.rpcPortal" class="nm-detail-rpc">
            RPC {{ selectedConfig.rpcPortal.replace('127.0.0.1', 'localhost') }}
          </span>
        </div>
      </div>

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
        <button v-if="pollFailed" class="nm-stale-retry" @click="retryPolling">
          {{ t('newCommon.retry') }}
        </button>
      </div>

      <div v-if="selectedRunning && selectedData.peerList.length > 0" class="nm-peer-summary">
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

      <div class="nm-section">
        <div class="nm-section-title">{{ t('newMonitor.nodeInfo') }}</div>
        <div class="nm-grid">
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.hostname') }}</span
            ><span class="nm-val">{{ selectedData.nodeInfo?.hostname || '—' }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.instanceName') }}</span
            ><span class="nm-val">{{
              selectedData.nodeInfo?._instance_name || selectedData.nodeInfo?.inst_id || '—'
            }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">IPv4</span
            ><span class="nm-val">{{ selectedData.nodeInfo?.ipv4_addr || '—' }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newCommon.version') }}</span
            ><span class="nm-val">{{ selectedData.nodeInfo?.version || '—' }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.networkName') }}</span
            ><span class="nm-val">{{ selectedData.nodeInfo?._network_name || '—' }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.natType') }}</span
            ><span class="nm-val">{{
              selectedData.nodeInfo?.stun_info?._udp_nat_type ||
              selectedData.nodeInfo?.stun_info?.udp_nat_type ||
              '—'
            }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">DHCP</span
            ><span class="nm-val">{{
              selectedData.nodeInfo?._dhcp ? t('newMonitor.dhcpOn') : t('newMonitor.dhcpOff')
            }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.exitNodes') }}</span
            ><span class="nm-val">{{
              (selectedData.nodeInfo?._exit_nodes?.length || 0) > 0
                ? selectedData.nodeInfo._exit_nodes.join(', ')
                : t('newMonitor.none')
            }}</span></div
          >
          <div class="nm-field"
            ><span class="nm-label">{{ t('newMonitor.portForward') }}</span
            ><span class="nm-val">{{
              (selectedData.nodeInfo?._port_forward?.length || 0) > 0
                ? selectedData.nodeInfo._port_forward.join(', ')
                : t('newMonitor.none')
            }}</span></div
          >
        </div>
      </div>

      <!-- 5.16：趋势（固定点距的速率/延迟曲线，折叠） -->
      <details class="nm-trend-collapse" open>
        <summary class="nm-trend-summary">
          <span class="nm-trend-label">{{ t('newMonitor.trend') }}</span>
        </summary>
        <div class="nm-trend-body">
          <TrendChart :points="trendPoints" />
        </div>
      </details>

      <div class="nm-section" v-if="selectedData.peerList.length > 0">
        <div class="nm-section-title"
          >{{ t('newMonitor.peerSection') }}
          <span class="nm-section-count">({{ selectedData.peerList.length }})</span></div
        >
        <div class="nm-peer-grid">
          <div
            v-for="(peer, idx) in selectedData.peerList"
            :key="peer.id || idx"
            class="nm-peer-card"
          >
            <div class="nmp-top">
              <span class="nmp-hostname">{{ peer.hostname || '—' }}</span>
              <span class="nmp-lat" :style="{ color: peer.delayColor }">{{
                formatMetric(peer.lat_ms, 'ms')
              }}</span>
            </div>
            <div class="nmp-detail">
              <div class="nmp-row"
                ><span class="nmp-key">IPv4</span
                ><span class="nmp-val">{{ peer.ipv4 || '—' }}</span></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">{{ t('newMonitor.connection') }}</span
                ><span class="nmp-val">{{ peer.cost || '—' }}</span></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">NAT</span
                ><span class="nmp-val">{{ peer.nat_type || '—' }}</span></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">{{ t('newMonitor.protocol') }}</span
                ><span class="nmp-val">{{ peer.tunnel_proto || '—' }}</span></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">{{ t('newMonitor.packetLoss') }}</span
                ><span
                  class="nmp-val"
                  :class="peer.loss_rate && parseFloat(peer.loss_rate) > 5 ? 'warn' : ''"
                  >{{ formatMetric(peer.loss_rate, '%') }}</span
                ></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">{{ t('newMonitor.upload') }}</span
                ><span class="nmp-val">{{ formatBytes(peer.tx_bytes) }}</span></div
              >
              <div class="nmp-row"
                ><span class="nmp-key">{{ t('newMonitor.download') }}</span
                ><span class="nmp-val">{{ formatBytes(peer.rx_bytes) }}</span></div
              >
            </div>
          </div>
        </div>
      </div>

      <div v-if="selectedData.lastUpdate" class="nm-update-time">
        {{ t('newMonitor.lastUpdate') }}: {{ formatTime(selectedData.lastUpdate) }}
      </div>
    </div>

    <!-- 已选中但尚未拿到快照：明确区分加载中 / 未运行 / 从未成功，避免空白误导 -->
    <div class="nm-right" v-else-if="selectedConfig">
      <div class="nm-detail-header">
        <div class="nm-detail-title-row">
          <button v-if="!isAndroidPlatform" class="nm-back-btn" @click="closeMonitorDetail">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {{ t('newCommon.back') }}
          </button>
          <h3 class="nm-detail-title">{{ selectedConfig.configFileName }}</h3>
        </div>
      </div>
      <div class="nm-state">
        <template v-if="!selectedRunning">
          <span class="nm-state-icon">○</span>
          <p class="nm-state-title">{{ t('newMonitor.emptyNoRunning') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.emptyNoRunningDesc') }}</span>
          <button class="nm-empty-cta" @click="goConfigPage">{{ t('newCommon.goConfig') }}</button>
        </template>
        <template v-else-if="pollFailed">
          <span class="nm-state-icon">!</span>
          <p class="nm-state-title">{{ t('newMonitor.fetchFailed') }}</p>
          <span class="nm-empty-desc">{{ t('newMonitor.fetchFailedDesc') }}</span>
          <button class="nm-empty-cta" @click="retryPolling">{{ t('newCommon.retry') }}</button>
        </template>
        <template v-else>
          <span class="nm-state-spinner" aria-hidden="true"></span>
          <p class="nm-state-title">{{ t('newMonitor.loadingData') }}</p>
        </template>
      </div>
    </div>

    <div class="nm-right" v-else>
      <!-- Android 详情路由：列表/运行态尚未就绪时先展示加载态 -->
      <div v-if="isAndroidDetailRoute" class="nm-empty" aria-live="polite">
        <p>{{ t('newCommon.loading') }}</p>
      </div>
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
 */
import { useEasyTierStore } from '@/store/modules/easytier'
import {
  processPeerData,
  routeCost,
  formatBytes,
  getNatType,
  formatMetric
} from '@/utils/easyTierUtil'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as coreApi from '@/utils/coreApi'
import { isAndroid } from '@/utils/platformUtil'
import { readFileContent } from '@/utils/fileUtil'
import { CONFIG_PATH } from '@/constants/easytier'
import * as toml from 'smol-toml'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useCreamToast } from '@/hooks/useCreamToast'
import TrendChart from '@/components/TrendChart/index.vue'
import LoadingOverlay from '@/components/LoadingOverlay/index.vue'
import { useTrendBuffer, type TrendPoint } from '@/hooks/useTrendBuffer'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'

defineOptions({ name: 'NewMonitor' })

const easyTierStore = useEasyTierStore()
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const isAndroidPlatform = isAndroid()
const { show: toast } = useCreamToast()

let isMounted = false

// --- 页面可见性（后台标签页暂停轮询，恢复时立即补一次数据） ---
const visibilityHandler = () => {
  if (document.hidden) {
    stopPolling()
    return
  }
  const cfg = selectedConfig.value
  if (!cfg || !runningSet.value.has(cfg.configFileName)) return
  // 隐藏期间累计流量差分跨度可能长达数分钟：重置基线，避免恢复后出现失真低点
  delete lastRateSample.value[cfg.configFileName]
  // 只走 startPolling（内部立即拉取一次），不再手动 fetch，避免同一轮请求两次
  startPolling()
}

// 页面加载态 / 当前选中实例（列表卡片数据）
const loading = ref(false)
const selectedConfig = ref<RunningItem | null>(null)

// Android 详情为独立路由（列表/详情共用本组件），视图切换以路由为准
const isAndroidDetailRoute = computed(
  () => isAndroidPlatform && route.name === 'NewMonitorDetailView'
)

// 监控快照：一次轮询的完整结果（nodeInfo 已合并 TOML 展示字段与 NAT 映射结果）
interface MonitorSnapshot {
  nodeInfo: any
  peerList: PeerInfo[]
  lastUpdate: number
  txTotal: number
  rxTotal: number
  avgLatency: string
}
const selectedData = ref<MonitorSnapshot | null>(null)

// --- 5.16 趋势缓冲（每配置环形，随 refreshInterval 取样） ---
const { getTrend, pushTrend, clearTrend } = useTrendBuffer()
// 缓冲为模块级非响应式结构：computed 只依赖 selectedConfig 无法感知原地 push，
// 故用 ref + push 后手动替换引用（syncTrend）保证图表实时刷新
const trendPoints = ref<TrendPoint[]>([])
const syncTrend = (configName?: string) => {
  if (configName && configName !== selectedConfig.value?.configFileName) return
  trendPoints.value = selectedConfig.value ? getTrend(selectedConfig.value.configFileName) : []
}
// 上次累计流量样本（用于速率差分）
const lastRateSample = ref<Record<string, { tx: number; rx: number; ts: number }>>({})
const recordTrend = (configName: string, snapshot: MonitorSnapshot) => {
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

let pollTimer: ReturnType<typeof setInterval> | null = null

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

// --- 判断 Tauri 环境（withGlobalTauri 已关闭，用 isTauri() 检测） ---
const isTauriEnv = (): boolean => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
}

// --- Mock 同伴数据 ---
const mockPeers: Record<string, PeerInfo[]> = {
  东京中继节点: [
    {
      cost: 'p2p',
      hostname: 'sgp-relay',
      id: 'node-001',
      ipv4: '10.144.0.2/24',
      lat_ms: '12',
      loss_rate: '0',
      nat_type: 'FullCone',
      rx_bytes: '104857600',
      tunnel_proto: 'tcp',
      tx_bytes: '52428800',
      version: '2.6.0',
      delayColor: 'green'
    },
    {
      cost: 'p2p',
      hostname: 'home-router',
      id: 'node-002',
      ipv4: '10.144.0.10/24',
      lat_ms: '45',
      loss_rate: '0.5',
      nat_type: 'Restricted',
      rx_bytes: '20971520',
      tunnel_proto: 'udp',
      tx_bytes: '10485760',
      version: '2.6.0',
      delayColor: '#45b458'
    },
    {
      cost: 'relay',
      hostname: 'PublicServer_东京公网',
      id: 'node-003',
      ipv4: '172.16.0.1/24',
      lat_ms: '3',
      loss_rate: '0',
      nat_type: 'OpenInternet',
      rx_bytes: '524288000',
      tunnel_proto: 'tcp',
      tx_bytes: '262144000',
      version: '2.6.0',
      delayColor: 'green'
    }
  ],
  新加坡出口: [
    {
      cost: 'p2p',
      hostname: 'tokyo-relay',
      id: 'node-101',
      ipv4: '10.144.0.1/24',
      lat_ms: '78',
      loss_rate: '1.2',
      nat_type: 'FullCone',
      rx_bytes: '31457280',
      tunnel_proto: 'tcp',
      tx_bytes: '15728640',
      version: '2.6.0',
      delayColor: '#45b458'
    },
    {
      cost: 'p2p',
      hostname: 'mobile-dev',
      id: 'node-102',
      ipv4: '10.144.0.100/24',
      lat_ms: '156',
      loss_rate: '3.0',
      nat_type: 'Symmetric',
      rx_bytes: '5242880',
      tunnel_proto: 'udp',
      tx_bytes: '2621440',
      version: '2.6.0',
      delayColor: '#fdc44d'
    }
  ],
  家庭局域网: [
    {
      cost: 'p2p',
      hostname: 'tokyo-relay',
      id: 'node-201',
      ipv4: '10.144.0.1/24',
      lat_ms: '35',
      loss_rate: '0.1',
      nat_type: 'Restricted',
      rx_bytes: '83886080',
      tunnel_proto: 'tcp',
      tx_bytes: '41943040',
      version: '2.6.0',
      delayColor: '#45b458'
    },
    {
      cost: 'Local',
      hostname: 'localhost',
      id: 'node-202',
      ipv4: '127.0.0.1',
      lat_ms: '0',
      loss_rate: '0',
      nat_type: 'Unknown',
      rx_bytes: '0',
      tunnel_proto: 'tcp',
      tx_bytes: '0',
      version: '2.6.0',
      delayColor: 'green'
    }
  ],
  办公室组网: [
    {
      cost: 'p2p',
      hostname: 'home-router',
      id: 'node-301',
      ipv4: '10.144.0.10/24',
      lat_ms: '22',
      loss_rate: '0',
      nat_type: 'FullCone',
      rx_bytes: '167772160',
      tunnel_proto: 'tcp',
      tx_bytes: '83886080',
      version: '2.6.0',
      delayColor: 'green'
    },
    {
      cost: 'relay',
      hostname: 'PublicServer_办公室中继',
      id: 'node-302',
      ipv4: '192.168.1.1/24',
      lat_ms: '8',
      loss_rate: '0',
      nat_type: 'OpenInternet',
      rx_bytes: '1073741824',
      tunnel_proto: 'tcp',
      tx_bytes: '536870912',
      version: '2.6.0',
      delayColor: 'green'
    }
  ],
  移动设备: [
    {
      cost: 'relay',
      hostname: 'office-gw',
      id: 'node-401',
      ipv4: '10.10.0.1/16',
      lat_ms: '89',
      loss_rate: '2.5',
      nat_type: 'PortRestricted',
      rx_bytes: '1048576',
      tunnel_proto: 'udp',
      tx_bytes: '524288',
      version: '2.6.0',
      delayColor: '#45b458'
    }
  ]
}

const mockNodeInfo: Record<string, any> = {
  东京中继节点: {
    hostname: 'tokyo-node-01',
    instance_name: '东京中继',
    ipv4_addr: '10.144.0.1',
    version: '2.6.0',
    network_name: 'global-mesh',
    stun_info: { udp_nat_type: 'FullCone' }
  },
  新加坡出口: {
    hostname: 'sgp-gateway',
    instance_name: '新加坡出口',
    ipv4_addr: '10.144.0.2',
    version: '2.6.0',
    network_name: 'asia-backbone',
    stun_info: { udp_nat_type: 'OpenInternet' }
  },
  家庭局域网: {
    hostname: 'home-server',
    instance_name: '家庭网络',
    ipv4_addr: '10.144.0.10',
    version: '2.6.0',
    network_name: 'home-mesh',
    stun_info: { udp_nat_type: 'Restricted' }
  },
  办公室组网: {
    hostname: 'office-gateway',
    instance_name: '办公室网关',
    ipv4_addr: '10.144.0.20',
    version: '2.6.0',
    network_name: 'office-mesh',
    stun_info: { udp_nat_type: 'FullCone' }
  },
  移动设备: {
    hostname: 'iphone-14',
    instance_name: '移动设备',
    ipv4_addr: '10.144.0.100',
    version: '2.6.0',
    network_name: 'mobile-mesh',
    stun_info: { udp_nat_type: 'PortRestricted' }
  }
}

// --- 工具函数 ---
// 解析 CLI 返回的人类可读字节字符串，如 "1.26 kB" → 字节数
const parseHumanBytes = (val: string | number | null | undefined): number => {
  if (val === null || val === undefined || val === '-' || val === '') return 0
  if (typeof val === 'number') return val
  const str = val.trim()
  const match = str.match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB)?$/i)
  if (!match) return Number(str) || 0
  const num = parseFloat(match[1])
  const unit = (match[2] || 'B').toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024
  }
  return num * (multipliers[unit] || 1)
}

// 计算远端平均延迟（过滤 '-' 占位值；无有效样本时返回 '—'）
const calcAvgLatency = (peers: PeerInfo[]): string => {
  const valid = peers.filter((p) => p.lat_ms && p.lat_ms !== '-').map((p) => Number(p.lat_ms))
  if (valid.length === 0) return '—'
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length
  return avg.toFixed(1) + 'ms'
}

// 时间戳 → 本地时间字符串（24 小时制）
const formatTime = (ts: number): string => {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
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

    // 从运行中的配置（displayList）中选择，避免选中已停止的配置导致左侧无高亮卡片
    // 窄屏（移动端）默认展示清单，不自动进入详情；Android 详情由路由驱动
    if (!isAndroidPlatform && window.innerWidth > 900 && displayList.value.length > 0) {
      const last = easyTierStore.getLastRunConfigName()
      const target = last
        ? displayList.value.find((c) => c.configFileName === last) || displayList.value[0]
        : displayList.value[0]
      selectConfig(target)
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

const updateRunningList = async () => {
  try {
    // 桌面：进程扫描；Android：进程内实例管理器（由 coreApi 分发）
    const names = easyTierStore.configList.map((c) => c.configFileName)
    const newList = await coreApi.getRunningList(names)
    easyTierStore.setRunningList(newList)
  } catch (e) {
    console.error('刷新运行状态失败:', e)
  }
}

// 拉取一次监控快照：浏览器走 Mock；Tauri 环境并行查询 node/peer，
// 并把 TOML 展示字段（instance_name/network_name/dhcp/exit_nodes/port_forward）注入 nodeInfo
/**
 * CLI 的 RPC 查询存在偶发超时（内核繁忙时实测约 1/3 失败）。
 * 单次失败不应立即清空界面：先短延迟重试一次，仍失败返回 null，
 * 由调用方保留上一份完整快照，避免节点信息/对等节点区块反复消失再出现。
 */
const queryWithRetry = async (
  query: () => Promise<any>,
  isValid: (value: any) => boolean
): Promise<any> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await query()
      if (isValid(result)) return result
    } catch {
      // CLI 调用失败（RPC 超时/进程退出）按未命中处理，仍重试一次
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return null
}

const fetchMonitorData = async (item: RunningItem) => {
  const isTauri = isTauriEnv()
  if (!isTauri) {
    // 非 Tauri 环境使用 mock
    const rawPeers = mockPeers[item.configFileName] || []
    const processed = processPeerData(rawPeers)
    const txTotal = processed.reduce((s, p) => s + (Number(p.tx_bytes) || 0), 0)
    const rxTotal = processed.reduce((s, p) => s + (Number(p.rx_bytes) || 0), 0)
    const snapshot: MonitorSnapshot = {
      nodeInfo: mockNodeInfo[item.configFileName] || {},
      peerList: processed,
      lastUpdate: Date.now(),
      txTotal,
      rxTotal,
      avgLatency: calcAvgLatency(processed)
    }
    return snapshot
  }

  // Tauri 环境（桌面：easytier-cli；Android：进程内 RPC —— 均由 coreApi 分发）
  try {
    // 从 TOML 读取展示字段（instance_name, network_name, dhcp, exit_nodes, port_forward）
    let instanceName = ''
    let networkName = ''
    let dhcp = false
    let exitNodes: any[] = []
    let portForward: any[] = []
    try {
      const content = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
      if (content) {
        const parsed = toml.parse(content) as any
        instanceName = (parsed.instance_name as string) || ''
        networkName = (parsed.network_identity as any)?.network_name || ''
        dhcp = !!parsed.dhcp
        exitNodes = Array.isArray(parsed.exit_nodes) ? parsed.exit_nodes : []
        portForward = Array.isArray(parsed.port_forward) ? parsed.port_forward : []
      }
    } catch (e) {
      console.error('解析监控配置失败:', e)
    }

    const [nodeInfo, peerList] = await Promise.all([
      queryWithRetry(
        () => coreApi.queryNode(item),
        (v) => !!v
      ),
      queryWithRetry(
        () => coreApi.queryPeer(item),
        (v) => Array.isArray(v)
      )
    ])
    if (!nodeInfo || !peerList) {
      // 任一查询失败：本次快照不完整，直接丢弃（调用方保留上一份数据并计失败次数）
      return null
    }

    // 从 TOML 缓存注入配置信息
    if (nodeInfo) {
      nodeInfo._instance_name = instanceName
      nodeInfo._network_name = networkName
      nodeInfo._dhcp = dhcp
      nodeInfo._exit_nodes = exitNodes
      nodeInfo._port_forward = portForward
    }
    // NAT 类型数字映射（复用 easyTierUtil 中已验证的映射）
    if (nodeInfo?.stun_info?.udp_nat_type != null) {
      nodeInfo.stun_info._udp_nat_type = getNatType(nodeInfo.stun_info.udp_nat_type)
    }
    const rawPeers = peerList

    const processed = processPeerData(rawPeers)
    const remotePeers = processed.filter((p) => p.cost !== routeCost('Local'))
    const txTotal = remotePeers.reduce((s, p) => s + parseHumanBytes(p.tx_bytes), 0)
    const rxTotal = remotePeers.reduce((s, p) => s + parseHumanBytes(p.rx_bytes), 0)

    const snapshot: MonitorSnapshot = {
      nodeInfo: nodeInfo || {},
      peerList: processed,
      lastUpdate: Date.now(),
      txTotal,
      rxTotal,
      avgLatency: calcAvgLatency(processed)
    }
    return snapshot
  } catch (e) {
    console.error('获取监控数据失败:', e)
    return null
  }
}

// --- 快照落地：写总览摘要（5.2）+ P2P 全直连通知（5.4） ---
const handleSnapshotSuccess = (configName: string, snapshot: MonitorSnapshot) => {
  // 5.2：总览摘要快照（单写多读，总览页不复制轮询）
  easyTierStore.setMonitorSummary(configName, {
    nodeCount: snapshot.peerList.length,
    avgLatency: snapshot.avgLatency
  })
  // 5.4：全部远端 Peer 均 P2P 直连时一次性通知（排除本机项，去重复用 p2pNotify 标志位）
  if (!easyTierStore.p2pNotifySetting || !easyTierStore.p2pNotify) return
  const remotePeers = snapshot.peerList.filter((p) => p.cost !== routeCost('Local'))
  if (remotePeers.length > 0 && remotePeers.every((p) => p.cost === routeCost('p2p'))) {
    easyTierStore.setP2pNotify(false)
    toast(t('newMonitor.p2pAllConnected'), 'success', 4000)
  }
}

// --- 选中配置 ---
// 切换选中实例：重置详情/失败计数与趋势，运行中则开始轮询，否则停轮询
const selectConfig = (item: RunningItem) => {
  // Android：先进入详情路由，由 syncDetailFromRoute 统一选中并启动轮询
  if (isAndroidPlatform && !isAndroidDetailRoute.value) {
    easyTierStore.setLastSelectedConfig(item)
    router.push({ name: 'NewMonitorDetailView', query: { name: item.configFileName } })
    return
  }
  selectedConfig.value = item
  syncTrend()
  selectedData.value = null
  consecutiveFailures.value = 0
  // 切换/重新选中：丢弃旧的累计流量基线，首个新采样仅作为基线不画速率点
  delete lastRateSample.value[item.configFileName]
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
  consecutiveFailures.value = 0
}

// Android 详情路由 → 页面状态：进入时选中对应运行实例，返回列表时停止轮询并清空
const syncDetailFromRoute = async () => {
  if (!isAndroidPlatform) return
  if (!isAndroidDetailRoute.value) {
    closeMonitorDetail()
    return
  }
  const name = typeof route.query.name === 'string' ? route.query.name : ''
  if (!name) {
    router.replace({ name: 'NewMonitor' })
    return
  }
  if (!easyTierStore.configListLoaded) await easyTierStore.loadConfigFiles()
  // 路由直达时运行态可能尚未刷新，补一次扫描再判定实例是否存在
  if (!displayList.value.some((c) => c.configFileName === name)) await updateRunningList()
  const item = displayList.value.find((c) => c.configFileName === name)
  if (!item) {
    // 列表仍在加载时不做“实例不存在”判定，加载完成后由 configListLoaded 监听重试
    if (!easyTierStore.configListLoaded) return
    toast(t('newMonitor.configNotFound'), 'warning')
    router.replace({ name: 'NewMonitor' })
    return
  }
  selectConfig(item)
}

// 路由切换（系统返回键 / 直接打开详情）时同步详情态
watch(
  () => [route.name, route.query.name],
  (next, prev) => {
    if (!isAndroidPlatform) return
    const [name] = next
    const [prevName] = prev
    if (name !== 'NewMonitorDetailView' && prevName !== 'NewMonitorDetailView') return
    void syncDetailFromRoute()
  }
)
// 配置列表加载完成（深链打开详情时列表可能滞后）后重试同步
watch(
  () => easyTierStore.configListLoaded,
  (loaded) => {
    if (loaded && isAndroidDetailRoute.value && !selectedConfig.value) {
      void syncDetailFromRoute()
    }
  }
)

// --- 轮询 ---
// 连续失败阈值：前两次保留快照并继续自动重试；达到上限停止轮询，
// 但保留最后一份快照并提示数据可能已过期（UX-108），由手动重试恢复。
const consecutiveFailures = ref(0)
const MAX_FAILURES = 3
const pollFailed = computed(() => consecutiveFailures.value >= MAX_FAILURES)

// 空态 CTA：新建配置（Android 走二级页，桌面打开配置页并自动拉起新增弹窗）
const goCreateConfig = () => {
  router.push(isAndroidPlatform ? '/new/config-add' : '/new/config?create=1')
}
const goConfigPage = () => {
  router.push('/new/config')
}

// 手动重试：重置失败计数并立即重新开始轮询
const retryPolling = () => {
  if (!selectedConfig.value) return
  consecutiveFailures.value = 0
  startPolling()
}

// 开始轮询（先清理旧定时器；仅对运行中的选中实例生效）
// pollGeneration：每次启停自增，丢弃切换配置/页面隐藏后仍在飞的旧请求结果，
// 避免旧请求失败时把新配置的轮询计数推到上限并误停新轮询。
let pollGeneration = 0
// 全局在飞标记：只由请求自身置位/复位（stopPolling 不得清除），保证任意时刻只有一个查询
let isFetching = false
const startPolling = () => {
  stopPolling()
  const cfg = selectedConfig.value
  if (!cfg) return
  if (!runningSet.value.has(cfg.configFileName)) return
  const gen = pollGeneration

  const doPoll = async () => {
    if (isFetching) return
    isFetching = true
    try {
      const data = await fetchMonitorData(cfg)
      // 页面隐藏/切换配置后旧请求返回：直接丢弃，不影响新轮询状态
      if (gen !== pollGeneration || !isMounted) return
      if (selectedConfig.value?.configFileName !== cfg.configFileName) return
      if (data) {
        selectedData.value = data
        handleSnapshotSuccess(cfg.configFileName, data)
        recordTrend(cfg.configFileName, data)
        consecutiveFailures.value = 0
      } else {
        consecutiveFailures.value++
        if (consecutiveFailures.value >= MAX_FAILURES) {
          // 停止轮询但不丢弃最后快照，由 stale 横幅提示并允许手动重试
          stopPolling()
        }
      }
    } finally {
      isFetching = false
    }
  }

  // 首次立即执行，后续定时
  doPoll()
  pollTimer = setInterval(doPoll, (easyTierStore.refreshInterval || 3) * 1000)
}

// 停止轮询：代际自增使在飞请求作废；不清 isFetching，
// 由请求自身复位，避免旧请求与新一代请求并发
const stopPolling = () => {
  pollGeneration++
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 运行状态变化（外部启停/服务变化）：重新运行 → 重置差分基线并恢复轮询；
// 停止 → 停轮询并清空该配置趋势，避免停机前后的曲线被直接连起来。
// selectedWasRunning 与 selectConfig 中的手动启停同步，避免选中配置时重复启动；
// 关闭详情（selectedConfig 置空）不清趋势，重新打开时仍可看到本段运行历史。
let selectedWasRunning = false
watch(selectedRunning, (running) => {
  const cfg = selectedConfig.value
  if (!cfg) {
    selectedWasRunning = false
    return
  }
  if (running === selectedWasRunning) return
  selectedWasRunning = running
  if (running) {
    delete lastRateSample.value[cfg.configFileName]
    startPolling()
  } else {
    stopPolling()
    delete lastRateSample.value[cfg.configFileName]
    clearTrend(cfg.configFileName)
    syncTrend()
    consecutiveFailures.value = 0
  }
})

// --- 生命周期 ---
onMounted(async () => {
  isMounted = true
  easyTierStore.registerPageRefresh(refreshRuntimeState)
  await loadConfigs()
  if (isAndroidPlatform) await syncDetailFromRoute()
  document.addEventListener('visibilitychange', visibilityHandler)
})

onUnmounted(() => {
  isMounted = false
  stopPolling()
  easyTierStore.clearPageRefresh()
  document.removeEventListener('visibilitychange', visibilityHandler)
})
</script>

<style scoped>
.nm-root {
  display: flex;
  gap: var(--theme-space-4);
  height: 100%;
  min-height: 0;
  font-family: var(--theme-font-body);
}

/* 左侧列表 */
.nm-left {
  display: flex;
  width: 240px;
  min-height: 0;
  flex-shrink: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.nm-left-label {
  padding: 0 var(--theme-space-1);
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nm-left-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--theme-space-1);
}

.nm-left-scroll {
  display: flex;
  min-height: 0;
  padding: var(--theme-space-3);
  overflow-y: auto;
  background: var(--theme-bg-tag);
  border-radius: var(--theme-radius-md);
  flex: 1;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.nm-card {
  position: relative;
  padding: var(--theme-space-4);
  overflow: hidden;
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  transition: var(--theme-transition-surface);
  flex-shrink: 0;
}

.nm-card:active {
  border-color: var(--theme-accent-primary);
}

.nm-android .nm-card {
  padding-right: 42px;
}

.nmc-chev {
  position: absolute;
  top: 50%;
  right: var(--theme-space-4);
  color: var(--theme-text-muted);
  transform: translateY(-50%);
}

.nm-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--theme-shadow-sm);
}

.nm-card.active {
  border-color: var(--theme-accent-primary);
  box-shadow: 0 0 0 2px var(--theme-bg-active);
}

.nmc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--theme-space-1);
}

.nmc-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

.nmc-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--theme-radius-round);
}

.nmc-dot.on {
  background: var(--theme-color-success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--theme-color-success) 40%, transparent);
}

.nmc-dot.off {
  background: var(--theme-text-muted);
}

.nmc-status-text {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nmc-pid {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.nmc-rpc {
  margin-top: 2px;
  font-family: var(--theme-font-mono, monospace);
  font-size: 11px;
  color: var(--theme-text-muted);
  opacity: 0.8;
}

.nmc-name {
  margin-bottom: 2px;
  font-family: var(--theme-font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nmc-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.nmc-btn {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
}

.nmc-btn-run {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nmc-btn-run:hover:not(:disabled) {
  transform: scale(1.04);
}

.nmc-btn-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nmc-btn-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
}

.nmc-btn:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
}

/* 右侧详情 */
.nm-right {
  min-height: 0;
  padding: var(--theme-space-5) var(--theme-space-6);
  overflow-y: auto;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  flex: 1;
}

/* 移动端返回按钮（默认隐藏，仅窄屏在详情头部展示） */
.nm-back-btn {
  display: none;
  padding: var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: var(--theme-space-2);
}

.nm-back-btn:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-active);
}

/* 移动端适配：master-detail 互斥，列表与详情单独展示 */
@media (width <= 900px) {
  .nm-root {
    flex-direction: column;
  }

  .nm-left {
    width: 100%;
    flex: 1;
  }

  /* 选中详情后隐藏列表，仅展示详情 */
  .nm-detail-open .nm-left {
    display: none;
  }

  /* 清单态隐藏空占位面板 */
  .nm-root:not(.nm-detail-open) .nm-right {
    display: none;
  }

  .nm-right {
    flex: 1;
    padding: var(--theme-space-4);
  }

  .nm-back-btn {
    display: flex;
  }

  /* 详情头部允许换行，避免标题与按钮组互挤导致标题竖排/按钮溢出 */
  .nm-detail-header {
    flex-wrap: wrap;
    gap: var(--theme-space-3);
  }

  .nm-detail-title-row {
    flex-wrap: wrap;
    min-width: 0;
  }

  .nm-detail-title {
    overflow-wrap: break-word;
  }

  .nm-detail-actions {
    flex-wrap: wrap;
  }
}

/* Android：详情为独立路由，任何宽度下列表与详情都互斥展示 */
.nm-root.nm-android {
  flex-direction: column;
}

.nm-root.nm-android .nm-left {
  width: 100%;
  flex: 1;
}

.nm-root.nm-android .nm-right {
  display: none;
}

.nm-root.nm-android.nm-detail-open .nm-left {
  display: none;
}

.nm-root.nm-android.nm-detail-open .nm-right {
  display: block;
  flex: 1;
}

/* 手机尺寸：字段网格降为单列，避免长值被挤成两行 */
@media (width <= 480px) {
  .nm-root .nm-grid {
    grid-template-columns: 1fr;
  }

  /* 统计卡改为 2×2，避免四项横排把数值挤成两行 */
  .nm-root .nm-peer-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nm-root .nm-peer-stat {
    min-width: 0;
  }
}

.nm-detail-header {
  display: flex;
  padding-bottom: var(--theme-space-4);
  margin-bottom: var(--theme-space-4);
  border-bottom: 2px solid var(--theme-border-light);
  align-items: center;
  justify-content: space-between;
}

.nm-detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--theme-space-3);
}

.nm-detail-title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nm-badge {
  padding: 2px var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 11px;
  border-radius: var(--theme-radius-pill);
}

.nm-badge.on {
  color: var(--theme-color-success-dark);
  background: color-mix(in srgb, var(--theme-color-success) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-color-success) 18%, transparent);
}

.nm-badge.off {
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-text-muted) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-text-muted) 18%, transparent);
}

.nm-detail-rpc {
  padding: 2px var(--theme-space-2);
  font-family: var(--theme-font-mono, monospace);
  font-size: 11px;
  color: var(--theme-text-muted);
  background: var(--theme-bg-tag);
  border-radius: var(--theme-radius-sm);
}

.nm-detail-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.nm-btn-lg {
  padding: var(--theme-space-2) var(--theme-space-5);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
}

.nm-btn-start {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nm-btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nm-btn-kill {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nm-btn-kill:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nm-btn-lg:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
}

/* Peer 摘要统计 */
.nm-peer-summary {
  display: flex;
  gap: var(--theme-space-3);
  margin-bottom: var(--theme-space-4);
  flex-wrap: wrap;
}

.nm-peer-stat {
  display: flex;
  padding: var(--theme-space-3);
  background: var(--theme-bg-tag);
  border-radius: var(--theme-radius-lg);
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.nm-ps-num {
  font-family: var(--theme-font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--theme-text-primary);
  white-space: nowrap;
}

.nm-ps-lbl {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted);
}

/* 5.16：趋势折叠区块（标题沿用区块标题样式，折叠内容自成一卡） */
.nm-trend-collapse {
  margin-bottom: var(--theme-space-4);
}

.nm-trend-summary {
  display: flex;
  padding: 0 0 var(--theme-space-3);
  list-style: none;
  cursor: pointer;
  user-select: none;
  align-items: center;
}

.nm-trend-summary::-webkit-details-marker {
  display: none;
}

/* 折叠指示放右端：标题起点与「节点信息/对等节点」对齐 */
.nm-trend-summary::before {
  order: 2;
  width: 7px;
  height: 7px;
  margin: 0 2px 4px var(--theme-space-2);
  border-right: 1.5px solid var(--theme-text-secondary);
  border-bottom: 1.5px solid var(--theme-text-secondary);
  content: '';
  transform: rotate(45deg);
  transition: transform var(--theme-duration-fast) var(--theme-ease-out);
}

.nm-trend-collapse[open] .nm-trend-summary::before {
  transform: rotate(225deg);
}

/* 与节点信息/对等节点同款尾线，宽屏下标题不孤悬 */
.nm-trend-summary::after {
  order: 1;
  flex: 1;
  height: 2px;
  margin-left: var(--theme-space-2);
  background: linear-gradient(90deg, var(--theme-border-light), transparent);
  content: '';
}

.nm-trend-label {
  display: inline-flex;
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary);
  align-items: center;
}

.nm-trend-body {
  padding: var(--theme-space-2) var(--theme-space-4) var(--theme-space-4);
  background: var(--theme-bg-tag);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
}

/* Section */
.nm-section {
  margin-bottom: var(--theme-space-4);
}

.nm-section-title {
  display: flex;
  margin-bottom: var(--theme-space-3);
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary);
  align-items: center;
  gap: var(--theme-space-2);
}

.nm-section-title::after {
  height: 2px;
  background: linear-gradient(90deg, var(--theme-border-light), transparent);
  content: '';
  flex: 1;
}

.nm-section-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--theme-text-muted);
}

/* 节点信息网格 */
.nm-grid {
  display: grid;
  overflow: hidden;
  background: var(--theme-border-light);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
}

.nm-field {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-card);
  flex-direction: column;
  gap: 2px;
}

.nm-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nm-val {
  font-size: 13px;
  color: var(--theme-text-primary);
  word-break: break-all;
}

/* Peer 卡片网格 */
.nm-peer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--theme-space-2);
}

.nm-peer-card {
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-tag);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg);
  transition: var(--theme-transition-surface);
}

.nm-peer-card:hover {
  border-color: var(--theme-accent-primary);
  box-shadow: var(--theme-shadow-sm);
}

.nmp-top {
  display: flex;
  padding-bottom: var(--theme-space-2);
  margin-bottom: var(--theme-space-2);
  border-bottom: 1px solid var(--theme-border-light);
  align-items: center;
  justify-content: space-between;
}

.nmp-hostname {
  font-family: var(--theme-font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nmp-lat {
  font-family: var(--theme-font-display);
  font-size: 13px;
  font-weight: 600;
}

.nmp-detail {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-1);
}

.nmp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.nmp-key {
  color: var(--theme-text-muted);
  flex-shrink: 0;
}

.nmp-val {
  color: var(--theme-text-secondary);
  text-align: right;
  word-break: break-all;
}

.nmp-val.warn {
  font-weight: 500;
  color: var(--theme-color-danger);
}

/* 更新时间 */
.nm-update-time {
  padding-top: var(--theme-space-2);
  font-size: 11px;
  color: var(--theme-text-muted);
  text-align: right;
  border-top: 1px solid var(--theme-border-light);
}

/* 空态 */
.nm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--theme-space-2);
  opacity: 0.5;
}

.nm-empty-icon {
  font-size: 40px;
  color: var(--theme-color-scrollbar);
}

.nm-empty p {
  margin: 0;
  font-size: 13px;
  color: var(--theme-text-muted);
}

.nm-empty-cards {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--theme-space-10) 0;
  gap: var(--theme-space-2);
  color: var(--theme-text-muted);
}

.nm-empty-cards p {
  margin: 0;
  font-size: 14px;
}

.nm-empty-desc {
  max-width: 260px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted);
  text-align: center;
}

.nm-empty-cta {
  padding: var(--theme-space-2) var(--theme-space-5);
  margin-top: var(--theme-space-2);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-white);
  cursor: pointer;
  background: var(--theme-accent-primary);
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
}

.nm-empty-cta:hover {
  transform: translateY(-1px);
}

/* 选中实例但无快照时的居中状态（加载 / 未运行 / 从未成功） */
.nm-state {
  display: flex;
  height: calc(100% - 80px);
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--theme-space-2);
  text-align: center;
}

.nm-state-icon {
  font-size: 32px;
  color: var(--theme-text-muted);
}

.nm-state-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--theme-text-secondary);
}

.nm-state-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--theme-border);
  border-top-color: var(--theme-accent-primary);
  border-radius: var(--theme-radius-round);
  animation: nm-spin 0.8s linear infinite;
}

@keyframes nm-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 轮询失败横幅：前两次为轻提示，达到上限转为警示色并给出重试 */
.nm-stale-banner {
  display: flex;
  align-items: center;
  padding: var(--theme-space-2) var(--theme-space-4);
  margin-bottom: var(--theme-space-4);
  font-size: 12px;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-md);
  flex-wrap: wrap;
  gap: var(--theme-space-3);
}

.nm-stale-banner.warn {
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 8%, transparent);
  border-color: color-mix(in srgb, var(--theme-accent-primary) 25%, transparent);
}

.nm-stale-text {
  min-width: 0;
  flex: 1;
}

.nm-stale-time {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nm-stale-retry {
  padding: 2px var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-white);
  cursor: pointer;
  background: var(--theme-accent-primary);
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
}

.nm-stale-retry:hover {
  transform: translateY(-1px);
}
</style>
