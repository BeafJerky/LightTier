/**
 * EasyTier 内核版本兼容注册表（配置字段 / flags / CLI 差异的唯一事实来源）
 *
 * 维护依据：doc/design/EasyTier-各版本配置字段与CLI对照.md
 * - flags 基线 v2.4.5 29 个，后续版本只增不减（v2.7.0 累计 43 个）
 * - v2.7.0 起未知 flags 键会导致内核解析失败（旧版本静默忽略）
 * - v2.7.0 重构 vpn_portal_config 并启用 deny_unknown_fields
 * - v2.7.0 起 service install 的 core 参数由位置参数改为 --core-args
 *
 * 版本列表固定：新增/移除可下载版本时只改 CORE_VERSION_OPTIONS，
 * 字段差异通过「引入版本」表推导，避免为每个版本复制一份完整清单。
 */
import { BUILTIN_CORE_VERSION } from '@/constants/easytier'

export type CoreChannel = 'stable' | 'prerelease'

export interface CoreVersionOption {
  tag_name: string
  channel: CoreChannel
  /** 安装包内置版本（首次安装免下载） */
  builtin?: boolean
}

/**
 * 设置页固定版本列表（仅官方发布过的版本）
 * v2.5.0 / v2.7.0 官方标记为 pre-release，但按产品要求保留在列表中并标注“预览”。
 */
export const CORE_VERSION_OPTIONS: CoreVersionOption[] = [
  { tag_name: 'v2.7.0', channel: 'prerelease' },
  { tag_name: BUILTIN_CORE_VERSION, channel: 'stable', builtin: true },
  { tag_name: 'v2.5.0', channel: 'prerelease' },
  { tag_name: 'v2.4.5', channel: 'stable' }
]

/** 兼容规则覆盖的最低/最高已知版本；超出范围时无法判断新增字段，走宽松回退 */
export const CORE_VERSION_BASELINE = 'v2.4.5'
export const CORE_VERSION_LATEST_KNOWN = 'v2.7.0'

/** v2.4.5 起全程存在的 flags（29 个） */
export const CORE_FLAG_BASELINE: readonly string[] = [
  'default_protocol',
  'dev_name',
  'enable_encryption',
  'enable_ipv6',
  'mtu',
  'latency_first',
  'enable_exit_node',
  'proxy_forward_by_system',
  'no_tun',
  'use_smoltcp',
  'relay_network_whitelist',
  'disable_p2p',
  'relay_all_peer_rpc',
  'disable_udp_hole_punching',
  'multi_thread',
  'data_compress_algo',
  'bind_device',
  'enable_kcp_proxy',
  'disable_kcp_input',
  'disable_relay_kcp',
  'enable_relay_foreign_network_kcp',
  'accept_dns',
  'private_mode',
  'enable_quic_proxy',
  'disable_quic_input',
  'foreign_relay_bps_limit',
  'multi_thread_count',
  'encryption_algorithm',
  'disable_sym_hole_punching'
]

/** flags 按版本新增（无移除） */
export const CORE_FLAG_ADDITIONS: ReadonlyArray<{ since: string; flags: readonly string[] }> = [
  {
    since: 'v2.5.0',
    flags: ['p2p_only', 'disable_tcp_hole_punching', 'quic_listen_port', 'tld_dns_zone']
  },
  {
    since: 'v2.6.0',
    flags: [
      'lazy_p2p',
      'disable_relay_quic',
      'enable_relay_foreign_network_quic',
      'need_p2p',
      'instance_recv_bps_limit'
    ]
  },
  { since: 'v2.6.2', flags: ['disable_upnp'] },
  { since: 'v2.6.3', flags: ['disable_relay_data'] },
  { since: 'v2.6.4', flags: ['enable_udp_broadcast_relay'] },
  { since: 'v2.7.0', flags: ['prefer_peer_relay', 'socket_mark'] }
]

/** 功能开关/字段的引入版本（用于表单显隐与启动前校验） */
export const CORE_FEATURE_MIN_VERSION = {
  secureMode: 'v2.6.0',
  ipv6PublicAddr: 'v2.6.2',
  configSource: 'v2.6.2',
  tcpStunServers: 'v2.7.0',
  managedCredentials: 'v2.7.0',
  vpnPortalClients: 'v2.7.0',
  credentialCli: 'v2.6.0',
  peerIpv6Cli: 'v2.6.2',
  aclSetCli: 'v2.7.0'
} as const

export type CoreFeature = keyof typeof CORE_FEATURE_MIN_VERSION

/** 顶层字段分组及引入版本：早于该版本会被内核静默忽略（不致命） */
export const CORE_TOP_LEVEL_FIELD_GROUPS: ReadonlyArray<{
  fields: readonly string[]
  since: string
}> = [
  { fields: ['secure_mode', 'credential_file'], since: 'v2.6.0' },
  {
    fields: [
      'ipv6_public_addr_provider',
      'ipv6_public_addr_auto',
      'ipv6_public_addr_prefix',
      'source'
    ],
    since: 'v2.6.2'
  },
  { fields: ['tcp_stun_servers', 'managed_credentials'], since: 'v2.7.0' }
]

/** 从某版本起配置文件中的该字段不再生效（需改走 CLI 参数） */
export const CORE_TOP_LEVEL_FIELD_REMOVED: ReadonlyArray<{
  fields: readonly string[]
  since: string
}> = [{ fields: ['rpc_portal', 'rpc_portal_whitelist'], since: 'v2.5.0' }]

/** v2.7.0 vpn_portal_config 的合法字段（启用 deny_unknown_fields） */
export const VPN_PORTAL_V2_FIELDS = [
  'enabled',
  'wireguard_listen',
  'wireguard_private_key',
  'clients'
] as const

/** v2.7.0 vpn_portal_config.clients 条目的合法字段 */
export const VPN_PORTAL_V2_CLIENT_FIELDS = ['name', 'virtual_ip', 'groups'] as const

/** v2.4.5 ~ v2.6.4 vpn_portal_config 的字段（旧结构宽松解析） */
export const VPN_PORTAL_LEGACY_FIELDS = ['client_cidr', 'wireguard_listen'] as const
