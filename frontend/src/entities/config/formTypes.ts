/**
 * 配置编辑表单的数据形态。
 *
 * 与 types/easyTier.ts（内核回传的运行时结构）不同：这里描述「正在编辑、尚未落盘」的状态，
 * 字段普遍可空，方便 v-model 绑定；提交时由 configFormUtil 校验并序列化为 TOML。
 */

/** 网络身份；secret 为空表示沿用当前密钥 */
interface NetworkIdentityInput {
  network_name: string
  network_secret: string
}

/** 对端连接地址 */
interface PeerInput {
  uri: string
}

/** 子网代理 */
interface ProxyNetworkInput {
  cidr: string
}

interface ConsoleLoggerInput {
  level: string
}

/** 文件日志；null 用于显式清空内核默认值，undefined 表示沿用默认 */
interface FileLoggerInput {
  level?: string | undefined
  file?: string | undefined | null
  dir?: string | undefined | null
  size?: number | undefined
  count?: number | undefined
}

/**
 * 内核功能开关，对应 TOML [flags]。
 * 可选字段表示「不下发，由内核决定」，与显式 false 语义不同。
 */
interface FlagsInput {
  default_protocol: string
  dev_name: string
  data_compress_algo: string
  enable_encryption: boolean
  encryption_algorithm?: string | undefined // xor / chacha20 / aes-gcm / aes-256-gcm
  enable_ipv6: boolean
  disable_ipv6?: boolean | undefined // 与 enable_ipv6 互斥，显式关闭双栈
  latency_first: boolean
  enable_exit_node: boolean
  mtu?: number | undefined // 链路 MTU
  no_tun: boolean
  use_smoltcp: boolean
  disable_p2p: boolean
  disable_udp_hole_punching: boolean
  disable_tcp_hole_punching?: boolean | undefined // 关闭 TCP 打洞
  disable_sym_hole_punching?: boolean | undefined // 关闭对称 NAT 打洞
  multi_thread: boolean
  multi_thread_count?: number | undefined // 工作线程数
  relay_all_peer_rpc: boolean
  ipv6_listener: string
  socks5?: string | undefined
  relay_network_whitelist?: string | undefined
  bind_device: boolean
  disable_kcp_input: boolean
  enable_kcp_proxy: boolean
  enable_quic_proxy?: boolean | undefined // 以 QUIC 承载代理流量
  disable_quic_input?: boolean | undefined // 不接受 QUIC 入站
  accept_dns: boolean
  private_mode: boolean
  proxy_forward_by_system: boolean
  foreign_relay_bps_limit?: number | undefined // 外部中继限速（bps）
  instance_recv_bps_limit?: number | undefined // 本实例入站限速（bps）
  p2p_only?: boolean | undefined // 只走 P2P，不使用中继
  lazy_p2p?: boolean | undefined // 有流量时才建立 P2P
  need_p2p?: boolean | undefined // 声明本节点需要主动 P2P
  disable_upnp?: boolean | undefined // 关闭 UPnP / NAT-PMP 自动映射
  no_listener?: boolean | undefined // 不开放任何监听端口
  ipv6_public_addr_provider?: boolean | undefined // 对外共享 IPv6 子网
  ipv6_public_addr_auto?: boolean | undefined // 自动发现公网 IPv6
  ipv6_public_addr_prefix?: string | undefined // 指定要共享的 IPv6 前缀
  enable_udp_broadcast_relay?: boolean | undefined // 转发 UDP 广播
  disable_relay_kcp?: boolean | undefined // 不中继 KCP
  disable_relay_quic?: boolean | undefined // 不中继 QUIC
  disable_relay_data?: boolean | undefined // 不中继业务数据（v2.6.3+）
  prefer_peer_relay?: boolean | undefined // 优先对等中继（v2.7.0+）
  enable_relay_foreign_network_kcp?: boolean | undefined // 允许中继外网 KCP
  enable_relay_foreign_network_quic?: boolean | undefined // 允许中继外网 QUIC
  tld_dns_zone?: string | undefined // 自定义 TLD DNS 域
}

/** 安全模式配置（TOML 的 [secure_mode] 表，EasyTier Core v2.6.4+） */
interface SecureModeConfigInput {
  enabled?: boolean
  local_private_key?: string // base64(X25519 私钥)，留空则内核启动时随机生成
  local_public_key?: string // base64(X25519 公钥)，通常由私钥派生
}

/** 配置编辑表单主数据结构（EditDialog / WebConfigForm 双向绑定的数据源） */
export interface EasyTierFormData {
  hostname?: string | undefined | null
  instance_name?: string | undefined
  machine_id?: string | undefined // Web 配置服务器识别用
  network_identity: Partial<NetworkIdentityInput> | undefined
  dhcp?: boolean | undefined
  ipv4?: string | undefined
  ipv6?: string | undefined
  peer: Partial<PeerInput>[] | undefined | null
  listeners: any[]
  routes: any[] | undefined
  mapped_listeners: any[]
  proxy_network: Partial<ProxyNetworkInput>[] | undefined | null
  exit_nodes: any[] | undefined
  external_node?: string | undefined // 公共共享节点地址
  /** @deprecated 旧版退出路由标记，仅迁移时读取；新数据写入 [lighttier] */
  config_exit_nodes_route?: any | undefined
  /** TOML [lighttier] 表：本应用私有元数据 */
  lighttier?: LightTierConfig | undefined
  rpc_portal: string
  rpc_portal_whitelist?: string[] | undefined
  socks5_proxy?: string | undefined
  secure_mode?: SecureModeConfigInput | undefined
  credential_file?: string | undefined
  tcp_whitelist?: string[] | undefined
  udp_whitelist?: string[] | undefined
  stun_servers?: string[] | undefined
  stun_servers_v6?: string[] | undefined // IPv6 STUN 列表
  console_logger: Partial<ConsoleLoggerInput> | any
  file_logger: Partial<FileLoggerInput>
  vpn_portal_config: Record<string, any> | undefined
  port_forward: { bind_addr: string; dst_addr: string; proto: string }[]
  flags: Partial<FlagsInput>
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

/** 安装 Windows 服务的参数（nssm 与内核官方服务共用） */
export interface ServiceInstallConfig {
  installMethod: 'nssm' | 'official'
  description?: string
  displayName?: string
  enableAutostart: boolean
  username: string
  password: string
}
