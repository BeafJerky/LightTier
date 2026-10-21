/**
 * 表单数据类型定义
 *
 * 与 types/easyTier.ts（内核运行时类型）区分：本文件描述「编辑表单」的数据形态，
 * 字段普遍可选且允许 undefined（避免 v-model 空值告警），提交时经
 * easyTierUtil 校验 / 转换为内核 .toml 配置。
 */

/** 网络标识（表单态，secret 可为空表示未修改） */
interface NetworkIdentity {
  network_name: string
  network_secret: string
}

/** 对端连接地址条目（表单态） */
interface Peer {
  uri: string
}

/** 子网代理条目（表单态，仅保留 cidr 输入） */
interface ProxyNetwork {
  cidr: string
}

/** 控制台日志（表单态） */
interface ConsoleLogger {
  level: string
}

/** 文件日志（表单态，同名中的 null 表示清空内核默认值） */
interface FileLogger {
  level?: string | undefined
  file?: string | undefined | null
  dir?: string | undefined | null
  size?: number | undefined
  count?: number | undefined
}

/** 内核功能开关（表单态）：字段与 .toml [flags] 对应，可选字段表示「交由内核默认值决定」 */
interface Flags {
  default_protocol: string
  dev_name: string
  data_compress_algo: string
  enable_encryption: boolean
  encryption_algorithm?: string | undefined // 加密算法：xor, chacha20, aes-gcm, aes-256-gcm
  enable_ipv6: boolean
  disable_ipv6?: boolean | undefined // 禁用 IPv6
  latency_first: boolean
  enable_exit_node: boolean
  mtu?: number | undefined // MTU 大小
  no_tun: boolean
  use_smoltcp: boolean
  disable_p2p: boolean
  disable_udp_hole_punching: boolean
  disable_tcp_hole_punching?: boolean | undefined // 禁用 TCP 打洞
  disable_sym_hole_punching?: boolean | undefined // 禁用对称 NAT 打洞
  multi_thread: boolean
  multi_thread_count?: number | undefined // 线程数，默认 2
  relay_all_peer_rpc: boolean
  ipv6_listener: string
  socks5?: string | undefined
  relay_network_whitelist?: string | undefined
  bind_device: boolean
  disable_kcp_input: boolean
  enable_kcp_proxy: boolean
  enable_quic_proxy?: boolean | undefined // 启用 QUIC 代理
  disable_quic_input?: boolean | undefined // 禁用 QUIC 输入
  accept_dns: boolean
  private_mode: boolean
  proxy_forward_by_system: boolean
  foreign_relay_bps_limit?: number | undefined // 外部中继带宽限制
  instance_recv_bps_limit?: number | undefined // 实例入站带宽限制
  p2p_only?: boolean | undefined // 仅 P2P
  lazy_p2p?: boolean | undefined // 按需建立 P2P
  need_p2p?: boolean | undefined // 声明需要主动 P2P
  disable_upnp?: boolean | undefined // 禁用 UPnP/NAT-PMP 映射
  no_listener?: boolean | undefined // 不监听任何端口
  ipv6_public_addr_provider?: boolean | undefined // 共享公网 IPv6 子网
  ipv6_public_addr_auto?: boolean | undefined // 自动获取公网 IPv6 地址
  ipv6_public_addr_prefix?: string | undefined // 手动指定公网 IPv6 子网
  enable_udp_broadcast_relay?: boolean | undefined // 启用 UDP 广播中继
  disable_relay_kcp?: boolean | undefined // 禁止转发 KCP 数据包
  disable_relay_quic?: boolean | undefined // 禁止转发 QUIC 数据包
  disable_relay_data?: boolean | undefined // 禁止转发数据包（v2.6.3+）
  prefer_peer_relay?: boolean | undefined // 优先 Peer 中继（v2.7.0+）
  enable_relay_foreign_network_kcp?: boolean | undefined // 允许转发外部网络 KCP
  enable_relay_foreign_network_quic?: boolean | undefined // 允许转发外部网络 QUIC
  tld_dns_zone?: string | undefined // TLD DNS 区域
}

/** 安全模式配置（TOML 的 [secure_mode] 表，EasyTier Core v2.6.4+） */
export interface SecureModeConfig {
  enabled?: boolean
  local_private_key?: string // base64(X25519 私钥)，留空则内核启动时随机生成
  local_public_key?: string // base64(X25519 公钥)，通常由私钥派生
}

/** 配置编辑表单主数据结构（EditDialog / WebConfigForm 双向绑定的数据源） */
export interface EasyTierFormData {
  hostname?: string | undefined | null
  instance_name?: string | undefined
  machine_id?: string | undefined // 机器 ID，用于 Web 配置服务器识别
  network_identity: Partial<NetworkIdentity> | undefined
  dhcp?: boolean | undefined
  ipv4?: string | undefined
  ipv6?: string | undefined // IPv6 地址
  peer: Partial<Peer>[] | undefined | null
  listeners: any[]
  routes: any[] | undefined
  mapped_listeners: any[]
  proxy_network: Partial<ProxyNetwork>[] | undefined | null
  exit_nodes: any[] | undefined
  external_node?: string | undefined // 外部节点（公共共享节点）
  /** @deprecated 旧版 LightTier 退出路由标记，仅兼容读取，迁移后写入 [lighttier] */
  config_exit_nodes_route?: any | undefined
  /** LightTier 私有元数据（TOML [lighttier] 表，官方内核忽略） */
  lighttier?: LightTierConfig | undefined
  rpc_portal: string
  rpc_portal_whitelist?: string[] | undefined // RPC 门户白名单
  socks5_proxy?: string | undefined // SOCKS5 代理（顶层）
  secure_mode?: SecureModeConfig | undefined // 安全模式（[secure_mode] 表）
  credential_file?: string | undefined // 凭据存储文件路径（顶层）
  tcp_whitelist?: string | undefined // TCP 白名单
  udp_whitelist?: string | undefined // UDP 白名单
  stun_servers?: string[] | undefined // STUN 服务器列表
  stun_servers_v6?: string[] | undefined // IPv6 STUN 服务器列表
  console_logger: Partial<ConsoleLogger> | any
  file_logger: Partial<FileLogger>
  vpn_portal_config: Partial<VpnPortalConfig> | any
  port_forward: { bind_addr: string; dst_addr: string; proto: string }[]
  flags: Partial<Flags>
}

/** Web 配置（config-server）连接表单：webStartMethod 区分直启 / 注册为服务等启动方式 */
export interface FormWebData {
  protocol: Partial<string> | undefined
  host: Partial<string> | undefined
  port: Partial<number> | undefined
  userName: string
  webStartMethod: Partial<number>
  configFileName: string
  webUrl: Partial<string> | undefined
  status?: Partial<string> | undefined
  pid?: Partial<number> | undefined
}

/** Windows 服务安装配置（nssm 或内核官方服务方式） */
export interface ServiceInstallConfig {
  installMethod: 'nssm' | 'official' // 安装方式
  description?: string // 服务描述
  displayName?: string // 显示名称
  enableAutostart: boolean // 是否开机自启
  username: string // 用户名
  password: string // 密码
}
