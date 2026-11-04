/**
 * 监控数据查询与轮询：coreApi 查询、失败重试、快照落地与轮询生命周期。
 *
 * 可靠性策略（与原页面一致）：单次查询超时 10s、失败重试一次；node/peer 任一缺失则丢弃
 * 本次不完整快照，保留上一份完整数据；连续失败 3 次停止轮询（页面仍保留最后快照）。
 * 页面可见性由调用方负责（隐藏时 stopPolling，恢复时 startPolling）。
 */
import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import * as coreApi from '@/shared/platform/coreApi'
import { readFileContent } from '@/shared/platform/fileUtil'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import { getNatType, processPeerData, routeCost } from '@/shared/lib/monitorFormat'
import * as toml from 'smol-toml'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'

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

  // 连续失败阈值：前两次保留快照并继续自动重试；达到上限停止轮询，
  // 但保留最后一份快照并提示数据可能已过期（UX-108），由手动重试恢复。
  const consecutiveFailures = ref(0)
  const MAX_FAILURES = 3
  const pollFailed = computed(() => consecutiveFailures.value >= MAX_FAILURES)

  let isMounted = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  // 每次启停自增，丢弃切换配置/页面隐藏后仍在飞的旧请求结果，
  // 避免旧请求失败时把新配置的轮询计数推到上限并误停新轮询。
  let pollGeneration = 0
  // 全局在飞标记：只由请求自身置位/复位（stopPolling 不得清除），保证任意时刻只有一个查询
  let isFetching = false

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

  /**
   * CLI 的 RPC 查询存在偶发超时（内核繁忙时实测约 1/3 失败）。
   * 单次失败不应立即清空界面：先短延迟重试一次，仍失败返回 null，
   * 由调用方保留上一份完整快照，避免节点信息/对等节点区块反复消失再出现。
   */
  // 查询超时兜底：Rust 侧若一直不返回，isFetching 会永久为 true 并让轮询停摆
  const withQueryTimeout = (promise: Promise<any>, ms = 10000): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('monitor query timeout')), ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })

  const queryWithRetry = async (
    query: () => Promise<any>,
    isValid: (value: any) => boolean
  ): Promise<any> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await withQueryTimeout(query())
        if (isValid(result)) return result
      } catch {
        // CLI 调用失败（RPC 超时/进程退出）按未命中处理，仍重试一次
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return null
  }

  // 拉取一次监控快照：浏览器走 Mock；Tauri 环境并行查询 node/peer，
  // 并把 TOML 展示字段（instance_name/network_name/dhcp/exit_nodes/port_forward）注入 nodeInfo
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

  // 开始轮询（先清理旧定时器；仅对运行中的选中实例生效）
  const startPolling = () => {
    stopPolling()
    const cfg = options.selectedConfig.value
    if (!cfg) return
    if (!options.runningSet.value.has(cfg.configFileName)) return
    const gen = pollGeneration

    const doPoll = async () => {
      if (isFetching) return
      isFetching = true
      try {
        const data = await fetchMonitorData(cfg)
        // 页面隐藏/切换配置后旧请求返回：直接丢弃，不影响新轮询状态
        if (gen !== pollGeneration || !isMounted) return
        if (options.selectedConfig.value?.configFileName !== cfg.configFileName) return
        if (data) {
          selectedData.value = data
          options.onSnapshot(cfg.configFileName, data)
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
    pollTimer = setInterval(doPoll, (options.refreshInterval() || 3) * 1000)
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

  // 手动重试：重置失败计数并立即重新开始轮询
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
