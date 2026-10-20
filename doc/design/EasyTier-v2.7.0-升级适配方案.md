# EasyTier v2.7.0 升级适配方案

> 生成时间：2026-10-09
> 基准：LightTier 内置内核 v2.6.4（桌面 zip + Android Cargo tag）→ 目标 v2.7.0
> 信息来源：EasyTier 官方 v2.7.0 Release Notes、EasyTier 仓库 v2.6.4/v2.7.0 源码（config/toml.rs、lib.rs、proto），以及 LightTier 当前代码
> 状态：分析完成（含兼容性矩阵与内核版本感知方案，见第 5、6 节），未开始实施

---

## 1. 结论速览

| # | v2.7.0 破坏性变更 | 对 LightTier 的影响 | 处理等级 |
| --- | --- | --- | --- |
| 1 | WireGuard 入口配置结构重构（`client_cidr` 被拒绝） | 数据模型/默认值过时；存量配置升级后内核启动失败 | **必须适配** |
| 2 | `--config-server` 必须完整 URL | LightTier 一直生成完整 URL（`udp://host:port/token`），天然合规 | 验证即可 |
| 3 | Web 管理端数据库迁移 | 仅影响自建 config-server 服务端，LightTier 不经手该数据库 | 无影响 |

其余主要工作：

- **版本同步**：`BUILTIN_CORE_VERSION`、`DEFAULT_VER_OPTIONS`、`src-tauri/resource/core/` 压缩包、Android 端 `Cargo.toml` tag 共 4 处需同步升级。
- **Android 端 API 迁移（最大隐藏工作量）**：v2.7.0 将 Core 拆分为独立 `easytier-core` crate 并重构 `easytier` crate 顶层模块（`instance_manager`、`peers` 等模块消失），`src-tauri/src/android/mod.rs` 的 12 处 API 引用约 2 处确认失效、其余需编译验证。
- **功能重合**：v2.7.0 新增「中心化网络管理控制台」「多客户端 WireGuard 管理 UI」，与 LightTier 的 Web 配置管理页存在定位交叠——策略为**互补划界**（LightTier 管本地，官方 Web 管中心），不重复建设，具体见第 4 节。
- **未知 flags 键会致启动失败（已确认）**：v2.7.0 将 flags 未知键的处理从 v2.6.4 的「静默忽略」反转为「解析报错、启动失败」（证据见 P2-1）；LightTier 默认模板中存在 9 个此类键（其中 5 个可由 UI 触达），必须治理。
- **向上兼容与版本感知**：顶层字段宽松解析，可向上（未来内核）兼容；但 `vpn_portal_config` 新旧格式彻底互斥、flags 严格性反转——**跨内核版本共存必须依赖「面向内核版本的兼容分层」**（兼容矩阵见第 5 节，版本感知编辑方案见第 6 节）。
- **顺带发现 3 处 LightTier 既有配置兼容问题**（与 v2.7.0 无关，建议同批修复），见第 9 节。

> 注意：v2.7.0 当前为 **Pre-release**（官方标记 prerelease=true）。是否立即将其设为内置版本，建议在实施阶段决策（见第 7 节 Phase 0）。

---

## 2. v2.7.0 升级了什么

版本发布：2026-10-06。主题：中心化网络管理、多客户端 WireGuard 入口、连接稳定性与性能改进。

### 2.1 升级注意事项（官方破坏性变更）

1. **配置服务器地址必须使用完整 URL**（[#2459]）
   `--config-server` 不再接受仅 token 的简写。`my-token` → `udp://config-server.easytier.cn:22020/my-token`。
2. **旧版 WireGuard 入口配置需要迁移**（[#2502]）
   不再接受 `wg://host:port/CIDR` 与旧 `client_cidr` 字段；改用 `wg://host:port` + 专用服务端私钥 + 具名客户端 `--vpn-portal-client NAME=CIDR`，需通过新版 GUI/Web 或 CLI 重新导出客户端配置。
3. **Web 管理端数据库迁移**（[#2622]）
   中心化网络管理引入数据库迁移，升级前备份数据库；回退需同时恢复数据库备份。

### 2.2 新功能

| 功能 | 说明 | 与 LightTier 相关性 |
| --- | --- | --- |
| 中心化网络管理控制台 | 集中创建网络、管理设备/成员、分配地址、凭据与 ACL、Gateway、临时成员 | ⚠️ 与 Web 配置管理页定位交叠（见第 4 节） |
| 多客户端 WireGuard 入口 | 具名客户端、独立状态与流量统计、运行时增删；Web/GUI 提供管理入口 | ⚠️ 与 vpn_portal 数据模型冲突（见第 3 节 P0-1） |
| 凭据和 ACL 动态管理 | TOML 声明并持久化受管凭据（`[[managed_credentials]]`）、运行时替换 ACL、JSON/TOML ACL 输入 | 可选跟进（LightTier 安全模式字段可借此修复） |
| 连接与部署配置 | Linux `SO_MARK`（flags.socket_mark）、可配置 TCP STUN 服务器（顶层 `tcp_stun_servers`）、WebSocket 监听 URL 路径、Docker 健康检查 | 可选跟进（新增字段，无需强制适配） |
| Android / Magisk | Android VPN 快捷设置磁贴、Magisk WebUI | 无冲突（官方 Android app 与 LightTier 是不同宿主） |
| 开发者集成 | 拆分可移植 Core（easytier-core crate）、FFI/JNI/Go/WASI、浏览器/Workers 宿主、easytier-mini 精简客户端 | ⚠️ 影响 Android 端内嵌 API（见第 3 节 P0-3）；长期是 LightTier 架构演进机会 |

### 2.3 主要修复与改进（与 LightTier 相关的）

- **Windows 平台修复**（对 LightTier 服务/桌面功能直接利好）：
  - 开机无网络时的 TUN 启动修复
  - 服务自启动修复
  - UDP 广播回环修复
- **连接稳定性**：低延迟优先路由、非对称直连恢复、IPv6 多公网地址打洞、OSPF 元数据过期同步、接收限速下的存活探测；TCP 打洞连接每秒心跳维持。
- **代理与中继**：QUIC 乱序修复；QUIC 优先协商 ETQ1（校验绑定包序号，旧版本回退，**双端升级才能完整受益**）；KCP 控制消息恢复、TCP 流隔离、SOCKS5 转发修复。
- **访问控制**：双向 ping 绕过入站丢弃规则修复、Web 会话列表用户隔离、凭据/安全模式配置加载修复。
- **Web 管理连接**：配置同步、会话替换、握手并发、配置服务器拨号超时。
- **性能**：数据路径同步与缓冲区开销降低、QUIC/WireGuard 缓冲区优化、内存回收改进。

---

## 3. LightTier 适配项明细

### 3.0 总览表

| 编号 | 适配项 | 等级 | 涉及文件 |
| --- | --- | --- | --- |
| P0-1 | vpn_portal_config 结构迁移 | 必须 | `src/constants/defaultData.ts`、`src/types/easyTier.ts`、`src/types/formTypes.ts`、存量配置迁移提示 |
| P0-2 | 内置内核版本 4 处同步 | 必须 | `src/constants/easytier.ts`、`src-tauri/resource/core/`、`src-tauri/Cargo.toml` |
| P0-3 | Android 内嵌 API 迁移 | 必须 | `src-tauri/src/android/mod.rs`、`src-tauri/Cargo.toml` |
| P1-1 | config-server URL 合规验证 | 验证 | `src/views/new/web-config-view/*`、`src/utils/shellUtil.ts` |
| P1-2 | 新字段可选支持 | 可选 | `src/constants/defaultData.ts` 等 |
| P2-1 | 未知 flags 键防御（v2.7.0 会致启动失败，已确认） | 必须 | `src/constants/defaultData.ts`、`src/views/new/config-view/EditDialog.vue`、启动/服务安装路径 |

---

### P0-1：vpn_portal_config 结构迁移【必须】

**变更前（v2.6.4，LightTier 当前适配的格式）**：

```rust
// easytier/src/common/config.rs @ v2.6.4
pub struct VpnPortalConfig {
    pub client_cidr: cidr::Ipv4Cidr,
    pub wireguard_listen: SocketAddr,
}
```

**变更后（v2.7.0，源码已确认）**：

```rust
// easytier-core/src/config/toml.rs @ v2.7.0
#[serde(deny_unknown_fields)]
pub struct VpnPortalConfig {
    pub enabled: Option<bool>,
    pub wireguard_listen: SocketAddr,
    pub wireguard_private_key: Option<String>,   // 新增：专用服务端私钥
    pub clients: Vec<VpnPortalClientConfig>,     // 新增：具名客户端
}

#[serde(deny_unknown_fields)]
pub struct VpnPortalClientConfig {
    pub name: String,
    pub virtual_ip: cidr::Ipv4Inet,
    pub groups: Vec<String>,
}
```

新格式 TOML 示例：

```toml
[vpn_portal_config]
enabled = true
wireguard_listen = "0.0.0.0:51820"
wireguard_private_key = "..."

[[vpn_portal_config.clients]]
name = "alice"
virtual_ip = "10.144.144.10/24"
groups = ["staff"]
```

**风险**：`deny_unknown_fields` 已生效——官方自带测试 `legacy_vpn_portal_client_cidr_is_rejected_explicitly` 明确验证 `client_cidr` 会**报错拒绝**（而非忽略）。存量配置含 `client_cidr` 时，v2.7.0 内核将直接解析失败、无法启动。

**LightTier 现状**：

- `src/constants/defaultData.ts:40-43`：`vpn_portal_config: { client_cidr: '', wireguard_listen: '' }`
- `src/types/easyTier.ts:59-62`：`interface VpnPortalConfig { client_cidr: string; wireguard_listen: string }`
- `src/types/formTypes.ts:120`：`vpn_portal_config: Partial<VpnPortalConfig> | any`
- 目前**没有** vpn_portal 专用编辑 UI；用户通过 TOML 代码模式手动编写。表单模式下 `EditDialog.buildFormToml`（白名单重建）不会保留 vpn_portal_config——即受影响的主要是「代码模式手写过 WireGuard 门户的用户」。

**适配动作**：

1. 更新类型与默认值：

   ```ts
   // src/types/easyTier.ts
   interface VpnPortalClientConfig {
     name: string
     virtual_ip: string
     groups?: string[]
   }
   interface VpnPortalConfig {
     enabled?: boolean
     wireguard_listen: string
     wireguard_private_key?: string
     clients?: VpnPortalClientConfig[]
   }
   ```

   `defaultData.ts` 同步（建议 `vpn_portal_config: { wireguard_listen: '', clients: [] }` 或直接 `undefined`，避免注入空结构）。

2. 启动前做**存量配置兼容检测**：桌面端启动路径（`src/utils/shellUtil.ts` 的 `runEasyTierCore` / 服务安装路径）读取 TOML，若存在 `vpn_portal_config.client_cidr`，拦截启动并提示「该配置使用已废弃字段，v2.7.0 起请迁移为具名客户端格式」，给出迁移指引（可附官方 GUI/Web 导出说明）。文案走 i18n（`zh-CN.ts` + `en.ts` 同步）。
3. 后端启动失败的错误提示优化：内核解析失败时明确显示"配置解析失败"而非仅"启动失败"，附日志路径。

> 说明：是否需要为 v2.7.0 新格式提供 LightTier 专属管理 UI——**建议不做**，理由见第 4.2 节。

---

### P0-2：内置内核版本 4 处同步【必须】

`BUILTIN_CORE_VERSION` 升级时以下 4 处必须同步（成对约束，漏改会导致内置安装/Android 构建不一致）：

| # | 位置 | 当前值 | 目标值 |
| --- | --- | --- | --- |
| 1 | `src/constants/easytier.ts` → `BUILTIN_CORE_VERSION` | `'v2.6.4'` | `'v2.7.0'` |
| 2 | `src/constants/easytier.ts` → `DEFAULT_VER_OPTIONS[0]` | `v2.6.4` | 与 1 保持一致（首项被 SettingsDialog 默认选中） |
| 3 | `src-tauri/resource/core/easytier-windows-x86_64-v2.6.4.zip` | v2.6.4 包 | 替换为 `easytier-windows-x86_64-v2.7.0.zip`（文件名格式已确认与 `EASYTIER_NAME` 模板一致，无需改模板） |
| 4 | `src-tauri/Cargo.toml` → Android 依赖 | `easytier = { git = "...", tag = "v2.6.4" }` | `tag = "v2.7.0"`（同时处理 P0-3 的 API 迁移） |

补充说明：

- `DEFAULT_VER_OPTIONS` 的其余候选项（v2.6.0、v2.4.5）可保留或精简（如保留一个老版本用于回退）。
- SettingsDialog 的版本下拉来自 GitHub Releases API（含 Pre-release，未过滤 `prerelease` 字段），v2.7.0 已自动出现在可下载列表中——内置升级与「用户自选下载」是两条独立路径。
- 压缩包获取：官方 Release 资产 `easytier-windows-x86_64-v2.7.0.zip`（约 37 MB，文件名格式已确认）。

---

### P0-3：Android 内嵌 API 迁移【必须，工作量最大】

v2.7.0 将内核 Core 拆分为独立 `easytier-core` crate（可移植 Core），`easytier` crate 顶层模块重构。对照 `src-tauri/src/android/mod.rs` 的引用（v2.7.0 的 `easytier/src/lib.rs` 已确认导出清单）：

| # | 当前引用（v2.6.4 路径） | v2.7.0 状态 | 处理 |
| --- | --- | --- | --- |
| 1 | `easytier::instance_manager::NetworkInstanceManager` | ❌ 顶层模块已不存在（`instance_manager.rs` → `instance/` 目录重组） | 需迁移到新路径（升级时对照 v2.7.0 源码/编辑器补全确定，候选 `easytier::instance` 或 `easytier::core`） |
| 2 | `easytier::peers::PUBLIC_SERVER_HOSTNAME_PREFIX` | ❌ v2.7.0 `lib.rs` 未导出 `pub mod peers` | 需查新位置或改用 `easytier-core` 对应项 |
| 3 | `easytier::common::config::{ConfigFileControl, ConfigLoader, TomlConfigLoader}` | ⚠️ `common` 仍存在，但内部已改为 re-export `easytier_core::config::toml::*`；`ConfigFileControl` 在 `management-rpc` feature 下 | 编译验证；可能需调整 feature 声明 |
| 4 | `easytier::common::global_ctx::GlobalCtxEvent` | ⚠️ `common::global_ctx` 仍存在（v2.7.0 内部仍 `use crate::common::global_ctx::ArcGlobalCtx`） | 编译验证 |
| 5 | `easytier::proto::api::instance::*`、`proto::rpc_impl::standalone::StandAloneClient`、`proto::rpc_types::controller::BaseController` | ⚠️ `proto` 模块仍存在，内部结构需验证 | 编译验证 |
| 6 | `easytier::rpc_service::ApiRpcServer` | ⚠️ 仍存在（feature `management-rpc`） | 编译验证 |
| 7 | `easytier::tunnel::ring::{RingTunnelConnector, RingTunnelListener}`、`tunnel::TunnelListener` | ⚠️ `tunnel` 仍存在，`ring` 子模块需验证 | 编译验证 |
| 8 | `easytier::utils::{string::cost_to_str, PeerRoutePair}` | ⚠️ `utils` 仍存在，内部路径需验证 | 编译验证 |
| 9 | `easytier::VERSION` | ✅ 仍存在 | 无需改 |

**适配动作**：

1. `Cargo.toml`：Android 依赖 tag 升 `v2.7.0`；根据新结构可能需同时显式依赖 `easytier-core`（或启用相应 feature）。
2. 用 `cargo check --target aarch64-linux-android`（参考 `lt-android-check.ps1`）逐项修正路径，直至编译通过。
3. 回归 Android 关键路径：VPN 启动/停止、peer 列表（`PeerTableItem` 与 CLI 对齐字段）、node 查询、`--rpc-portal` 相关逻辑。
4. 注意 v2.7.0 的 QUIC ETQ1 协商为**双端升级受益**：Android 端与桌面端同升 v2.7.0 后才能完整生效。

---

### P1-1：config-server 完整 URL【验证即可】

v2.7.0 要求 `--config-server` 传完整 URL。LightTier 现状核实：

- `src/views/new/web-config-view/WebConfigForm.vue`：`protocol`（udp/tcp）+ `host` + `port`（默认 22020）+ `userName`（token）均必填；
- `src/views/new/web-config-view/index.vue:551`：`url = ${protocol}://${host}:${port}/${userName}`，启动与服务安装均使用该完整 URL；
- `src/utils/shellUtil.ts:353`：`args: ['--config-server', url]` 原样透传。

**结论：不存在「仅 token」路径，天然满足 v2.7.0 要求。** 验证项：

1. 默认端口 22020、udp 协议与官方示例（`udp://config-server.easytier.cn:22020/my-token`）一致；
2. 自建服务器用户填自有 host 时行为不变；
3. 进程识别逻辑 `cmd.includes(expectedUrl)` 在新内核 CLP 输出下仍可匹配（命令行参数形式未变）。
4. （可选增强）v2.7.0 新增 WebSocket 监听 URL 路径支持；若官方 config-server 支持 `ws://` 接入，WebConfigForm 协议下拉可增加 `ws` 选项——待官方文档确认后再做。

---

### P1-2：v2.7.0 新字段可选支持【可选，建议排期但非阻塞】

对照 v2.7.0 源码（`easytier-core/src/config/toml.rs` 顶层 Config 与 flags），新增/变化的字段：

| 字段 | 位置 | 说明 | LightTier 建议 |
| --- | --- | --- | --- |
| `tcp_stun_servers` | 顶层（数组） | 可配置 TCP STUN 服务器 | 可加入 `ADVANCED_TOP_TEXT_DEFS` 风格的高级文本项 |
| `managed_credentials` | 顶层（`[[managed_credentials]]` 数组） | 受管凭据（credential_id/secret/groups/allow_relay/expiry 等） | 数据模型透传已有保障（normalizeToml 透传未知键）；完整 UI 跟进与否按需求定 |
| `socket_mark` | flags | Linux SO_MARK（Windows 无效） | 可加入高级 flags 列表（仅 Linux 有意义） |
| `prefer_peer_relay` | flags | v2.7.0 新增 flags 字段 | 可选 |
| `vpn_portal_config.*` | 顶层结构 | WireGuard 门户新格式 | 见 P0-1 |
| `acl` | 顶层 | ACL 现支持 JSON/TOML 输入与运行时替换 | 透传已保障；编辑器 UI 可选 |

> LightTier 的 `normalizeToml`（`src/utils/easyTierUtil.ts`）对「非默认表中的键」做透传，因此上述新字段即使用户手写 TOML 也不会被 LightTier 清洗掉——表单模式的字段级支持可按需增量添加。

---

### P2-1：未知 flags 键防御（v2.7.0 会致启动失败）【必须，已确认】

v2.7.0 的 `gen_flags` 实现变化，**未知 flags 键的处理从「静默忽略」反转为「启动失败」**：

| 版本 | 合并策略（源码） | 未知 key 行为 |
| --- | --- | --- |
| v2.6.4 | 白名单合并：仅遍历默认字段的 key 取值，用户额外的 key 被丢弃（`common/config.rs` → `gen_flags`） | 静默丢弃，不影响启动 |
| v2.7.0 | 全量合并：`merged_hashmap.extend(用户全部 flags)` 后 `serde_json::from_value::<FlagsInConfig>`（`easytier-core/src/config/toml.rs` → `gen_flags`） | **反序列化报错** |

v2.7.0 报错的根源链（源码已核对）：

1. `FlagsInConfig` 由 `pbjson-build` 生成（`easytier-proto/build/main.rs`），构建脚本**未调用** `ignore_unknown_fields()`——pbjson 默认对未知字段**报错**（宽容模式是显式 opt-in）；
2. `gen_flags` 返回 `serde_json::Result`，`new_from_config` 中 `gen_flags(...).context("failed to parse flags")?` 将错误上抛；
3. 结果：配置中存在任何未知 flags 键时，内核**解析配置即失败退出**（错误含 `failed to parse flags`），不是静默忽略。

LightTier 默认模板中**两版内核（41/43 个合法 flags 字段）均不存在**的键共 9 个：

| # | 键 | 正确归属 | 触达途径 |
| --- | --- | --- | --- |
| 1 | `secure_mode` | 顶层 `[secure_mode]` 段 | 高级开关 |
| 2 | `no_listener` | 无对应（无效键） | 高级开关 |
| 3 | `ipv6_public_addr_auto` | 顶层字段 | 高级开关 |
| 4 | `ipv6_public_addr_provider` | 顶层字段 | 高级文本 |
| 5 | `ipv6_public_addr_prefix` | 顶层字段 | 高级文本 |
| 6 | `disable_ipv6` | 无对应（无效键） | 手写/历史残留 |
| 7 | `ipv6_listener` | 无对应（无效键） | 手写/历史残留 |
| 8 | `socks5` | 顶层 `socks5_proxy` | 手写/历史残留 |
| 9 | `compression_algorithm` | flags `data_compress_algo` | 手写/历史残留 |

> 值为 `undefined` 的默认键经 `normalizeToml` 空值剔除不落盘；但只要用户通过 UI 开关/输入或动态 Flags 编辑器（支持任意自定义 key）让任一键产生值，即写入 TOML → v2.7.0 启动失败。

**适配动作**：

1. 修复第 9.2 节的字段归属（`secure_mode` 迁入 `[secure_mode]` 段、`ipv6_public_addr_*` 迁到顶层、清理无效键），从源头消除已知无效 key；
2. 动态 Flags 编辑器按「合法字段白名单」（v2.7.0 的 43 字段）对未知键给出警告样式（复用第 6 节版本感知注册表）；
3. 启动前预检：解析 TOML 后扫描 flags 未知键，命中则拦截启动并提示具体键名（与 P0-1 的迁移拦截合并实现，见第 6 节）；
4. 升级验证时用 v2.7.0 内核实测「含未知 flags 键的配置」确认失败表现与错误文案（留证），修复后确认不再可产生此类配置。

---

## 4. 功能重合与冲突分析（解决策略）

### 4.1 重合点清单

| # | v2.7.0 新能力 | LightTier 对应功能 | 关系判断 |
| --- | --- | --- | --- |
| 1 | 中心化网络管理控制台（Web 端：网络/成员/地址/凭据/ACL 管理） | Web 配置管理页（`web-config-view`，管理本机 `--config-server` 接入进程）；配置管理页（`config-view`，本地实例） | **互补为主、感知重叠**：官方控制台是「服务端运维台」，LightTier 是「桌面本地管理器」。重合感来自两者都能「建配置、管成员相关参数」 |
| 2 | 多客户端 WireGuard 入口（含 Web/GUI 管理 UI） | `vpn_portal_config` 数据模型（无 UI） | **官方已做全套 UI**，LightTier 重建无增益 |
| 3 | 凭据/ACL 动态管理（Web 端） | 安全模式字段（本地配置，见第 9 节既有问题） | 能力错位：一个面向中心签发，一个面向本机密钥配置，不冲突 |
| 4 | Android VPN 磁贴 / Magisk WebUI | LightTier Android 内嵌内核 + VPN 服务 | 无冲突（不同宿主应用/模块） |
| 5 | 可移植 Core / WASI / easytier-mini | LightTier「下载 zip 解压换内核」模式 | 潜在机会（长期架构演进），非冲突 |
| 6 | config-server 完整 URL 强制 | Web 配置管理页表单 | 无冲突（已合规，见 P1-1） |

### 4.2 冲突解决策略

**总原则：划清「本地管理器 vs 中心化运维」的边界，LightTier 不与官方 Web/GUI 重复建设，把精力放在官方不覆盖的桌面本地深度能力上。**

1. **中心化网络管理控制台（重合点 1）**
   - LightTier **不实现**中心化网络管理（不维护成员数据库、不做 ACL/凭据签发台）——该领域官方 Web 控制台是最新最全的实现，且随内核演进（数据库迁移等），跟随成本高。
   - LightTier 的 Web 配置管理页**保留并强化定位**：管理本机「作为客户端接入 config-server」的进程生命周期（启动/停止/服务化/状态检测），这是轻量桌面场景官方 Web 不覆盖的。
   - 增强建议：在详情面板「打开控制台」入口（已有 `webUrl` 字段与 `openConsoleUrl`）旁增加一句引导文案，说明「网络/成员/凭据的集中管理请在控制台完成」，形成能力分工的心智。
2. **多客户端 WireGuard 入口（重合点 2）**
   - 官方在 v2.7.0 提供了完整的具名客户端管理 + 客户端配置导出（GUI/Web/CLI）。LightTier **不重复建设管理 UI**。
   - LightTier 的职责收窄为：**配置格式兼容 + 迁移防御**（P0-1）：
     - 数据模型对齐 v2.7.0 结构；`client_cidr` 存量配置拦截提示；引导用户在官方 GUI/Web 中完成客户端配置导出。
   - 如果未来有「在 LightTier 内一站式管理 WireGuard 客户端」的强需求（如批量导出、分组管理），再立项评估——当前优先级低于 Android API 迁移。
3. **凭据 / ACL（重合点 3）**
   - 「本机自身需要的密钥/凭据」（如 `secure_mode.local_private_key`）属于 LightTier 表单职责范围 → 修复字段位置后保留。
   - 「群体性凭据签发与撤销」属于官方 Web 控制台 → LightTier 不做。
4. **Android（重合点 4）**
   - 无冲突。LightTier Android 端是自有应用内嵌内核，与官方 APK/磁贴互不影响。
5. **可移植 Core / easytier-mini（重合点 5）**
   - 记录为长期演进方向：若 easytier-mini 稳定，「桌面端下载 zip 解压换内核」的重模式未来可评估替换为 FFI/内嵌方案。当前不排期。
6. **QUIC ETQ1（隐性协作点）**
   - 校验绑定包序号需要**通信双端同为 v2.7.0+** 才能完整收益；自建网络中 LightTier 无法控制对端版本——在版本选择界面可提示「v2.7.0 的 QUIC 修复需所有节点同步升级」。

---

## 5. 向上兼容分析：适配修改后能兼容哪些内核版本

### 5.1 问题界定与结论

LightTier 完成本方案适配（数据模型改为 v2.7.0 新格式、内置版本升级）后，需要分两个方向看兼容性：

- **方向 A（兼容旧内核）**：用户通过版本下拉/手动安装仍在使用 v2.6.4 等旧内核时，LightTier 生成的配置能否正常启动；
- **方向 B（兼容未来内核）**：用户将内核升级到 v2.7.1 / v2.8+ 时，LightTier 现有配置与逻辑是否继续可用。

**结论先行**：

1. **方向 B 基本可行**——两版内核顶层 `Config` 均未开启 `deny_unknown_fields`（未知顶层键忽略）、新增字段均为可选/默认值，LightTier 只写已知字段即可保持对未来内核的韧性；残余风险集中在「内核再次对某个子结构收紧或删除字段」（v2.7.0 对 `vpn_portal_config` 就是这种模式的首例），用「启动前校验拦截」兜底即可（第 6 节）。
2. **方向 A 不能无条件兼容**——`vpn_portal_config` 新旧格式**彻底互斥**（不存在兼容交集），flags 未知键的处理在 v2.6.4（静默忽略）与 v2.7.0（启动失败）之间**反转**。跨内核版本共存必须引入「内核版本感知」（第 6 节）；否则只能收窄承诺支持的内核范围。

### 5.2 兼容矩阵（配置面 × 内核版本）

| 配置面 | v2.6.4 内核 | v2.7.0 内核 | 依据（源码已核对） |
| --- | --- | --- | --- |
| 顶层常规字段（hostname / dhcp / network_identity / listeners / peer / routes 等） | ✅ | ✅ | 两版顶层 `Config` 均无 `deny_unknown_fields`：未知键忽略、缺失字段均可选 |
| v2.7.0 新增顶层字段（tcp_stun_servers / managed_credentials / source 等） | ⚠️ 静默忽略（旧内核不识别） | ✅ | 同上（旧版顶层宽松解析） |
| `vpn_portal_config`：旧格式（`client_cidr`） | ✅ | ❌ 拒绝启动 | v2.7.0 `#[serde(deny_unknown_fields)]` + 官方测试显式验证拒绝 |
| `vpn_portal_config`：新格式（`clients` / `wireguard_private_key`，无 `client_cidr`） | ❌ 启动失败（缺必填 `client_cidr`） | ✅ | v2.6.4 `client_cidr: Ipv4Cidr` 必填且无默认值 |
| `flags` 未知键 | ✅ 静默丢弃 | ❌ 启动失败（`failed to parse flags`） | 见 P2-1 证据链 |
| `flags` 两版共有字段（41 个） | ✅ | ✅ | gen_default_flags 清单逐项对照 |
| `flags` v2.7.0 新增字段（prefer_peer_relay / socket_mark） | ⚠️ 静默丢弃 | ✅ | 旧版白名单合并 |
| `--config-server`（完整 URL，LightTier 现行形式） | ✅ | ✅ | LightTier 现行配置双版可用 |
| `easytier-cli` 输出解析（监控页 peer/node JSON） | ✅ | 待实测回归 | 已列入第 8 节验证清单 |

> 关键事实：`vpn_portal_config` 的两种格式**不存在同时被两版内核接受的非空写法**——v2.6.4 要求 `client_cidr` 存在，v2.7.0 拒绝 `client_cidr` 存在。二者唯一的共同兼容形态是「完全不写该段」。

### 5.3 兼容策略选项对比

| 方案 | 描述 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A：双格式数据模型 | 内部并存新旧两套字段，按当前内核版本序列化对应格式 | 单份配置跨版本游走 | 复杂度与测试矩阵翻倍；v2.7.0 已是官方既定方向，双轨无长期收益 | 不推荐 |
| B：单格式 + 版本守卫（推荐） | 统一写 v2.7.0 新格式；编辑/启动前按当前内核版本校验，不兼容即警示/拦截 + 迁移指引 | 实现简单、与官方演进一致、可复用为长期机制 | 旧内核用户需引导（升级内核或迁移配置） | **推荐** |
| C：收窄内核支持范围 | 新版 LightTier 仅承诺 v2.7.x+，对可选旧内核标注「可能不兼容」 | 零兼容负担 | 剥夺回退能力，违背「自选下载任意版本」的产品能力 | 仅作 B 的降级兜底 |

### 5.4 长期韧性设计原则

1. **只对「敏感面」建规则**：顶层字段宽松是一般规律；真正需要版本规则的是「带 `deny_unknown_fields` 的子结构 + 未知键行为变化的段 + 命令行参数格式」——当前即 `vpn_portal_config`、`flags`、`--config-server` 三类，未来按需扩展；
2. **启动前校验兜底**：任何「配置面 × 内核版本」的冲突最终都要在启动/服务安装路径上拦截并给出可操作的错误信息（键名 + 迁移指引），这是防内核演进破坏用户体验的最后一道防线；
3. **未知版本宽松降级**：版本探测失败 → 告警不拦截，避免校验机制本身成为可用性故障点。

---

## 6. 内核版本感知编辑方案

> 回答「编辑配置文件时，能否根据当前使用的内核版本隐藏或提示不兼容的字段」：**能，且这是方向 A（兼容旧内核）的唯一正解。** 推荐以「警示 + 拦截」为主、「隐藏」仅用于新建流程，理由见 6.2。

### 6.1 现状盘点

| 事项 | 现状 | 结论 |
| --- | --- | --- |
| 版本探测能力 | 桌面端 `runEasyTierCli(['--version'])`（SettingsDialog 已用于展示）；Android 端 `coreApi.getCoreVersion()`（编译期内置版本） | ✅ 探测点存在，可复用 |
| 版本状态 | 仅 SettingsDialog 组件级 ref，未入 store、未持久化；应用启动不检测 | ⚠️ 需全局化 |
| 内核安装形态 | 单份覆盖式安装（`resource/core/easytier-core(.exe)` 固定路径，`useCoreInstall.installCore` 解压覆盖） | 「当前内核版本」是全局属性，一次探测全应用可用 |
| 编辑器感知 | EditDialog（表单/代码双模式）、config-edit-view 均不读取版本信息 | ❌ 需接入 |

### 6.2 策略选择：警示 + 拦截优先，「隐藏」仅用于新建

| 策略 | 适用场景 | 风险/说明 |
| --- | --- | --- |
| 物理隐藏字段 | **仅新建配置流程** | 表单模式保存是白名单重建（`EditDialog.buildFormToml`），对已有配置「隐藏 + 保存」等于数据丢失（叠加第 9.3 节问题） |
| 醒目标注警示（保留数据） | 全部编辑场景 | 无数据风险；代码模式横幅 + 表单模式字段级标记 |
| 启动前拦截 | 启动 / 服务安装路径 | 依赖准确的版本状态；探测失败降级放行（见 6.4） |
| 一键快捷修复 | `vpn_portal_config` 迁移 | 「移除 `client_cidr` 保留 `wireguard_listen`」作为快速恢复启动的最小迁移；客户端配置引导至官方 GUI/Web 重新导出 |

### 6.3 实现设计

1. **版本状态全局化**（`src/store/modules/easytier.ts` 新增）
   - `coreVersion: ref<string>`（原始显示串，如 `easytier-cli 2.7.0`）与 `coreVersionNum: ref<number[] | null>`（解析后的 `[2,7,0]`）；
   - `detectCoreVersion()`：桌面走 `runEasyTierCli(['--version'])`、Android 走 `coreApi.getCoreVersion()`，解析失败置 `null`；
   - 调用时机：应用启动（与 `loadConfigFiles` 同批）、`SettingsDialog.handleInstallCore` 成功后、SettingsDialog 打开时（现有 `handleCheckCore` 改调 store）。
2. **兼容规则注册表**（建议新文件 `src/constants/kernelCompat.ts`）
   - `KERNEL_COMPAT_RULES`：`{ path: string[], kind: 'removed' | 'introduced', since: string, messageKey: string }[]`，首批规则：`vpn_portal_config.client_cidr`（removed @ v2.7.0）、`vpn_portal_config.clients` / `wireguard_private_key`（introduced @ v2.7.0）；
   - `KERNEL_FLAG_WHITELIST: string[]`：v2.7.0 的 43 个合法 flags 字段（与 `gen_default_flags` 同步维护），用于未知键检测；
   - 升级内核版本时只需增删规则，编辑/启动链路代码不动。
3. **校验函数**（建议新文件 `src/utils/kernelCompatUtil.ts`）
   - `parseKernelVersion(raw: string): number[] | null`；
   - `checkConfigCompat(toml: Record<string, any>, ver: number[] | null): CompatIssue[]`：
     - `vpn_portal_config.client_cidr` 存在且内核 ≥ v2.7.0 → **error**（启动必失败）；
     - `vpn_portal_config.clients` / `wireguard_private_key` 存在且内核 < v2.7.0 → error（旧内核缺必填字段）；
     - `flags` 含白名单外键且内核 ≥ v2.7.0 → error（P2-1）；内核为旧版时降级为 info（静默丢弃，仅提示）；
     - `ver === null` → 全部降级为 warning。
4. **集成点**
   - `EditDialog.vue`：打开/内容变化时计算 `compatIssues`；代码模式顶部警示横幅；表单模式对应字段加警示样式与 tooltip（保留可编辑）；
   - 启动链路：`config-view/index.vue` 启动按钮与 `shellUtil.ts` 服务安装前调用校验，error 级弹窗拦截（含键名、原因、迁移指引、i18n），提供「仍要启动」出口（高级用户自主决策 + 风险提示）；
   - `SettingsDialog`：版本徽章改读 store（消除重复探测）；更换内核成功后提示「已切换至 vX.Y.Z，部分配置可能需迁移」；
   - Android 的 `config-edit-view` 复用 EditDialog，自动获得同能力（Android 内核固定，规则几乎不触发）。
5. **i18n**：新增词条（`zh-CN.ts` + `en.ts` 同步）——不兼容字段提示、横幅标题、拦截弹窗、迁移指引、「仍要启动」。

### 6.4 边界与降级

- 内核未安装 / CLI 缺失 / 探测失败 → 不拦截，仅提示「未能检测内核版本，跳过兼容校验」；
- 版本串解析失败（未知格式）→ 按「未知版本」宽松处理；
- 服务模式/自启：服务与桌面共用同一份内核二进制，版本状态同源，无需区分；
- 用户手动混搭 core/cli 版本 → 以实际探测输出为准（探测的即运行时版本）。

### 6.5 与「向上兼容」的关系

版本感知不是为 2.7.0 写的一次性补丁，而是把「内核可自选下载」的产品能力与「配置格式随内核演进」的事实对齐的基础设施：未来任何内核破坏性变更，只需在注册表新增规则，即可全局获得编辑警示与启动拦截，无需再次改造编辑/启动链路。

---

## 7. 实施步骤建议（分阶段）

### Phase 0：决策
- 决定是否等 v2.7.0 转正式版再升内置版本。**建议**：正式版发布前，桌面端先合入 P0-1 的格式兼容与迁移提示（不依赖内核版本即可做），内置 zip/Cargo tag 的替换可同步进行。（注：版本下拉曾允许自选 v2.7.0 Pre-release；现已改为仅展示/缓存正式版 Release，v2.7.0 转正后将自动进入列表。）

### Phase 1：桌面配置兼容（独立可测，风险低）
1. P0-1 类型/默认值更新；
2. P2-1 flags 未知键治理（第 9.1/9.2 节字段归属修复 + 无效键清理，避免高级开关写入非法键）；
3. `client_cidr` 与「flags 未知键」两类存量检测 + i18n 提示文案；
4. 版本探测全局化（6.3 第 1 条，store 新增 coreVersion + detectCoreVersion）；
5. 本地用 v2.7.0 内核包实测：默认模板启动、旧 vpn_portal 配置拦截、含未知 flags 键配置的失败表现留证（治理后不可复现）。

### Phase 2：内置版本与资源替换
1. P0-2 四处同步（constants ×2、zip 包、Cargo tag 暂缓）；
2. 验证 `useCoreInstall` 解压安装路径与新版 zip 目录结构（若官方包内目录结构有变需同步 `extractFile` 期望）。

### Phase 3：Android API 迁移（工作量最大，独立分支）
1. Cargo tag 升 v2.7.0（P0-3）；
2. `cargo check --target aarch64-linux-android` 迭代修复 ~12 处引用；
3. Android 真机回归：启动/停止 VPN、peer/node 查询、图标与通知。

### Phase 4：可选增强
- 版本感知完整 UI：编辑器警示横幅/表单字段标记、新建配置按内核版本的面板、设置页切换内核提示（6.3 第 4 条）；
- P1-2 新字段（tcp_stun_servers、socket_mark 等）按需纳入高级选项；
- WebConfigForm 协议下拉评估 ws 支持；
- 第 9 节既有问题修复。

---

## 8. 验证清单（升级回归）

- [ ] 默认模板（server/client/custom）配置在 v2.7.0 内核下启动成功
- [ ] 含未知 flags 键（如 `flags.secure_mode = true`）的配置：v2.7.0 内核实测确认启动失败（留证），治理后不再可产生
- [ ] 高级开关（安全模式 / IPv6 公网地址 / no_listener）不再向 `flags` 写入非法键（归属修复后写入正确位置）
- [ ] 含 `vpn_portal_config.client_cidr` 的旧配置：启动被拦截并给出迁移提示
- [ ] 新格式 `[vpn_portal_config]` + `[[vpn_portal_config.clients]]` 配置可启动、可监控
- [ ] 版本感知：设置页版本徽章与应用启动探测结果一致；用 v2.6.4 内核（若纳入版本守卫）时编辑/启动给出对应提示
- [ ] 版本探测失败（内核未安装/CLI 缺失）时编辑与启动不被阻断（warning 降级放行）
- [ ] config-server 完整 URL 启动/服务安装/进程识别全链路正常（旧 token-only 场景无残留）
- [ ] Windows 服务安装/自启动（受益于官方修复项，重点回归服务自启动）
- [ ] 监控页：`easytier-cli node/peer --output json` 解析正常（字段兼容实测）
- [ ] 主题/退出路由等 LightTier 侧功能不受内核变化影响（冒烟）
- [ ] Android：编译通过 + 真机 VPN 启停 + peer 列表
- [ ] 安装包内置 core zip 免下载安装成功（BUILTIN_CORE_VERSION 与 zip、DEFAULT_VER_OPTIONS 三处一致）

---

## 9. 附录：顺带发现的既有配置兼容问题（与 v2.7.0 无关）

以下问题在核对 v2.6.4/v2.7.0 内核源码时发现，**不是 v2.7.0 引入的**，但会同时影响升级验证判断，建议随本方案一并修复：

### 9.1 安全模式字段位置疑似错误

- 内核 Config 顶层结构（v2.6.4 与 v2.7.0 相同）为 `secure_mode: Option<SecureModeConfig>`，即 TOML 应为：

  ```toml
  [secure_mode]
  enabled = true
  local_private_key = "..."
  local_public_key = "..."
  ```

- LightTier `SECURITY_FIELD_DEFS`（`defaultData.ts:110-138`）将 `local_private_key`/`local_public_key` **写在顶层**，`EditDialog.buildFormToml` 同样按顶层写回；同时 `flags.secure_mode` 作为开关——但 `secure_mode` **不在**内核合法 flags 中（见 9.2）。
- 内核 Config 未开启 `deny_unknown_fields`，顶层未知字段被静默忽略 → 疑似「填写后不生效」；且 `flags.secure_mode` 在 v2.7.0 会因未知 flags 键直接导致启动失败（P2-1）。
- 修复时注意内核侧对 `[secure_mode]` 的校验（v2.6.4 与 v2.7.0 行为一致）：`enabled = true` 时私钥缺失会自动生成、公钥缺失会从私钥推导；若手填公钥与私钥不匹配则直接报错（`local public key ... does not match ...`，启动失败）。
- **待办**：实测确认后，将生成格式迁移为 `[secure_mode]` 嵌套结构（含 UI 调整）。

### 9.2 flags 中混入了非 flags 字段（9 个键，已逐一核对）

`defaultData.ts` 的 `flags` 中包含 9 个**两版内核（v2.6.4 的 41 个 / v2.7.0 的 43 个）flags 清单中均不存在**的键：

| 键 | 正确归属 | UI 可触达 |
| --- | --- | --- |
| `secure_mode` | 顶层 `[secure_mode]` 段（见 9.1） | ✅ 高级开关 |
| `no_listener` | 无对应（无效键） | ✅ 高级开关 |
| `ipv6_public_addr_auto` | 顶层字段 | ✅ 高级开关 |
| `ipv6_public_addr_provider` / `ipv6_public_addr_prefix` | 顶层字段 | ✅ 高级文本 |
| `disable_ipv6` / `ipv6_listener` | 无对应（无效键） | 仅手写/历史残留 |
| `socks5` | 顶层 `socks5_proxy` | 仅手写/历史残留 |
| `compression_algorithm` | flags `data_compress_algo` | 仅手写/历史残留 |

影响升级：

- v2.6.4：静默忽略（不生效但可启动）；
- **v2.7.0：直接导致启动失败**（pbjson 严格反序列化 + 错误上抛，详见 P2-1）——本问题从「无效字段」升级为「确定故障」，必须治理。

### 9.3 表单模式保存丢失未建模字段

`EditDialog.parseFormData` 以白名单重建表单模型，`buildFormToml` 从该模型重新序列化——`vpn_portal_config`、`proxy_network`、`port_forward`、`acl`、`managed_credentials` 等未建模的顶层段在**表单模式保存时会被丢弃**（代码模式不受影响）。
建议：表单模式保存前合并原始 TOML 中未建模的键值（透传），或保存前提示用户。

---

## 10. 参考

- EasyTier v2.7.0 Release Notes：https://github.com/EasyTier/EasyTier/releases/tag/v2.7.0
- v2.6.4 → v2.7.0 完整变更：https://github.com/EasyTier/EasyTier/compare/v2.6.4...v2.7.0
- 关键源码（v2.7.0）：
  - `easytier-core/src/config/toml.rs`（VpnPortalConfig、Config、gen_flags 全量合并）
  - `easytier-core/src/config/mod.rs`（normalize_secure_mode_config）
  - `easytier-proto/build/main.rs`（proto 生成配置：preserve_proto_field_names + btree_map，未启用 ignore_unknown_fields）
  - `easytier/src/lib.rs`（顶层模块导出）
  - `easytier/src/proto/common.proto`（SecureModeConfig 等）
- 关键源码（v2.6.4，对照）：`easytier/src/common/config.rs`（VpnPortalConfig 无 deny_unknown_fields；gen_flags 白名单合并）
- pbjson-build 参考（FlagsInConfig 的 serde 生成器；未知字段默认报错，宽容需显式 opt-in）：https://docs.rs/pbjson-build
- LightTier 涉及文件清单：`src/constants/easytier.ts`、`src/constants/defaultData.ts`、`src/types/easyTier.ts`、`src/types/formTypes.ts`、`src/utils/shellUtil.ts`、`src/utils/easyTierUtil.ts`、`src/views/new/config-view/EditDialog.vue`、`src/views/new/web-config-view/*`、`src-tauri/Cargo.toml`、`src-tauri/src/android/mod.rs`、`src-tauri/resource/core/`
