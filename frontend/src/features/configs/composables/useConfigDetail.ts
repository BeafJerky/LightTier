/**
 * 配置详情状态机：读取 TOML、解析、错误分类与过期请求丢弃。
 * 选中项由调用方持有（列表与详情共用同一 selectedConfig），本组合式函数只管理详情内容。
 */
import { computed, ref } from 'vue'
import * as toml from 'smol-toml'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import { migrateLightTierConfig } from '@/entities/config/lighttierConfigUtil'

export type DetailState = 'idle' | 'loading' | 'ready' | 'demo' | 'error'
export interface DetailError {
  kind: 'read' | 'parse' | 'empty'
  message: string
}

interface UseConfigDetailOptions {
  readFileContent: (path: string) => Promise<string | ArrayBuffer>
  writeFileContent: (path: string, content: string) => Promise<void>
  isTauri: boolean
  t: (key: string) => string
}

// 内置演示配置：浏览器 Mock 环境无 fileName 时展示，保证界面完整可用（按名称匹配，缺省回退首个）
function getDemoConfig(name: string): EasyTierConfig {
  const demos: Record<string, any> = {
    东京中继节点: {
      hostname: 'tokyo-relay-01',
      instance_name: '东京中继',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'global-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11000', 'udp://0.0.0.0:11000'],
      peer: [{ uri: 'tcp://public-node-1:11000' }, { uri: 'udp://public-node-2:11000' }],
      exit_nodes: [],
      routes: ['10.0.0.0/8', '172.16.0.0/12'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    新加坡出口: {
      hostname: 'sg-exit-01',
      instance_name: '新加坡出口',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'global-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11001'],
      peer: [{ uri: 'tcp://public-node-1:11000' }],
      exit_nodes: ['0.0.0.0/0'],
      routes: [],
      flags: { default_protocol: 'tcp', mtu: 1380, enable_exit_node: true }
    },
    家庭局域网: {
      hostname: 'home-router',
      instance_name: '家庭网络',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'home-mesh', network_secret: '••••' },
      listeners: [],
      peer: [{ uri: 'tcp://tokyo-relay:11000' }],
      exit_nodes: [],
      routes: ['192.168.1.0/24'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    办公室组网: {
      hostname: 'office-gw',
      instance_name: '办公室网关',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'office-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11002'],
      peer: [{ uri: 'tcp://tokyo-relay:11000' }],
      exit_nodes: [],
      routes: ['10.10.0.0/16'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    移动设备: {
      hostname: 'mobile-01',
      instance_name: '手机',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'home-mesh', network_secret: '••••' },
      listeners: [],
      peer: [{ uri: 'tcp://home-router:11000' }],
      exit_nodes: [],
      routes: [],
      flags: { default_protocol: 'tcp', latency_first: true, no_tun: true }
    }
  }
  return (demos[name] || demos['东京中继节点']) as EasyTierConfig
}

export function useConfigDetail(options: UseConfigDetailOptions) {
  const { readFileContent, writeFileContent, isTauri, t } = options

  const selectedDetail = ref<EasyTierConfig | null>(null)
  const detailState = ref<DetailState>('idle')
  const detailError = ref<DetailError | null>(null)
  // 5.2：路由筛选（本期仅 TOML 静态筛选；运行时 route 信息待 CLI 输出含 routes 列验证后追加）
  const routeFilter = ref('')

  const detailErrorTitle = computed(() => {
    switch (detailError.value?.kind) {
      case 'parse':
        return t('newConfig.detailParseFailed')
      case 'empty':
        return t('newConfig.detailEmpty')
      default:
        return t('newConfig.detailLoadFailed')
    }
  })

  const filteredRoutes = computed(() => {
    const routes = selectedDetail.value?.routes || []
    const kw = routeFilter.value.trim().toLowerCase()
    return kw ? routes.filter((r) => String(r).toLowerCase().includes(kw)) : routes
  })

  // 请求序号：快速切换配置时，旧请求返回后不得把上一个配置的内容/错误写到新选中项上
  let detailSeq = 0

  // 读取并解析配置 TOML：Mock 环境无 fileName 时展示演示数据并明确标注；
  // Tauri 环境读取/解析失败进入错误态，不再静默回退演示数据
  const loadConfigDetail = async (item: RunningItem) => {
    const seq = ++detailSeq
    const stale = () => seq !== detailSeq
    detailState.value = 'loading'
    detailError.value = null
    selectedDetail.value = null
    routeFilter.value = ''
    if (!item.fileName) {
      if (!isTauri) {
        selectedDetail.value = getDemoConfig(item.configFileName)
        detailState.value = 'demo'
        return
      }
      detailState.value = 'error'
      detailError.value = { kind: 'read', message: '' }
      return
    }

    let content: string
    try {
      content = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
    } catch {
      if (stale()) return
      detailState.value = 'error'
      detailError.value = { kind: 'read', message: '' }
      return
    }
    if (stale()) return
    if (!content || !content.trim()) {
      detailState.value = 'error'
      detailError.value = { kind: 'empty', message: '' }
      return
    }

    try {
      const cfg = toml.parse(content) as Record<string, any>
      // 旧版 LightTier 私有标记迁到 [lighttier]（仅首次命中时回写）
      if (migrateLightTierConfig(cfg)) {
        try {
          await writeFileContent(`${CONFIG_PATH}/${item.fileName}`, toml.stringify(cfg))
        } catch {
          /* 回写失败不阻断详情展示 */
        }
      }
      if (stale()) return
      selectedDetail.value = cfg as unknown as EasyTierConfig
      detailState.value = 'ready'
    } catch (e) {
      if (stale()) return
      detailState.value = 'error'
      detailError.value = {
        kind: 'parse',
        message: e instanceof Error ? e.message : String(e)
      }
    }
  }

  // 作废在飞的详情请求并回到空闲态（关闭详情 / 切换选中时调用）
  const resetDetail = () => {
    detailSeq++
    selectedDetail.value = null
    detailState.value = 'idle'
    detailError.value = null
  }

  return {
    selectedDetail,
    detailState,
    detailError,
    detailErrorTitle,
    routeFilter,
    filteredRoutes,
    loadConfigDetail,
    resetDetail
  }
}
