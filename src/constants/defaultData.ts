import type { EasyTierFormData, FormWebData } from '@/types/formTypes'
import type { CoreFeature } from '@/constants/kernelCompat'

const defaultFormData: EasyTierFormData | any = {
  hostname: '',
  instance_name: '',
  machine_id: undefined, // 机器 ID，默认从系统获取
  network_identity: {
    network_name: '',
    network_secret: ''
  },
  dhcp: true,
  ipv4: undefined,
  ipv6: undefined,
  peer: [{ uri: undefined }],
  external_node: undefined, // 外部节点
  listeners: [],
  mapped_listeners: [],
  routes: undefined,
  proxy_network: [{ cidr: undefined }],
  exit_nodes: [],
  rpc_portal: '0.0.0.0:15888',
  rpc_portal_whitelist: undefined, // RPC 白名单
  socks5_proxy: undefined, // SOCKS5 代理（顶层）
  credential_file: undefined, // 凭据存储文件路径（顶层，安全模式管理节点使用）
  tcp_whitelist: [],
  udp_whitelist: [],
  stun_servers: undefined, // STUN 服务器列表
  stun_servers_v6: undefined, // IPv6 STUN 服务器列表
  ipv6_public_addr_provider: false, // 共享公网 IPv6 子网（v2.6.2+，顶层布尔字段）
  ipv6_public_addr_auto: false, // 自动获取公网 IPv6 地址（v2.6.2+）
  ipv6_public_addr_prefix: '', // 手动指定公网 IPv6 子网（v2.6.2+）
  console_logger: { level: undefined },
  file_logger: {
    level: 'error',
    file: 'easytier',
    dir: '',
    size: undefined, // 单个日志文件大小 MB，默认 100
    count: undefined // 最大日志文件数量，默认 10
  },
  vpn_portal_config: undefined, // VPN 门户（结构随内核版本变化，表单按原样透传，不设默认值）
  port_forward: [], // 端口转发
  flags: {
    default_protocol: 'tcp',
    dev_name: '',
    data_compress_algo: undefined,
    enable_encryption: true,
    encryption_algorithm: undefined, // 加密算法，默认 aes-gcm
    enable_ipv6: true,
    mtu: undefined, // MTU，默认 1380/1360
    latency_first: true,
    enable_exit_node: false,
    no_tun: false,
    use_smoltcp: false,
    disable_p2p: false,
    disable_udp_hole_punching: false,
    disable_tcp_hole_punching: undefined, // 禁用 TCP 打洞
    disable_sym_hole_punching: undefined, // 禁用对称 NAT 打洞
    multi_thread: true,
    multi_thread_count: undefined, // 线程数，默认 2
    relay_all_peer_rpc: false,
    relay_network_whitelist: '*',
    bind_device: true,
    disable_kcp_input: false,
    enable_kcp_proxy: false,
    enable_quic_proxy: undefined, // 启用 QUIC 代理
    disable_quic_input: undefined, // 禁用 QUIC 输入
    accept_dns: false,
    private_mode: false,
    proxy_forward_by_system: false,
    foreign_relay_bps_limit: undefined, // 外部中继带宽限制
    instance_recv_bps_limit: undefined, // 实例入站带宽限制
    p2p_only: undefined, // 仅 P2P 模式
    lazy_p2p: undefined, // 按需建立 P2P
    need_p2p: undefined, // 声明需要主动 P2P
    disable_upnp: undefined, // 禁用 UPnP/NAT-PMP 映射
    enable_udp_broadcast_relay: undefined, // 启用 UDP 广播中继
    disable_relay_kcp: undefined, // 禁止转发 KCP 数据包
    disable_relay_quic: undefined, // 禁止转发 QUIC 数据包
    disable_relay_data: undefined, // 禁止转发数据包（v2.6.3+）
    prefer_peer_relay: undefined, // 优先 Peer 中继（v2.7.0+）
    enable_relay_foreign_network_kcp: undefined, // 允许转发外部网络 KCP
    enable_relay_foreign_network_quic: undefined, // 允许转发外部网络 QUIC
    tld_dns_zone: undefined // TLD DNS 区域
  }
}
/**
 * 高级字段定义（5.6 安全模式 / IPv6 / 高级选项）
 * key/label/type/tooltip 集中维护，EditDialog 用 v-for 渲染，杜绝手写重复
 */
export interface AdvancedFieldDef {
  key: string
  type: 'text' | 'switch'
  labelKey: string // i18n key，字段标签
  tooltipKey?: string // i18n key，title 属性挂 tooltip
  secret?: boolean // 敏感字段：回显掩码、保存写回原值
  filePick?: boolean // 文本输入行带 📁 选择按钮（Tauri 文件选择）
  secureMode?: boolean // true: 位于 [secure_mode] 表内；false/缺省: 顶层字段
  feature?: CoreFeature // 所属内核功能：当前内核不支持时归入“当前内核未兼容”栏
  defaultValue?: boolean // 内核默认值（缺省 false）；用于缺省未写配置时的开关显示
}

/**
 * 安全模式字段（EasyTier Core v2.6.4 规范）
 * local_private_key / local_public_key 位于 [secure_mode] 表内；
 * credential_file 为顶层字段（仅凭据管理节点使用）。
 * 仅当表单中的安全模式开关启用时才渲染与落盘。
 */
export const SECURITY_FIELD_DEFS: AdvancedFieldDef[] = [
  {
    key: 'local_private_key',
    type: 'text',
    labelKey: 'newEdit.lblPrivateKey',
    tooltipKey: 'newEdit.tipPrivateKey',
    secret: true,
    secureMode: true,
    feature: 'secureMode'
  },
  {
    key: 'local_public_key',
    type: 'text',
    labelKey: 'newEdit.lblPublicKey',
    tooltipKey: 'newEdit.tipPublicKey',
    secureMode: true,
    feature: 'secureMode'
  },
  {
    key: 'credential_file',
    type: 'text',
    labelKey: 'newEdit.lblCredentialFile',
    tooltipKey: 'newEdit.tipCredentialFile',
    filePick: true,
    feature: 'secureMode'
  }
]

// 高级选项（flags 内布尔开关，2 列网格）
// 覆盖内核 2.4.5 ~ 2.7.0 的全部布尔 flags；非布尔 flags 仍由“自定义 Flags”编辑。
// defaultValue 与 EasyTier 内核 gen_default_flags() 保持一致：缺省未写时按内核默认显示。
export const ADVANCED_FLAG_DEFS: AdvancedFieldDef[] = [
  {
    key: 'bind_device',
    type: 'switch',
    labelKey: 'newEdit.lblBindDevice',
    tooltipKey: 'newEdit.tipBindDevice',
    defaultValue: true
  },
  {
    key: 'enable_encryption',
    type: 'switch',
    labelKey: 'newEdit.lblEnableEncryption',
    tooltipKey: 'newEdit.tipEnableEncryption',
    defaultValue: true
  },
  {
    key: 'enable_ipv6',
    type: 'switch',
    labelKey: 'newEdit.lblEnableIpv6',
    tooltipKey: 'newEdit.tipEnableIpv6',
    defaultValue: true
  },
  {
    key: 'latency_first',
    type: 'switch',
    labelKey: 'newEdit.lblLatencyFirst',
    tooltipKey: 'newEdit.tipLatencyFirst'
  },
  {
    key: 'multi_thread',
    type: 'switch',
    labelKey: 'newEdit.lblMultiThread',
    tooltipKey: 'newEdit.tipMultiThread',
    defaultValue: true
  },
  {
    key: 'no_tun',
    type: 'switch',
    labelKey: 'newEdit.lblNoTun',
    tooltipKey: 'newEdit.tipNoTun'
  },
  {
    key: 'use_smoltcp',
    type: 'switch',
    labelKey: 'newEdit.lblUseSmoltcp',
    tooltipKey: 'newEdit.tipUseSmoltcp'
  },
  {
    key: 'enable_exit_node',
    type: 'switch',
    labelKey: 'newEdit.lblEnableExitNode',
    tooltipKey: 'newEdit.tipEnableExitNode'
  },
  {
    key: 'proxy_forward_by_system',
    type: 'switch',
    labelKey: 'newEdit.lblProxyForwardBySystem',
    tooltipKey: 'newEdit.tipProxyForwardBySystem'
  },
  {
    key: 'disable_p2p',
    type: 'switch',
    labelKey: 'newEdit.lblDisableP2p',
    tooltipKey: 'newEdit.tipDisableP2p'
  },
  {
    key: 'disable_udp_hole_punching',
    type: 'switch',
    labelKey: 'newEdit.lblDisableUdpHole',
    tooltipKey: 'newEdit.tipDisableUdpHole'
  },
  {
    key: 'disable_tcp_hole_punching',
    type: 'switch',
    labelKey: 'newEdit.lblDisableTcpHole',
    tooltipKey: 'newEdit.tipDisableTcpHole'
  },
  {
    key: 'disable_sym_hole_punching',
    type: 'switch',
    labelKey: 'newEdit.lblDisableSymHole',
    tooltipKey: 'newEdit.tipDisableSymHole'
  },
  {
    key: 'disable_upnp',
    type: 'switch',
    labelKey: 'newEdit.lblDisableUpnp',
    tooltipKey: 'newEdit.tipDisableUpnp'
  },
  {
    key: 'enable_udp_broadcast_relay',
    type: 'switch',
    labelKey: 'newEdit.lblUdpBroadcastRelay',
    tooltipKey: 'newEdit.tipUdpBroadcastRelay'
  },
  {
    key: 'p2p_only',
    type: 'switch',
    labelKey: 'newEdit.lblP2pOnly',
    tooltipKey: 'newEdit.tipP2pOnly'
  },
  {
    key: 'lazy_p2p',
    type: 'switch',
    labelKey: 'newEdit.lblLazyP2p',
    tooltipKey: 'newEdit.tipLazyP2p'
  },
  {
    key: 'need_p2p',
    type: 'switch',
    labelKey: 'newEdit.lblNeedP2p',
    tooltipKey: 'newEdit.tipNeedP2p'
  },
  {
    key: 'accept_dns',
    type: 'switch',
    labelKey: 'newEdit.lblAcceptDns',
    tooltipKey: 'newEdit.tipAcceptDns'
  },
  {
    key: 'relay_all_peer_rpc',
    type: 'switch',
    labelKey: 'newEdit.lblRelayAllPeerRpc',
    tooltipKey: 'newEdit.tipRelayAllPeerRpc'
  },
  {
    key: 'disable_kcp_input',
    type: 'switch',
    labelKey: 'newEdit.lblDisableKcpInput',
    tooltipKey: 'newEdit.tipDisableKcpInput'
  },
  {
    key: 'enable_kcp_proxy',
    type: 'switch',
    labelKey: 'newEdit.lblEnableKcpProxy',
    tooltipKey: 'newEdit.tipEnableKcpProxy'
  },
  {
    key: 'disable_relay_kcp',
    type: 'switch',
    labelKey: 'newEdit.lblDisableRelayKcp',
    tooltipKey: 'newEdit.tipDisableRelayKcp'
  },
  {
    key: 'disable_relay_data',
    type: 'switch',
    labelKey: 'newEdit.lblDisableRelayData',
    tooltipKey: 'newEdit.tipDisableRelayData'
  },
  {
    key: 'enable_relay_foreign_network_kcp',
    type: 'switch',
    labelKey: 'newEdit.lblRelayForeignKcp',
    tooltipKey: 'newEdit.tipRelayForeignKcp'
  },
  {
    key: 'disable_quic_input',
    type: 'switch',
    labelKey: 'newEdit.lblDisableQuicInput',
    tooltipKey: 'newEdit.tipDisableQuicInput'
  },
  {
    key: 'enable_quic_proxy',
    type: 'switch',
    labelKey: 'newEdit.lblEnableQuicProxy',
    tooltipKey: 'newEdit.tipEnableQuicProxy'
  },
  {
    key: 'disable_relay_quic',
    type: 'switch',
    labelKey: 'newEdit.lblDisableRelayQuic',
    tooltipKey: 'newEdit.tipDisableRelayQuic'
  },
  {
    key: 'enable_relay_foreign_network_quic',
    type: 'switch',
    labelKey: 'newEdit.lblRelayForeignQuic',
    tooltipKey: 'newEdit.tipRelayForeignQuic'
  },
  {
    key: 'prefer_peer_relay',
    type: 'switch',
    labelKey: 'newEdit.lblPreferPeerRelay',
    tooltipKey: 'newEdit.tipPreferPeerRelay'
  },
  {
    key: 'private_mode',
    type: 'switch',
    labelKey: 'newEdit.lblPrivateMode',
    tooltipKey: 'newEdit.tipPrivateMode'
  }
]

// 高级选项（顶层布尔开关；key 为顶层字段而非 flags）
export const ADVANCED_TOP_SWITCH_DEFS: AdvancedFieldDef[] = [
  {
    key: 'ipv6_public_addr_provider',
    type: 'switch',
    labelKey: 'newEdit.lblIpv6Provider',
    tooltipKey: 'newEdit.tipIpv6Provider',
    feature: 'ipv6PublicAddr'
  },
  {
    key: 'ipv6_public_addr_auto',
    type: 'switch',
    labelKey: 'newEdit.lblIpv6Auto',
    tooltipKey: 'newEdit.tipIpv6Auto',
    feature: 'ipv6PublicAddr'
  }
]

// 高级选项（顶层文本输入）
export const ADVANCED_TOP_TEXT_DEFS: AdvancedFieldDef[] = [
  {
    key: 'socks5_proxy',
    type: 'text',
    labelKey: 'newEdit.lblSocks5',
    tooltipKey: 'newEdit.tipSocks5'
  },
  { key: 'stun_servers', type: 'text', labelKey: 'newEdit.lblStun', tooltipKey: 'newEdit.tipStun' },
  {
    key: 'ipv6_public_addr_prefix',
    type: 'text',
    labelKey: 'newEdit.lblIpv6Prefix',
    tooltipKey: 'newEdit.tipIpv6Prefix',
    feature: 'ipv6PublicAddr'
  }
]

// 固定高级字段的全部 key（动态 Flags 编辑器需排除，避免同一 key 双处编辑）
export const ADVANCED_FIELD_KEYS: string[] = [
  ...ADVANCED_FLAG_DEFS.map((f) => f.key),
  ...ADVANCED_TOP_SWITCH_DEFS.map((f) => f.key),
  ...ADVANCED_TOP_TEXT_DEFS.map((f) => f.key)
]

// 敏感字段掩码占位
export const SECRET_MASK = '••••••'

/**
 * 配置模板（5.8 服务器配置模板）
 * 纯数据，仅派生表单初始值，不参与 TOML 序列化管线
 * values 为可直接 toml.stringify 的配置对象（空对象 = 自定义）
 */
export interface ConfigTemplate {
  id: 'server' | 'client' | 'custom'
  labelKey: string
  descriptionKey: string
  values: Record<string, any>
}
export const CONFIG_TEMPLATES: ConfigTemplate[] = [
  {
    id: 'server',
    labelKey: 'newEdit.templateServer',
    descriptionKey: 'newEdit.templateServerDesc',
    values: {
      dhcp: true,
      listeners: ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
      flags: {
        enable_exit_node: true,
        latency_first: true,
        multi_thread: true
      }
    }
  },
  {
    id: 'client',
    labelKey: 'newEdit.templateClient',
    descriptionKey: 'newEdit.templateClientDesc',
    values: {
      dhcp: true,
      flags: {
        latency_first: true,
        multi_thread: true
      }
    }
  },
  {
    id: 'custom',
    labelKey: 'newEdit.templateCustom',
    descriptionKey: 'newEdit.templateCustomDesc',
    values: {}
  }
]
const defaultFormWebData: FormWebData = {
  host: '',
  port: 22020,
  protocol: 'udp',
  userName: '',
  webStartMethod: 2,
  configFileName: '',
  webUrl: '',
  status: 'notRunning'
}
export default { defaultFormData, defaultFormWebData }
