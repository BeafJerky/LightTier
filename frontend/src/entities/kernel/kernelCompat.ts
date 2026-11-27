/**
 * EasyTier 内核版本兼容注册表（配置字段 / flags / CLI 差异的唯一事实来源）
 *
 * 维护依据：doc/design/EasyTier-各版本配置字段与CLI对照.md
 * - flags 基线 v2.4.5 29 个，后续版本只增不减（v2.7.1 累计 46 个）
 * - v2.7.0 起未知 flags 键会导致内核解析失败（旧版本静默忽略）
 * - v2.7.0 重构 vpn_portal_config 并启用 deny_unknown_fields
 * - v2.7.0 起 service install 的 core 参数由位置参数改为 --core-args
 * - v2.7.1 新增顶层 dns / dhcpv6 字段与 3 个 UDP FEC flags；dhcp 兼容布尔值或 CIDR 字符串
 * - 已按上游源码复核（v2.4.5 ~ v2.7.1）：
 *   · socks5 服务端是顶层 socks5_proxy（URL，如 socks5://0.0.0.0:1080）；flags 无 socks5 键
 *   · port_forward 为单数 TOML 键（数组），不是 port_forwards
 *   · acl（acl_v1 / group 单数）结构与字段跨版本一致，无需版本门控
 *   · listeners/peer 的 wg:// 路径按 bind 设备名处理；CIDR 形式只属于旧版 --vpn-portal 与 vpn_portal_config
 *
 * 版本列表固定：新增/移除可下载版本时只改 CORE_VERSION_OPTIONS，
 * 字段差异通过「引入版本」表推导，避免为每个版本复制一份完整清单。
 */
export type CoreChannel = 'stable' | 'prerelease'

export interface CoreVersionOption {
  tag_name: string
  channel: CoreChannel
}

/**
 * 设置页固定版本列表（仅官方发布过的版本）
 * v2.5.0 / v2.7.1 官方标记为 pre-release，但按产品要求保留在列表中并标注“预览”。
 * 桌面安装包不再内置任何版本，全部按需下载安装。
 */
export const CORE_VERSION_OPTIONS: CoreVersionOption[] = [
  { tag_name: 'v2.7.1', channel: 'prerelease' },
  { tag_name: 'v2.6.4', channel: 'stable' },
  { tag_name: 'v2.5.0', channel: 'prerelease' },
  { tag_name: 'v2.4.5', channel: 'stable' }
]

/** 未检测到已安装内核时的默认下载版本：列表中最新的正式版 */
export const DEFAULT_CORE_VERSION =
  CORE_VERSION_OPTIONS.find((o) => o.channel === 'stable')?.tag_name ??
  CORE_VERSION_OPTIONS[0].tag_name

/** 兼容规则覆盖的最低/最高已知版本；超出范围时无法判断新增字段，走宽松回退 */
export const CORE_VERSION_BASELINE = 'v2.4.5'
export const CORE_VERSION_LATEST_KNOWN = 'v2.7.1'

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
  { since: 'v2.7.0', flags: ['prefer_peer_relay', 'socket_mark'] },
  { since: 'v2.7.1', flags: ['enable_udp_fec', 'enable_udp_fec_kcp', 'enable_udp_fec_quic'] }
]

/**
 * 顶层字段基线（v2.4.5 起全程存在，26 个）
 * 上游已复核：Config 无 deny_unknown_fields；rpc_portal / rpc_portal_whitelist 自 v2.5.0 移除；
 * vpn_portal_config 形态差异由 CoreCapabilities.vpnPortalFormat 判定；dhcp 的 CIDR 形态由 v2.7.1 规则判定。
 */
export const CORE_TOP_LEVEL_FIELD_BASELINE: readonly string[] = [
  'netns',
  'hostname',
  'instance_name',
  'instance_id',
  'ipv4',
  'ipv6',
  'dhcp',
  'network_identity',
  'listeners',
  'mapped_listeners',
  'exit_nodes',
  'peer',
  'proxy_network',
  'vpn_portal_config',
  'routes',
  'socks5_proxy',
  'port_forward',
  'flags',
  'flags_struct',
  'acl',
  'tcp_whitelist',
  'udp_whitelist',
  'stun_servers',
  'stun_servers_v6',
  'rpc_portal',
  'rpc_portal_whitelist'
]

/** 功能开关/字段的引入版本（用于表单显隐与启动前校验） */
export const CORE_FEATURE_MIN_VERSION = {
  secureMode: 'v2.6.0',
  // PeerConfig.peer_public_key（v2.6.0+；compat 检查见 kernelCompatUtil）
  peerPublicKey: 'v2.6.0',
  ipv6PublicAddr: 'v2.6.2',
  configSource: 'v2.6.2',
  tcpStunServers: 'v2.7.0',
  managedCredentials: 'v2.7.0',
  vpnPortalClients: 'v2.7.0',
  credentialCli: 'v2.6.0',
  peerIpv6Cli: 'v2.6.2',
  aclSetCli: 'v2.7.0',
  // v2.7.1：dhcp 支持网段写法、Magic DNS 与 DHCPv6 顶层字段、UDP FEC 与 LZO 压缩
  dhcpCidr: 'v2.7.1',
  magicDns: 'v2.7.1',
  dhcpv6: 'v2.7.1',
  udpFec: 'v2.7.1',
  compressLzo: 'v2.7.1'
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
  { fields: ['tcp_stun_servers', 'managed_credentials'], since: 'v2.7.0' },
  // v2.7.1：Magic DNS 与 IPv6 自动分配；旧内核会静默忽略这两个顶层字段
  { fields: ['dns', 'dhcpv6'], since: 'v2.7.1' }
]

/** 从某版本起配置文件中的该字段不再生效（需改走 CLI 参数） */
export const CORE_TOP_LEVEL_FIELD_REMOVED: ReadonlyArray<{
  fields: readonly string[]
  since: string
}> = [{ fields: ['rpc_portal', 'rpc_portal_whitelist'], since: 'v2.5.0' }]

/** 表单门控约定：WireGuard 门户新旧结构用 CoreCapabilities.vpnPortalFormat 判断，不要另建版本常量 */
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
