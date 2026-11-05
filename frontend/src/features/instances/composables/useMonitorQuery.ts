/**
 * 监控数据查询与轮询：Tauri 订阅后端采样（lighttier-runtime），浏览器走 Mock 轮询。
 *
 * Tauri：`monitor_subscribe` 立即返回该实例上一份快照（首屏无等待），
 * 后续由 `monitor:snapshot` 事件推送；失败保留上一份数据并由后端退避重试。
 * 浏览器：保留原有 3s 轮询与失败重试（仅 mock 数据，无真实内核）。
 * 页面可见性由调用方负责（隐藏时 stopPolling，恢复时 startPolling）。
 */
import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getNatType, processPeerData, routeCost } from '@/shared/lib/monitorFormat'
import {
  onMonitorSnapshot,
  subscribeMonitor,
  toRuntimeInstance,
  unsubscribeMonitor,
  type RuntimeMonitorSnapshot
} from '@/shared/platform/runtimeApi'

export interface MonitorSnapshot {
  nodeInfo: any
  peerList: PeerInfo[]
  lastUpdate: number
  txTotal: number
  rxTotal: number
  avgLatency: string
}

interface UseMonitorQueryOptions {
  /** 当前选中实例 */
  selectedConfig: Ref<RunningItem | null>
  /** 运行中配置名集合（仅对运行中的选中实例轮询） */
  runningSet: ComputedRef<Set<string>>
  /** 轮询间隔（秒）；0 视为默认 3 秒 */
  refreshInterval: () => number
  /** 成功快照回调：写总览摘要 / P2P 通知 / 趋势采样由调用方编排 */
  onSnapshot: (configName: string, snapshot: MonitorSnapshot) => void
}

export function useMonitorQuery(options: UseMonitorQueryOptions) {
  // 监控快照：一次轮询的完整结果（nodeInfo 已合并 TOML 展示字段与 NAT 映射结果）
  const selectedData = ref<MonitorSnapshot | null>(null)

  // 连续失败阈值：前两次保留快照并继续自动重试；达到上限提示数据可能已过期
  // （UX-108），由手动重试恢复。Tauri 模式下由后端快照的 failures 驱动。
  const consecutiveFailures = ref(0)
  const MAX_FAILURES = 3
  const pollFailed = computed(() => consecutiveFailures.value >= MAX_FAILURES)

  let isMounted = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  // 每次启停自增，丢弃切换配置/页面隐藏后仍在飞的旧结果
  let pollGeneration = 0
  // 浏览器 Mock 在飞标记：保证任意时刻只有一个查询
  let isFetching = false

  // Tauri 后端订阅：当前订阅名（事件过滤）与命令串行队列
  // （订阅/取消必须保序，避免切换配置时旧取消把新订阅冲掉）
  let activeRuntimeName = ''
  let monitorUnlisten: UnlistenFn | null = null
  let monitorQueue: Promise<unknown> = Promise.resolve()
  let subscribeSeq = 0

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

  /** 后端快照归一化：NAT 数字映射 + peer 格式化 + 流量/延迟汇总 */
  const fromRuntimeSnapshot = (dto: RuntimeMonitorSnapshot): MonitorSnapshot | null => {
    if (!dto.nodeInfo || !Array.isArray(dto.peerList)) return null
    const nodeInfo: any = { ...dto.nodeInfo }
    if (nodeInfo.stun_info?.udp_nat_type != null) {
      nodeInfo.stun_info = {
        ...nodeInfo.stun_info,
        _udp_nat_type: getNatType(nodeInfo.stun_info.udp_nat_type)
      }
    }
    const processed = processPeerData(dto.peerList)
    const remotePeers = processed.filter((p) => p.cost !== routeCost('Local'))
    return {
      nodeInfo,
      peerList: processed,
      lastUpdate: dto.sampledAt,
      txTotal: remotePeers.reduce((sum, p) => sum + parseHumanBytes(p.tx_bytes), 0),
      rxTotal: remotePeers.reduce((sum, p) => sum + parseHumanBytes(p.rx_bytes), 0),
      avgLatency: calcAvgLatency(processed)
    }
  }

  /** 浏览器 Mock：与真实数据结构一致，覆盖演示场景 */
  const fetchMockSnapshot = (item: RunningItem): MonitorSnapshot => {
    const rawPeers = mockPeers[item.configFileName] || []
    const processed = processPeerData(rawPeers)
    return {
      nodeInfo: mockNodeInfo[item.configFileName] || {},
      peerList: processed,
      lastUpdate: Date.now(),
      txTotal: processed.reduce((sum, p) => sum + (Number(p.tx_bytes) || 0), 0),
      rxTotal: processed.reduce((sum, p) => sum + (Number(p.rx_bytes) || 0), 0),
      avgLatency: calcAvgLatency(processed)
    }
  }

  /** 串行执行订阅命令，保证「取消旧订阅」一定先于「订阅新配置」到达后端 */
  const enqueueMonitorTask = <T>(task: () => Promise<T>): Promise<T> => {
    const run = monitorQueue.then(task, task)
    monitorQueue = run.catch(() => undefined)
    return run
  }

  const applyRuntimeSnapshot = (dto: RuntimeMonitorSnapshot, expectedName: string) => {
    if (dto.configFileName !== expectedName) return
    consecutiveFailures.value = dto.failures
    // sampledAt 为 0：从未成功采样，保留加载态/失败态，避免展示全空数据
    if (dto.sampledAt <= 0) return
    const snapshot = fromRuntimeSnapshot(dto)
    if (!snapshot) return
    selectedData.value = snapshot
    // 失败重发的仍是上一份旧数据：展示保留，但不再写趋势/摘要（否则画出一段零速率假曲线）
    if (dto.stale) return
    options.onSnapshot(dto.configFileName, snapshot)
  }

  /** 监听后端采样事件（仅一次）；挂载状态与当前订阅名在回调内二次校验 */
  const ensureMonitorListener = async () => {
    if (monitorUnlisten) return
    const unlisten = await onMonitorSnapshot((dto) => {
      if (!isMounted || !activeRuntimeName) return
      applyRuntimeSnapshot(dto, activeRuntimeName)
    })
    if (!isMounted) {
      unlisten()
      return
    }
    monitorUnlisten = unlisten
  }

  // 开始订阅/轮询（先清理旧定时器与旧订阅；仅对运行中的选中实例生效）
  const startPolling = () => {
    stopPolling()
    const cfg = options.selectedConfig.value
    if (!cfg) return
    if (!options.runningSet.value.has(cfg.configFileName)) return
    const gen = pollGeneration

    if (isTauriEnv()) {
      activeRuntimeName = cfg.configFileName
      const interval = (options.refreshInterval() || 3) * 1000
      const seq = ++subscribeSeq
      void (async () => {
        try {
          await ensureMonitorListener()
          const cached = await enqueueMonitorTask(() =>
            subscribeMonitor(toRuntimeInstance(cfg), interval)
          )
          if (gen !== pollGeneration || seq !== subscribeSeq || !isMounted) return
          if (cached) applyRuntimeSnapshot(cached, cfg.configFileName)
        } catch (e) {
          console.warn('[Monitor] 订阅后端采样失败:', e)
          if (gen === pollGeneration && seq === subscribeSeq) {
            consecutiveFailures.value = Math.max(consecutiveFailures.value, 1)
          }
        }
      })()
      return
    }

    const doPoll = async () => {
      if (isFetching) return
      isFetching = true
      try {
        const data = fetchMockSnapshot(cfg)
        // 页面隐藏/切换配置后旧结果返回：直接丢弃
        if (gen !== pollGeneration || !isMounted) return
        if (options.selectedConfig.value?.configFileName !== cfg.configFileName) return
        selectedData.value = data
        options.onSnapshot(cfg.configFileName, data)
        consecutiveFailures.value = 0
      } finally {
        isFetching = false
      }
    }

    // 首次立即执行，后续定时
    doPoll()
    pollTimer = setInterval(doPoll, (options.refreshInterval() || 3) * 1000)
  }

  // 停止订阅/轮询：代际自增使在飞结果作废；后端取消订阅在队列中执行
  const stopPolling = () => {
    pollGeneration++
    subscribeSeq++
    activeRuntimeName = ''
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (isTauriEnv()) {
      void enqueueMonitorTask(() => unsubscribeMonitor()).catch(() => undefined)
    }
  }

  // 手动重试：重置失败计数并重新订阅（后端订阅重建即重置失败计数与退避）
  const retryPolling = () => {
    if (!options.selectedConfig.value) return
    consecutiveFailures.value = 0
    startPolling()
  }

  const resetFailures = () => {
    consecutiveFailures.value = 0
  }

  onMounted(() => {
    isMounted = true
  })

  onUnmounted(() => {
    isMounted = false
    stopPolling()
    const unlisten = monitorUnlisten
    monitorUnlisten = null
    if (unlisten) unlisten()
  })

  return {
    selectedData,
    consecutiveFailures,
    pollFailed,
    startPolling,
    stopPolling,
    retryPolling,
    resetFailures
  }
}
