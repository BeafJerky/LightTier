/**
 * EasyTier 内核对外的运行时结构（全局声明）。
 *
 * 无 import/export，接口直接进入全局作用域，供 store / utils / 组件引用：
 * RPC 查询结果、TOML 配置、运行态记录与端口预检结果。
 */

/** 对等节点运行状态：来自 RPC 的 peer 表，监控页与拓扑直接消费 */
interface PeerInfo {
  cost: string
  hostname: string
  id: string
  ipv4: string
  lat_ms: string
  loss_rate: string
  nat_type: string
  rx_bytes: string
  tunnel_proto: string
  tx_bytes: string
  version: string
  delayColor: string
}

/** 网络标识：network_name + network_secret 决定组网会话，digest 为密钥摘要 */
interface NetworkIdentity {
  network_name: string
  network_secret: string
  network_secret_digest: string
}

/** 对端连接地址条目，uri 形如 tcp://1.2.3.4:11010 或 udp://域名:端口 */
interface PeerConfig {
  uri: string
}

/** 子网代理条目：把 cidr 网段经本节点共享给虚拟网络，allow 限定可访问来源 */
interface NetworkConfig {
  cidr: string
  allow: string[]
}

/** 文件日志配置：级别 / 文件名 / 目录 / 单文件大小 / 文件数量 */
interface FileLoggerConfig {
  level: string | null
  file: string | null
  dir: string | null
  size?: number // 单个日志文件大小，单位 MB，默认 100
  count?: number // 最大日志文件数量，默认 10
}

/** 控制台日志配置（仅级别；桌面端控制台输出写入服务日志） */
interface ConsoleLoggerConfig {
  level: string | null
}

/** WireGuard 门户配置：为移动端/第三方 WireGuard 客户端提供接入入口 */
interface VpnPortalConfig {
  client_cidr: string
  wireguard_listen: string
}

/** 内核功能开关，对应 TOML [flags]；缺省字段由内核取默认值 */
interface Flags {
  default_protocol: string
  dev_name: string
  enable_encryption: boolean
  encryption_algorithm?: string
  mtu?: number
  latency_first: boolean
  enable_exit_node: boolean
  no_tun: boolean
  use_smoltcp: boolean
  foreign_network_whitelist: string
  disable_p2p: boolean
  relay_all_peer_rpc: boolean
  disable_udp_hole_punching: boolean
  disable_tcp_hole_punching?: boolean
  disable_sym_hole_punching?: boolean
  multi_thread?: boolean
  multi_thread_count?: number
  disable_ipv6?: boolean
  enable_kcp_proxy?: boolean
  enable_quic_proxy?: boolean
  disable_quic_input?: boolean
  foreign_relay_bps_limit?: number
  instance_recv_bps_limit?: number
  p2p_only?: boolean
  lazy_p2p?: boolean
  need_p2p?: boolean
  disable_upnp?: boolean
  no_listener?: boolean
  ipv6_public_addr_provider?: boolean
  ipv6_public_addr_auto?: boolean
  ipv6_public_addr_prefix?: string
  enable_udp_broadcast_relay?: boolean
  disable_relay_kcp?: boolean
  disable_relay_quic?: boolean
  enable_relay_foreign_network_kcp?: boolean
  enable_relay_foreign_network_quic?: boolean
  tld_dns_zone?: string
  ipv6_listener: string
}

/** 安全模式配置（顶层 [secure_mode] 表，EasyTier Core v2.6.4+） */
interface SecureModeConfig {
  enabled: boolean
  local_private_key?: string // base64(X25519 私钥)
  local_public_key?: string // base64(X25519 公钥)
}

/**
 * LightTier 私有元数据（TOML [lighttier] 表）
 * 官方内核忽略未知顶层表；禁止把应用私有字段写入 [flags]（v2.7.0+ 未知键会拒绝启动）
 */
interface LightTierConfig {
  exit_route_enabled?: boolean // 启动后由 LightTier 接管退出节点流量（改写系统默认路由）
}

/**
 * EasyTier 实例完整配置（与 .toml 字段语义一致）
 *
 * 用 type 别名而非 interface：对象类型别名自带隐式索引签名，
 * 可直接传给以 Record<string, any> 接收的配置工具，无需逐处断言。
 */
type EasyTierConfig = {
  netns: string
  hostname: string
  instance_name: string
  instance_id: string
  machine_id?: string
  ipv4: string
  ipv6?: string
  dhcp: boolean
  network_identity: NetworkIdentity
  listeners: string
  exit_nodes: string[]
  external_node?: string
  /** @deprecated 仅迁移时读取；新数据写入 [lighttier] */
  config_exit_nodes_route?: boolean
  /** 本应用私有表，官方内核忽略 */
  lighttier?: LightTierConfig
  clear_log_on_run?: boolean
  peer: PeerConfig[]
  proxy_network: NetworkConfig[]
  file_logger: FileLoggerConfig
  console_logger: ConsoleLoggerConfig
  rpc_portal: string
  rpc_portal_whitelist?: string[]
  vpn_portal_config: VpnPortalConfig
  routes: string[]
  socks5_proxy: string
  secure_mode?: SecureModeConfig
  credential_file?: string
  tcp_whitelist?: string[]
  udp_whitelist?: string[]
  stun_servers?: string[]
  stun_servers_v6?: string[]
  flags: Flags
}

/** 内核实例运行记录：configFileName 为主键，随 store 持久化（PID 恢复时清空） */
interface RunningItem {
  configFileName: string
  fileName?: string
  pid?: number
  rpcPortal?: string // 进程命令行中解析出的实际端口
  serviceStatus?: string
  installMethod?: 'nssm' | 'official' | 'none'
  instanceId?: string // Android 进程内实例 id
  virtualIp?: string // Android 虚拟 IPv4（不含掩码）
}

/** 端口冲突检测结果（启动前预检监听/RPC 端口占用） */
interface PortConflict {
  port: number
  conflictConfig: string // 正在占用该端口的运行中配置文件名（含 .toml 后缀）
}
