/**
 * EasyTier 内核相关类型定义（全局声明）
 *
 * 本文件无 import/export，接口直接进入全局作用域，供 store / utils / 组件直接引用：
 * - EasyTierConfig：内核实例完整配置（与 .toml 字段语义一致）
 * - RunningItem / RunningWebItem：运行态记录（持久化到 localStorage）
 * - SysInfo / GithubVer：系统信息与 GitHub Release 元数据
 */

/** 节点（peer）运行状态：由 RPC 查询获得，供监控页表格与拓扑展示 */
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

/** 内核功能开关集合（对应 .toml 的 [flags] 段） */
interface Flags {
  default_protocol: string
  dev_name: string
  enable_encryption: boolean
  encryption_algorithm?: string // 加密算法
  mtu?: number // MTU 大小
  latency_first: boolean
  enable_exit_node: boolean
  no_tun: boolean
  use_smoltcp: boolean
  foreign_network_whitelist: string
  disable_p2p: boolean
  relay_all_peer_rpc: boolean
  disable_udp_hole_punching: boolean
  disable_tcp_hole_punching?: boolean // 禁用 TCP 打洞
  disable_sym_hole_punching?: boolean // 禁用对称 NAT 打洞
  multi_thread?: boolean // 多线程
  multi_thread_count?: number // 线程数
  disable_ipv6?: boolean // 禁用 IPv6
  enable_kcp_proxy?: boolean // 启用 KCP 代理
  enable_quic_proxy?: boolean // 启用 QUIC 代理
  disable_quic_input?: boolean // 禁用 QUIC 输入
  foreign_relay_bps_limit?: number // 外部中继带宽限制
  instance_recv_bps_limit?: number // 实例入站带宽限制
  p2p_only?: boolean // 仅 P2P
  lazy_p2p?: boolean // 按需建立 P2P
  need_p2p?: boolean // 声明需要主动 P2P
  disable_upnp?: boolean // 禁用 UPnP/NAT-PMP 映射
  no_listener?: boolean // 不监听任何端口
  ipv6_public_addr_provider?: boolean // 共享公网 IPv6 子网
  ipv6_public_addr_auto?: boolean // 自动获取公网 IPv6 地址
  ipv6_public_addr_prefix?: string // 手动指定公网 IPv6 子网
  enable_udp_broadcast_relay?: boolean // 启用 UDP 广播中继
  disable_relay_kcp?: boolean // 禁止转发 KCP 数据包
  disable_relay_quic?: boolean // 禁止转发 QUIC 数据包
  enable_relay_foreign_network_kcp?: boolean // 允许转发外部网络 KCP
  enable_relay_foreign_network_quic?: boolean // 允许转发外部网络 QUIC
  tld_dns_zone?: string // TLD DNS 区域
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

/** EasyTier 实例完整配置：flags 为平铺兼容字段，flags_struct 为结构化形式 */
interface EasyTierConfig {
  netns: string
  hostname: string
  instance_name: string
  instance_id: string
  machine_id?: string // 机器 ID
  ipv4: string
  ipv6?: string // IPv6 地址
  dhcp: boolean
  network_identity: NetworkIdentity
  listeners: string
  exit_nodes: string[]
  external_node?: string // 外部节点
  /** @deprecated 旧版 LightTier 退出路由标记，仅兼容读取，迁移后写入 [lighttier] */
  config_exit_nodes_route?: boolean
  /** LightTier 私有元数据（官方内核忽略） */
  lighttier?: LightTierConfig
  clear_log_on_run?: boolean
  peer: PeerConfig[]
  proxy_network: NetworkConfig[]
  file_logger: FileLoggerConfig
  console_logger: ConsoleLoggerConfig
  rpc_portal: string
  rpc_portal_whitelist?: string[] // RPC 门户白名单
  vpn_portal_config: VpnPortalConfig
  routes: string[]
  socks5_proxy: string
  secure_mode?: SecureModeConfig // 安全模式配置（[secure_mode] 表）
  credential_file?: string // 凭据存储文件路径（顶层）
  tcp_whitelist?: string // TCP 白名单
  udp_whitelist?: string // UDP 白名单
  stun_server: string[] // STUN 服务器列表（保留兼容）
  stun_servers?: string[] // STUN 服务器列表
  stun_servers_v6?: string[] // IPv6 STUN 服务器列表
  flags: Flags
  flags_struct: Flags
}

/** 当前系统信息：用于拼接内核压缩包下载文件名（easytier-<osType>-<osArch>-<version>.zip） */
interface SysInfo {
  osType: string
  osArch: string
  osVersion: string
}

/** GitHub Release 元数据条目：供内核版本列表与更新检查使用 */
interface GithubVer {
  id: number
  tag_name: string
  name: string
  prerelease: boolean
  draft?: boolean
  created_at: string
  published_at: string
}

/** 运行中的内核实例记录：configFileName 为主键，持久化到 localStorage.runningList */
interface RunningItem {
  configFileName: string
  fileName?: string
  pid?: number
  rpcPortal?: string // 从进程命令行提取的实际 RPC 端口
  serviceStatus?: string
  installMethod?: 'nssm' | 'official' | 'none' // 服务安装方式
  instanceId?: string // Android：进程内内核实例 id
  virtualIp?: string // Android：虚拟 IPv4 地址（不含掩码）
}

/** 端口冲突检测结果（启动前预检监听/RPC 端口占用） */
interface PortConflict {
  port: number
  conflictConfig: string // 正在占用该端口的运行中配置文件名（含 .toml 后缀）
}

/** 运行中的 Web 配置服务记录：protocol/host/port 为监听信息，status 为服务状态文案 */
interface RunningWebItem {
  protocol: string
  host: string
  port: number
  userName: string
  webStartMethod: number
  configFileName: string
  status: string
}
