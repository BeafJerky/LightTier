# EasyTier 各版本配置文件字段与 CLI 对照（v2.4.5 → v2.7.0）

> 生成时间：2026-10-09
> 数据来源：EasyTier 官方仓库 v2.4.5 ~ v2.7.0 各 tag 源码**逐版本提取**（clap 参数定义、serde 配置结构、locales/app.yml 帮助文案），非转抄 Release Notes
> 覆盖版本：v2.4.5、v2.5.0、v2.6.0、v2.6.1、v2.6.2、v2.6.3、v2.6.4、v2.7.0（共 8 个）
> 关联文档：`doc/design/EasyTier-v2.7.0-升级适配方案.md`（LightTier 适配视角，本文件为字段/命令的完整底账）
> 状态：已完成（关键计数经源码复核）

---

## 1. 说明

### 1.1 版本范围与发布信息

| 版本 | 发布时间 | 渠道标记 | 备注 |
| --- | --- | --- | --- |
| v2.4.5 | 2025-09-26 | Stable | 本文基线版本 |
| v2.5.0 | 2026-01-01 | Pre-release | TOML 移除 `rpc_portal`（改由 CLI 传入）；新增 daemon/config-dir 等 |
| v2.6.0 | 2026-04-06 | Pre-release | 引入安全模式与凭据（Credential）体系 |
| v2.6.1 | 2026-04-19 | Pre-release | 无字段/参数/命令变化 |
| v2.6.2 | 2026-04-26 | Pre-release | IPv6 公网地址共享、配置来源标记 |
| v2.6.3 | 2026-05-02 | Pre-release | flags +1 |
| v2.6.4 | 2026-05-12 | Stable | LightTier 当前内置内核 |
| v2.7.0 | 2026-10-06 | Pre-release | WireGuard 入口重构、受管凭据、SO_MARK |

> 官方将 v2.5.0、v2.6.0~v2.6.3 与 v2.7.0 标记为 Pre-release，但均为主线发布且被 LightTier 使用链覆盖（内置 v2.6.4），全部纳入对照。

### 1.2 数据来源：源码路径映射

| 内容 | v2.4.5 ~ v2.6.4 | v2.7.0 |
| --- | --- | --- |
| TOML 配置结构 | `easytier/src/common/config.rs` | `easytier-core/src/config/toml.rs`（配置拆分为 config/ 模块，部分类型迁至 `config/gateway.rs` 等） |
| easytier-core 参数 | `easytier/src/easytier-core.rs` | `easytier/src/core.rs`（v2.5.0 起） |
| easytier-cli 命令 | `easytier/src/easytier-cli.rs` | 同左（v2.7.0 二进制仍在 `easytier` crate） |
| 帮助文案（i18n） | `easytier/locales/app.yml` | 同左 |

### 1.3 阅读约定

- 「全版本」= v2.4.5 ~ v2.7.0 八个版本均存在；「vX.Y.Z+」= 从该版本起（含之后所有版本）
- 类型保留 Rust 源码写法（`Option<...>`、`Vec<...>` 等）
- 计数口径：**core 参数**不含 `-h/--help/-V/--version` 内置项；**cli 一级命令**含隐藏命令 `GenAutocomplete`
- 帮助文案：正文仅保留关键信息；完整命令树（含 about 与默认值）见附录 A（v2.6.4）与附录 B（v2.7.0）

---

## 2. 版本总览

| 版本 | Config 顶层字段 | flags | core 参数 | cli 一级命令 | cli 二级命令 |
| --- | --- | --- | --- | --- | --- |
| v2.4.5 | 26 | 29 | 63 | 16 | 33 |
| v2.5.0 | 24 | 33 | 70 | 16 | 33 |
| v2.6.0 | 26 | 38 | 79 | 17 | 34 |
| v2.6.1 | 26 | 38 | 79 | 17 | 34 |
| v2.6.2 | 30 | 39 | 83 | 17 | 35 |
| v2.6.3 | 30 | 40 | 83 | 17 | 35 |
| v2.6.4 | 30 | 41 | 84 | 17 | 35 |
| v2.7.0 | 32 | 43 | 89 | 17 | 39 |

变化节点速览：

- **v2.5.0**：Config −2（rpc_portal 系）、flags +4、core 参数 +7
- **v2.6.0**：Config +2、flags +5、core 参数 +10/−1、cli 新增 Credential 命令组（移除 peer add/remove）
- **v2.6.1**：无任何变化（仅补丁级）
- **v2.6.2**：Config +4、flags +1、core 参数 +4、cli +peer ipv6
- **v2.6.3**：flags +1；**v2.6.4**：flags +1、core 参数 +1
- **v2.7.0**：Config +2（且 `vpn_portal_config` 结构重构）、flags +2、core 参数 +5、cli +4 个二级命令

---

## 3. 配置文件（TOML）字段

### 3.1 顶层 Config 字段（34 个，含版本范围）

> 每个字段的类型在 8 个版本间保持一致；「可用版本」标注引入/移除节点。

| 字段 | 类型 | 可用版本 |
| --- | --- | --- |
| netns | Option&lt;String&gt; | 全版本 |
| hostname | Option&lt;String&gt; | 全版本 |
| instance_name | Option&lt;String&gt; | 全版本 |
| instance_id | Option&lt;uuid::Uuid&gt; | 全版本 |
| ipv4 | Option&lt;String&gt; | 全版本 |
| ipv6 | Option&lt;String&gt; | 全版本 |
| dhcp | Option&lt;bool&gt; | 全版本 |
| network_identity | Option&lt;NetworkIdentity&gt; | 全版本 |
| listeners | Option&lt;Vec&lt;url::Url&gt;&gt; | 全版本 |
| mapped_listeners | Option&lt;Vec&lt;url::Url&gt;&gt; | 全版本 |
| exit_nodes | Option&lt;Vec&lt;IpAddr&gt;&gt; | 全版本 |
| peer | Option&lt;Vec&lt;PeerConfig&gt;&gt; | 全版本 |
| proxy_network | Option&lt;Vec&lt;ProxyNetworkConfig&gt;&gt; | 全版本 |
| vpn_portal_config | Option&lt;VpnPortalConfig&gt; | 全版本（v2.7.0 结构重构，见 3.4） |
| routes | Option&lt;Vec&lt;cidr::Ipv4Cidr&gt;&gt; | 全版本 |
| socks5_proxy | Option&lt;url::Url&gt; | 全版本 |
| port_forward | Option&lt;Vec&lt;PortForwardConfig&gt;&gt; | 全版本 |
| flags | Option&lt;serde_json::Map&lt;String, serde_json::Value&gt;&gt; | 全版本 |
| flags_struct | Option&lt;Flags&gt; | 全版本 |
| acl | Option&lt;Acl&gt; | 全版本 |
| tcp_whitelist | Option&lt;Vec&lt;String&gt;&gt; | 全版本 |
| udp_whitelist | Option&lt;Vec&lt;String&gt;&gt; | 全版本 |
| stun_servers | Option&lt;Vec&lt;String&gt;&gt; | 全版本 |
| stun_servers_v6 | Option&lt;Vec&lt;String&gt;&gt; | 全版本 |
| rpc_portal | Option&lt;SocketAddr&gt; | 仅 v2.4.5（v2.5.0 起移除，改由 CLI `--rpc-portal` 传入） |
| rpc_portal_whitelist | Option&lt;Vec&lt;IpCidr&gt;&gt; | 仅 v2.4.5（同上，改用 CLI `--rpc-portal-whitelist`） |
| secure_mode | Option&lt;SecureModeConfig&gt; | v2.6.0+ |
| credential_file | Option&lt;PathBuf&gt; | v2.6.0+ |
| ipv6_public_addr_provider | Option&lt;bool&gt; | v2.6.2+ |
| ipv6_public_addr_auto | Option&lt;bool&gt; | v2.6.2+ |
| ipv6_public_addr_prefix | Option&lt;String&gt; | v2.6.2+ |
| source | Option&lt;ConfigSourceConfig&gt; | v2.6.2+ |
| tcp_stun_servers | Option&lt;Vec&lt;String&gt;&gt; | v2.7.0 |
| managed_credentials | Vec&lt;ManagedCredentialConfig&gt; | v2.7.0 |

### 3.2 顶层字段逐版本变化

| 版本 | 变化 | 合计 |
| --- | --- | --- |
| v2.4.5 | 基线 26 个 | 26 |
| v2.5.0 | −`rpc_portal`、−`rpc_portal_whitelist` | 24 |
| v2.6.0 | +`secure_mode`、+`credential_file` | 26 |
| v2.6.1 | 无变化 | 26 |
| v2.6.2 | +`ipv6_public_addr_provider`、+`ipv6_public_addr_auto`、+`ipv6_public_addr_prefix`、+`source` | 30 |
| v2.6.3 | 无变化 | 30 |
| v2.6.4 | 无变化 | 30 |
| v2.7.0 | +`tcp_stun_servers`、+`managed_credentials` | 32 |

### 3.3 flags 字段

**基线（v2.4.5 起全版本存在，29 个）**：

```
default_protocol, dev_name, enable_encryption, enable_ipv6, mtu, latency_first,
enable_exit_node, proxy_forward_by_system, no_tun, use_smoltcp, relay_network_whitelist,
disable_p2p, relay_all_peer_rpc, disable_udp_hole_punching, multi_thread,
data_compress_algo, bind_device, enable_kcp_proxy, disable_kcp_input, disable_relay_kcp,
enable_relay_foreign_network_kcp, accept_dns, private_mode, enable_quic_proxy,
disable_quic_input, foreign_relay_bps_limit, multi_thread_count, encryption_algorithm,
disable_sym_hole_punching
```

**按版本新增（无任何移除）**：

| 版本 | 新增 flags | 累计 |
| --- | --- | --- |
| v2.5.0 | p2p_only、disable_tcp_hole_punching、quic_listen_port、tld_dns_zone | 33 |
| v2.6.0 | lazy_p2p、disable_relay_quic、enable_relay_foreign_network_quic、need_p2p、instance_recv_bps_limit | 38 |
| v2.6.1 | 无变化 | 38 |
| v2.6.2 | disable_upnp | 39 |
| v2.6.3 | disable_relay_data | 40 |
| v2.6.4 | enable_udp_broadcast_relay | 41 |
| v2.7.0 | prefer_peer_relay、socket_mark | 43 |

> 注：`quic_listen_port` 自 v2.5.0 起始终保留（对应 CLI 参数 `--quic-listen-port` 仅 v2.5.0 短暂存在，见 4.3）。

### 3.4 子结构字段

**NetworkIdentity（全版本一致）**
- network_name: String（必填）
- network_secret: Option&lt;String&gt;
- network_secret_digest: Option&lt;NetworkSecretDigest&gt;（运行时计算，序列化时跳过）

**VpnPortalConfig（v2.7.0 重构）**

| 字段 | 类型 | 可用版本 |
| --- | --- | --- |
| client_cidr | cidr::Ipv4Cidr（必填） | v2.4.5 ~ v2.6.4（v2.7.0 移除） |
| wireguard_listen | SocketAddr | 全版本（v2.7.0 起为必填字段） |
| enabled | Option&lt;bool&gt; | v2.7.0 |
| wireguard_private_key | Option&lt;String&gt; | v2.7.0 |
| clients | Vec&lt;VpnPortalClientConfig&gt; | v2.7.0 |

> v2.7.0 该结构启用 `deny_unknown_fields`，旧字段 `client_cidr` 会导致解析报错（详见升级适配方案 P0-1）。

**VpnPortalClientConfig（仅 v2.7.0）**：name: String、virtual_ip: Ipv4Inet、groups: Vec&lt;String&gt;

**ManagedCredentialConfig（仅 v2.7.0）**：credential_id: String、credential_secret: String、groups: Vec&lt;String&gt;（默认空）、allow_relay: bool（默认 false）、allowed_proxy_cidrs: Vec&lt;String&gt;（默认空）、expiry_unix: i64、reusable: bool（默认 true）

**PeerConfig**：uri: url::Url（全版本）、peer_public_key: Option&lt;String&gt;（v2.6.0+）

**ProxyNetworkConfig（全版本）**：cidr: Ipv4Cidr、mapped_cidr: Option&lt;Ipv4Cidr&gt;、allow: Option&lt;Vec&lt;String&gt;&gt;

**PortForwardConfig**：bind_addr、dst_addr、proto —— v2.4.5~v2.6.4 定义于 `common/config.rs`；v2.7.0 迁至 `config/gateway.rs`（字段不变）

**LoggingConfig（全版本）**：file_logger: Option&lt;FileLoggerConfig&gt;、console_logger: Option&lt;ConsoleLoggerConfig&gt;
- FileLoggerConfig：level、file、dir、size_mb、count
- ConsoleLoggerConfig：level

**ConfigSourceConfig（v2.6.2+）**：source: ConfigSource

### 3.5 配置解析规则

- **未知字段**：v2.4.5~v2.6.4 全部结构为宽松解析（未知键被忽略）；v2.7.0 对 `VpnPortalConfig`、`VpnPortalClientConfig`、`ManagedCredentialConfig` 三个结构启用 `deny_unknown_fields`（未知字段直接解析报错）
- **flags 未知键**：v2.7.0 起对未知 flags 键的处理从「静默忽略」反转为「解析报错、启动失败」（LightTier 需治理默认模板，见升级适配方案 P2-1）
- `rpc_portal` / `rpc_portal_whitelist` 仅在 v2.4.5 的 TOML 中可用；v2.5.0 起必须通过 CLI 传入
- `flags`（原始 Map）与 `flags_struct`（强类型）两个入口全版本并存，二者择一使用

---

## 4. easytier-core 命令行参数

### 4.1 通用规则

- **覆盖优先级**：命令行参数 > 配置文件（`--config-file` 帮助原文：*options set by cmdline args will override options in config file*）
- **环境变量**：几乎所有参数都有对应 env（命名规则 `ET_` + 大写下划线，如 `--instance-name` → `ET_INSTANCE_NAME`）。**无 env 的例外**：`--gen-autocomplete`、`--check-config`、`--daemon`、`--disable-env-parsing`、`--tcp-whitelist`、`--udp-whitelist`
- **短参数（全版本一致，11 个）**：`-w` --config-server、`-c` --config-file、`-i` --ipv4、`-d` --dhcp、`-p` --peers、`-e` --external-node、`-n` --proxy-networks、`-r` --rpc-portal、`-l` --listeners、`-m` --instance-name、`-u` --disable-encryption
- **同机多实例**：`--instance-name`（实例名）；`--machine-id` 用于断线后的配置恢复
- **配置来源三选**：`--config-file`（单文件）/ `--config-dir`（v2.5.0+，加载目录内全部 .toml 并保存收到的配置）/ 纯 CLI 参数
- **参数属性稳定**：8 个版本间短参数与环境变量名**零变化**（提取校验结论）
- 少数参数受 Cargo feature 控制（例：`--socks5` 受 `socks5` feature 开关），本文以源码声明为准，实际以官方二进制 `-h` 输出为准
- `--check-config` 仅校验不启动；`--daemon` 后台运行；`--gen-autocomplete` 生成 shell 补全

### 4.2 基线参数（v2.4.5 起全程存在，63 个）

- **启动与配置**：--config-server、--machine-id、--config-file、--gen-autocomplete、--check-config
- **身份与虚拟网络**：--network-name、--network-secret、--ipv4、--ipv6、--dhcp、--hostname、--instance-name、--vpn-portal
- **连接与监听**：--peers、--external-node、--proxy-networks、--listeners、--mapped-listeners、--no-listener
- **加密与性能**：--default-protocol、--disable-encryption、--encryption-algorithm、--multi-thread、--multi-thread-count、--disable-ipv6、--dev-name、--mtu、--latency-first
- **路由与出口**：--exit-nodes、--enable-exit-node、--proxy-forward-by-system、--no-tun、--use-smoltcp、--manual-routes
- **中继与打洞**：--relay-network-whitelist、--disable-p2p、--disable-udp-hole-punching、--disable-sym-hole-punching、--relay-all-peer-rpc
- **代理与转发**：--socks5、--compression、--bind-device、--enable-kcp-proxy、--disable-kcp-input、--enable-quic-proxy、--disable-quic-input、--port-forward
- **DNS**：--accept-dns
- **安全与限速**：--private-mode、--foreign-relay-bps-limit
- **端口白名单**：--tcp-whitelist、--udp-whitelist
- **中继细化**：--disable-relay-kcp、--enable-relay-foreign-network-kcp
- **STUN**：--stun-servers、--stun-servers-v6
- **日志**：--console-log-level、--file-log-level、--file-log-dir、--file-log-size、--file-log-count
- **RPC**：--rpc-portal、--rpc-portal-whitelist

### 4.3 按版本新增/移除

| 版本 | 新增 | 移除 | 合计 |
| --- | --- | --- | --- |
| v2.5.0 | --config-dir、--daemon、--disable-env-parsing、--p2p-only、--disable-tcp-hole-punching、--quic-listen-port、--tld-dns-zone | — | 70 |
| v2.6.0 | --lazy-p2p、--need-p2p、--instance-recv-bps-limit、--disable-relay-quic、--enable-relay-foreign-network-quic、--secure-mode、--local-private-key、--local-public-key、--credential、--credential-file | --quic-listen-port | 79 |
| v2.6.1 | 无变化 | — | 79 |
| v2.6.2 | --ipv6-public-addr-provider、--ipv6-public-addr-auto、--ipv6-public-addr-prefix、--disable-upnp | — | 83 |
| v2.6.3 | 无变化 | — | 83 |
| v2.6.4 | --enable-udp-broadcast-relay | — | 84 |
| v2.7.0 | --vpn-portal-private-key、--vpn-portal-client、--vpn-portal-client-group、--socket-mark、--tcp-stun-servers | — | 89 |

重点参数格式说明（按帮助原文）：

- `--vpn-portal-client`：`NAME=CIDR` 形式（如 `alice=10.144.0.5/16`），可重复
- `--vpn-portal-client-group`：`NAME=GROUP` 形式，可重复
- `--rpc-portal`：本地管理入口，`0` 表示随机端口
- `--mtu`：默认 1380（不加密）/ 1360（加密）；`--multi-thread-count` 默认 2
- `--file-log-size` 默认 100（MB）、`--file-log-count` 默认 10
- 所有 v2.6.0+ 的凭据/安全模式参数：`--credential`（base64 私钥）、`--local-private-key` / `--local-public-key`、`--credential-file`（管理员节点凭据持久化文件）

---

## 5. easytier-cli 命令行

### 5.1 通用规则

- **结构**：`easytier-cli [全局参数] <一级命令> [二级命令] [参数]`；部分一级命令无二级（`stun`、`peercenter`、`proxy` 直接执行）
- **全局参数（全版本）**：
  - `-p --rpc-portal`：easytier-core 的 rpc portal 地址，默认 `127.0.0.1:15888`
  - `-v --verbose`：verbose output，默认 false
  - `-o --output`：输出格式，默认 `table`
- **v2.5.0+ 新增实例选择**（flatten 参数组 InstanceSelectArgs）：`-i --instance-id`、`-n --instance-name`
- **v2.6.0+ 新增** `--no-trunc`：关闭列截断（默认 false）
- `GenAutocomplete` 为**隐藏命令**（生成 shell 补全，帮助 key 走 i18n `core_clap.generate_completions`）
- 命令通过 RPC 连接 easytier-core 执行（默认 `127.0.0.1:15888`）

### 5.2 一级命令（全集 17 个；v2.4.5~v2.5.0 为 16 个，无 Credential）

| 命令 | 起始版本 | 说明 |
| --- | --- | --- |
| Peer | v2.4.5 | show peers info |
| Connector | v2.4.5 | manage connectors（含 `-i --ipv4`、`-p --peers` 过滤） |
| MappedListener | v2.4.5 | manage mapped listeners |
| Stun | v2.4.5 | do stun test |
| Route | v2.4.5 | show route info |
| PeerCenter | v2.4.5 | show global peers info |
| VpnPortal | v2.4.5 | v2.4.5~v2.6.4 仅查看信息；v2.7.0 起支持客户端管理 |
| Node | v2.4.5 | inspect self easytier-core status |
| Service | v2.4.5 | manage easytier-core as a system service（含 `-n --name`） |
| Proxy | v2.4.5 | show tcp/kcp proxy status |
| Acl | v2.4.5 | ACL（v2.4.5~v2.6.4 仅 stats；v2.7.0 起 +set） |
| PortForward | v2.4.5 | manage port forwarding |
| Whitelist | v2.4.5 | manage TCP/UDP whitelist |
| Stats | v2.4.5 | show statistics information |
| Logger | v2.4.5 | manage logger configuration |
| GenAutocomplete | v2.4.5（隐藏） | generate shell completions |
| Credential | v2.6.0 | manage temporary credentials |

### 5.3 二级命令（全集 41 个，含已移除项；v2.7.0 为 39 个）

| 命令 | 版本范围 | 参数要点 |
| --- | --- | --- |
| peer add / peer remove | v2.4.5 ~ v2.5.0 | 无参数；v2.6.0 移除 |
| peer list | v2.4.5+ | — |
| peer list-foreign | v2.4.5+ | v2.6.0+ 支持 `--trusted-keys`（默认 false） |
| peer list-global-foreign | v2.4.5+ | — |
| peer ipv6 | v2.6.2+ | — |
| connector add / connector remove | v2.4.5+ | v2.6.0+ 接受位置参数 `[url]`（如 `tcp://1.2.3.4:11010`）；v2.4.5~v2.5.0 无参数 |
| connector list | v2.4.5+ | — |
| mappedlistener add / remove / list | v2.4.5+ | 无参数 |
| route list / route dump | v2.4.5+ | — |
| node info / node config | v2.4.5+ | — |
| service install | v2.4.5+ | 见 5.4（`--core-args` 为 v2.7.0 新形式） |
| service uninstall / status / start / stop | v2.4.5+ | 使用一级 `-n --name` |
| acl stats | v2.4.5+ | — |
| acl set | v2.7.0 | 位置参数 `[acl]`：完整 ACL TOML 字符串或 `@path/to/acl.toml` |
| portforward add | v2.4.5+ | 位置参数：`[protocol]`（tcp/udp）、`[bind_addr]`、`[dst_addr]` |
| portforward remove | v2.4.5+ | 位置参数：`[protocol]`、`[bind_addr]`、`[dst_addr]`（可选） |
| portforward list | v2.4.5+ | — |
| whitelist set-tcp / set-udp | v2.4.5+ | 位置参数 `[ports]`（如 `80,443,8000-9000`） |
| whitelist clear-tcp / clear-udp / show | v2.4.5+ | — |
| stats show / stats prometheus | v2.4.5+ | — |
| logger get | v2.4.5+ | — |
| logger set | v2.4.5+ | 位置参数 `[level]`：disabled/error/warning/info/debug/trace |
| credential generate | v2.6.0+ | `--ttl`（必填，秒）、`--credential-id`、`--groups`、`--allow-relay`（默认 false）、`--allowed-proxy-cidrs`；**v2.6.2+ 增加 `--reusable`（默认 true）** |
| credential revoke | v2.6.0+ | 位置参数 `[credential_id]` |
| credential list | v2.6.0+ | — |
| vpnportal add-client | v2.7.0 | 位置参数 `[name]`；`--virtual-ip`（mesh 内虚拟 IPv4 CIDR）、`--groups`（ACL 组） |
| vpnportal remove-client | v2.7.0 | 位置参数 `[name]` |
| vpnportal clear-clients | v2.7.0 | — |

### 5.4 命令参数逐版本变化（仅列有变化项）

| 版本 | 变化 |
| --- | --- |
| v2.5.0 | 全局新增 InstanceSelectArgs（`-i --instance-id`、`-n --instance-name`） |
| v2.6.0 | 新增 Credential 命令组；移除 peer add / peer remove；全局新增 `--no-trunc`；peer list-foreign 新增 `--trusted-keys`；connector add/remove 新增 `[url]` 位置参数 |
| v2.6.1 | 无 |
| v2.6.2 | 新增 peer ipv6；credential generate 新增 `--reusable` |
| v2.6.3 / v2.6.4 | 无 |
| v2.7.0 | 新增 vpnportal add-client / remove-client / clear-clients、acl set；**service install 的 core 转发参数从位置参数 `[core_args]` 改为命名参数 `--core-args`（必须放在最后）** |

> `service install` 参数（v2.7.0）：`--description`、`--display-name`、`--disable-autostart`、`--disable-restart-on-failure`、`--core-path`、`--service-work-dir`、`--core-args`；v2.4.5~v2.6.4 前 6 个同名同义，core 转发参数为末尾位置参数。

---

## 6. 按版本变更明细（配置 + core + cli 汇总）

### v2.5.0（2026-01-01）

- **配置**：−`rpc_portal`、−`rpc_portal_whitelist`（TOML 不再接受，改 CLI 传入）
- **flags**：+p2p_only、+disable_tcp_hole_punching、+quic_listen_port、+tld_dns_zone（→33）
- **core 参数**：+--config-dir、+--daemon、+--disable-env-parsing、+--p2p-only、+--disable-tcp-hole-punching、+--quic-listen-port、+--tld-dns-zone（→70）
- **cli**：全局 +InstanceSelectArgs

### v2.6.0（2026-04-06）

- **配置**：+`secure_mode`、+`credential_file`（→26）；PeerConfig 新增 `peer_public_key`
- **flags**：+lazy_p2p、+disable_relay_quic、+enable_relay_foreign_network_quic、+need_p2p、+instance_recv_bps_limit（→38）
- **core 参数**：+--lazy-p2p、+--need-p2p、+--instance-recv-bps-limit、+--disable-relay-quic、+--enable-relay-foreign-network-quic、+--secure-mode、+--local-private-key、+--local-public-key、+--credential、+--credential-file；−--quic-listen-port（→79）
- **cli**：+Credential（generate/revoke/list）；−peer add、−peer remove（→34）；全局 +--no-trunc；peer list-foreign +--trusted-keys；connector add/remove +[url]

### v2.6.1（2026-04-19）

- 无任何字段/参数/命令变化（补丁级）

### v2.6.2（2026-04-26）

- **配置**：+`ipv6_public_addr_provider`、+`ipv6_public_addr_auto`、+`ipv6_public_addr_prefix`、+`source`（→30）；新增子结构 ConfigSourceConfig
- **flags**：+disable_upnp（→39）
- **core 参数**：+--ipv6-public-addr-provider、+--ipv6-public-addr-auto、+--ipv6-public-addr-prefix、+--disable-upnp（→83）
- **cli**：+peer ipv6（→35）；credential generate +--reusable

### v2.6.3（2026-05-02）

- **flags**：+disable_relay_data（→40）
- 其余无变化

### v2.6.4（2026-05-12，当前内置内核）

- **flags**：+enable_udp_broadcast_relay（→41）
- **core 参数**：+--enable-udp-broadcast-relay（→84）
- 其余无变化

### v2.7.0（2026-10-06）

- **配置**：+`tcp_stun_servers`、+`managed_credentials`（→32）
  - **VpnPortalConfig 重构**：−`client_cidr`；+`enabled`、+`wireguard_private_key`、+`clients`；`wireguard_listen` 变为必填；结构启用 `deny_unknown_fields`
  - 新增子结构 VpnPortalClientConfig、ManagedCredentialConfig
- **flags**：+prefer_peer_relay、+socket_mark（→43）
- **core 参数**：+--vpn-portal-private-key、+--vpn-portal-client、+--vpn-portal-client-group、+--socket-mark、+--tcp-stun-servers（→89）
- **cli**：+vpnportal add-client / remove-client / clear-clients、+acl set（→39）；service install core 参数改为 `--core-args`
- 其他非字段级变更（core crate 拆分、Android API 变动等）见升级适配方案

---

## 7. 数据来源与校验说明

- **提取方式**：不依赖 Release Notes，直接从各版本 tag 源码提取——配置结构来自 serde 派生定义（`gen_default_flags` 字面量保证 flags 完整）；core 参数与 cli 命令来自 clap 属性解析（`#[arg]`/`#[command]`，含内联结构体变体参数）
- **版本隔离**：8 个版本的 24 份源文件哈希互不相同，逐版本独立提取、两两 diff，本文所有计数均由提取结果自动统计
- **交叉校验**：v2.6.4 flags=41、v2.7.0 flags=43 等多处计数与专项核验一致；`--quic-listen-port`（仅 v2.5.0）、`GenAutocomplete`（隐藏命令）等特例均经源码复核
- **已知局限**：
  - v2.6.1~v2.6.3 的帮助文案（app.yml）复用相邻版本文件，help 措辞可能有细微差异；字段/参数/命令**结构**为各版本精确提取
  - 受 Cargo feature 控制的参数以源码声明为准（见 4.1）
  - v2.7.0 配置定义已拆分至 `config/` 多文件，本表按对外可见的 TOML 结构汇总

---

## 附录 A：v2.6.4 easytier-cli 完整命令树

> 摘自 v2.6.4 源码提取结果（含 about 文案与默认值）；`— ` 后为空表示该命令无 about 文案。

```text
### 全局参数（easytier-cli [全局] <command>）
  -p --rpc-portal | easytier-core rpc portal address | 默认: 127.0.0.1:15888
  -v --verbose | verbose output | 默认: false
  -o --output | output format | 默认: table
  --no-trunc | disable column truncation | 默认: false
  [flatten] InstanceSelectArgs:
    -i --instance-id | the instance id
    -n --instance-name | the instance name

### 子命令
#### Peer — show peers info
  - peer list — 
  - peer ipv6 — 
  - peer list-foreign — 
      - --trusted-keys | include trusted keys for each foreign network | 默认: false
  - peer list-global-foreign — 

#### Connector — manage connectors
  - -i --ipv4 | filter connectors by virtual IPv4 address
  - -p --peers | filter connectors by peer URL
  - connector add — 
      - [url: String] | connector url, e.g., tcp://1.2.3.4:11010
  - connector remove — 
      - [url: String] | connector url, e.g., tcp://1.2.3.4:11010
  - connector list — 

#### MappedListener — manage mapped listeners
  - mappedlistener add — 
  - mappedlistener remove — 
  - mappedlistener list — 

#### Stun — do stun test

#### Route — show route info
  - route list — 
  - route dump — 

#### PeerCenter — show global peers info

#### VpnPortal — show vpn portal (wireguard) info

#### Node — inspect self easytier-core status
  - node info — show node info
  - node config — show node config

#### Service — manage easytier-core as a system service
  - -n --name | service name
  - service install — register easytier-core as a system service
      - --description | service description
      - --display-name | display name shown by the service manager
      - --disable-autostart | whether to disable starting the service automatically on boot (true/false)
      - --disable-restart-on-failure | whether to disable automatic restart when the service fails (true/false)
      - --core-path | path to easytier-core binary
      - --service-work-dir | working directory for the easytier-core service
      - [core_args: Option<Vec<OsString>>] | args to pass to easytier-core
  - service uninstall — unregister easytier-core system service
  - service status — check easytier-core system service status
  - service start — start easytier-core system service
  - service stop — stop easytier-core system service

#### Proxy — show tcp/kcp proxy status

#### Acl — show ACL rules statistics
  - acl stats — 

#### PortForward — manage port forwarding
  - portforward add — 
      - [protocol: String] | Protocol (tcp/udp)
      - [bind_addr: String] | Local bind address (e.g., 0.0.0.0:8080)
      - [dst_addr: String] | Destination address (e.g., 10.1.1.1:80)
  - portforward remove — 
      - [protocol: String] | Protocol (tcp/udp)
      - [bind_addr: String] | Local bind address (e.g., 0.0.0.0:8080)
      - [dst_addr: Option<String>] | Optional Destination address (e.g., 10.1.1.1:80)
  - portforward list — 

#### Whitelist — manage TCP/UDP whitelist
  - whitelist set-tcp — 
      - [ports: String] | TCP ports (e.g., 80,443,8000-9000)
  - whitelist set-udp — 
      - [ports: String] | UDP ports (e.g., 53,5000-6000)
  - whitelist clear-tcp — 
  - whitelist clear-udp — 
  - whitelist show — 

#### Stats — show statistics information
  - stats show — 
  - stats prometheus — 

#### Logger — manage logger configuration
  - logger get — 
  - logger set — 
      - [level: String] | Log level (disabled, error, warning, info, debug, trace)

#### Credential — manage temporary credentials
  - credential generate — 
      - --ttl | TTL in seconds (required)
      - --credential-id | custom credential ID, return existing credential if already generated
      - --groups | ACL groups (comma-separated)
      - --allow-relay | allow relay through this credential node | 默认: false
      - --allowed-proxy-cidrs | allowed proxy CIDRs (comma-separated)
      - --reusable | whether this credential may be reused by multiple peers concurrently | 默认: true
  - credential revoke — 
      - [credential_id: String] | credential ID (UUID)
  - credential list — 

#### GenAutocomplete — core_clap.generate_completions
```

---

## 附录 B：v2.7.0 easytier-cli 完整命令树

> 摘自 v2.7.0 源码提取结果；与 v2.6.4 的差异已在 5.3/5.4 标注。

```text
### 全局参数（easytier-cli [全局] <command>）
  -p --rpc-portal | easytier-core rpc portal address | 默认: 127.0.0.1:15888
  -v --verbose | verbose output | 默认: false
  -o --output | output format | 默认: table
  --no-trunc | disable column truncation | 默认: false
  [flatten] InstanceSelectArgs:
    -i --instance-id | the instance id
    -n --instance-name | the instance name

### 子命令
#### Peer — show peers info
  - peer list — 
  - peer ipv6 — 
  - peer list-foreign — 
      - --trusted-keys | include trusted keys for each foreign network | 默认: false
  - peer list-global-foreign — 

#### Connector — manage connectors
  - -i --ipv4 | filter connectors by virtual IPv4 address
  - -p --peers | filter connectors by peer URL
  - connector add — 
      - [url: String] | connector url, e.g., tcp://1.2.3.4:11010
  - connector remove — 
      - [url: String] | connector url, e.g., tcp://1.2.3.4:11010
  - connector list — 

#### MappedListener — manage mapped listeners
  - mappedlistener add — 
  - mappedlistener remove — 
  - mappedlistener list — 

#### Stun — do stun test

#### Route — show route info
  - route list — 
  - route dump — 

#### PeerCenter — show global peers info

#### VpnPortal — manage vpn portal (wireguard) clients
  - vpnportal add-client — 
      - [name: String] | client name
      - --virtual-ip | client virtual IPv4 CIDR inside the mesh network
      - --groups | ACL groups assigned to the client
  - vpnportal remove-client — 
      - [name: String] | client name
  - vpnportal clear-clients — 

#### Node — inspect self easytier-core status
  - node info — show node info
  - node config — show node config

#### Service — manage easytier-core as a system service
  - -n --name | service name
  - service install — register easytier-core as a system service
      - --description | service description
      - --display-name | display name shown by the service manager
      - --disable-autostart | whether to disable starting the service automatically on boot (true/false)
      - --disable-restart-on-failure | whether to disable automatic restart when the service fails (true/false)
      - --core-path | path to easytier-core binary
      - --service-work-dir | working directory for the easytier-core service
      - --core-args | args to pass to easytier-core, must be the last option of install
  - service uninstall — unregister easytier-core system service
  - service status — check easytier-core system service status
  - service start — start easytier-core system service
  - service stop — stop easytier-core system service

#### Proxy — show tcp/kcp proxy status

#### Acl — show ACL rules statistics
  - acl stats — 
  - acl set — 
      - [acl: String] | full ACL TOML string or '@path/to/acl.toml'

#### PortForward — manage port forwarding
  - portforward add — 
      - [protocol: String] | Protocol (tcp/udp)
      - [bind_addr: String] | Local bind address (e.g., 0.0.0.0:8080)
      - [dst_addr: String] | Destination address (e.g., 10.1.1.1:80)
  - portforward remove — 
      - [protocol: String] | Protocol (tcp/udp)
      - [bind_addr: String] | Local bind address (e.g., 0.0.0.0:8080)
      - [dst_addr: Option<String>] | Optional Destination address (e.g., 10.1.1.1:80)
  - portforward list — 

#### Whitelist — manage TCP/UDP whitelist
  - whitelist set-tcp — 
      - [ports: String] | TCP ports (e.g., 80,443,8000-9000)
  - whitelist set-udp — 
      - [ports: String] | UDP ports (e.g., 53,5000-6000)
  - whitelist clear-tcp — 
  - whitelist clear-udp — 
  - whitelist show — 

#### Stats — show statistics information
  - stats show — 
  - stats prometheus — 

#### Logger — manage logger configuration
  - logger get — 
  - logger set — 
      - [level: String] | Log level (disabled, error, warning, info, debug, trace)

#### Credential — manage temporary credentials
  - credential generate — 
      - --ttl | TTL in seconds (required)
      - --credential-id | custom credential ID, return existing credential if already generated
      - --groups | ACL groups (comma-separated)
      - --allow-relay | allow relay through this credential node | 默认: false
      - --allowed-proxy-cidrs | allowed proxy CIDRs (comma-separated)
      - --reusable | whether this credential may be reused by multiple peers concurrently | 默认: true
  - credential revoke — 
      - [credential_id: String] | credential ID (UUID)
  - credential list — 

#### GenAutocomplete — core_clap.generate_completions
```
