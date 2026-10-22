# LightTier 飞牛 fnOS（fpk）打包方案 · 详细版

> [已归档 2026-10-22] 飞牛 fnOS fpk 打包调研，保留备查。

> 版本：2026-10-19 **v2** v1 → v2 的改动（均为源码取证后推翻 v1 结论）：① 新增 **F1 / F2** 两条路线（复用官方 web 后端、只重做界面），成本结构优于 v1 的推荐方案；② **推翻** v1 写的"官方控制台是单设备单节点、不支持多实例"——core 与 web 都原生支持多实例（第十一节）；③ 新增上游前端生态事实：web 前端是独立 Vite 工程 + 官方发布的 `easytier-frontend-lib` protobuf-ts 客户端（第十节）；④ 选型判据从"要不要多实例"改为"统一观感还是统一代码"；⑤ 新增前端可移植性审计的确切数据（组件库不兼容、无鉴权、类型语义）与一条待真机定案的关键问题（第十一、十三节）。
>
> 依据：LightTier 当前源码（`master`，v1.1.0 后）· 飞牛官方开发文档（本地 `fnos-dev-docs/`，抓取 2026-10-16）· `fnos/fpk-packaging-reference.md`（官方 fnpack 1.2.3 实测 + 真机日志归属）· `fnos/easytier/easytier-fpk-调研结论.md`（双容器包，已真机安装 🖥）· EasyTier 上游 tag `v2.7.0` 源码（经 `api.github.com/.../contents?ref=v2.7.0` 逐文件取回）· `easytier-mini` 上游 README

### 结论标记约定

| 标记 | 含义                                                       |
| ---- | ---------------------------------------------------------- |
| ✅   | 飞牛官方开发文档明确写明                                   |
| 🔬   | 本机用官方 fnpack 1.2.3 / 上游源码核对得到                 |
| 🖥   | 飞牛真机安装运行日志取证（最强证据，可推翻除 ✅ 外的推断） |
| ❓   | 逻辑成立但缺真机验证，按"可用但需复测"对待                 |
| 🧩   | 仅第三方商店仓库约定，官方文档无此要求                     |

**证据强度排序沿用既有纪律** 🖥 > 🔬 > ✅（官方文档措辞）> ❓：文档教你做某件事，推不出该功能的初始状态；上游行为按所打 tag 读源码定案。

---

## 一、问题定义

LightTier 是 Vue 3.5 + Tauri 2 的 EasyTier 可视化桌面管理器（见 `agents.md`）。"打包成 fpk"这句话里藏了三个独立问题：

1. **外壳问题**：Tauri 2 是桌面窗口框架，NAS 无图形会话。项目 Rust 后端**只写了 Windows**（`AGENTS.md` 明示；前端侧实证 🔬：`shellUtil.ts:456` 用 `taskkill /IM easytier-core.exe`、`:493-502` 用 PowerShell `Get-CimInstance Win32_Process` 扫进程、`:655` 路径写死 `easytier-core.exe`）。`shellUtil.ts:815` 虽有一处 `platform === 'windows' ? … : …`，但只是文件名后缀，进程扫描与终止路径仍是 Windows 专属——**"改个后缀就能跑 Linux"不成立**。⇒ Tauri 层不可能移植，只能绕开。
2. **界面问题**：Vue 前端能否脱离 Tauri 在浏览器里跑？**能**，见第三节。
3. **控制面问题**：谁来生成配置、拉起内核、读回状态？**这里有两条本质不同的路**（LightTier 自己的编排 vs 官方 web 控制台的编排），也正是本文 v2 的主要修订所在，见第四、五节。

### 一句必须先讲清的架构事实

**LightTier 和官方 web 控制台在架构里占同一个位置——都是界面，都不参与组网。** 真正承载网络的只有 `easytier-core` 一个二进制。所以所有候选方案的区别，最终都能压缩成一句话：_给 NAS 上的 core 配哪个控制面，以及那个控制面的代码从哪来。_

---

## 二、候选方案全景

| # | 方案 | 界面 | 控制面/编排 | 后端二进制 | 判定 |
| --- | --- | --- | --- | --- | --- |
| A | Docker fpk + 官方 web 控制台 | 官方控制台 | 官方 web | 官方 | ✅ 已实现并真机安装 🖥，零开发成本，但**不含 LightTier 任何代码** |
| **F2** | **官方 web + core 不动，自研 LightTier 风格前端** | 自研 | 官方 web | **官方，不改** | ★ **性价比最高**，见第五节 |
| F1 | 同上但替换 embed 二进制 | 自研 | 官方 web | **要自编 Rust+proto** | ⚠️ 拿到 F2 的一切，额外背一个上游分叉 |
| B+ | 容器内 Node agent 直接编排 core | LightTier 原版 dist | **你的 agent** | 官方 core+cli | ★ 仅在"统一代码"目标下成立 |
| C | 纯原生 fpk（宿主包用户起进程） | LightTier | 你的 agent | 官方 core+cli | ❌ 权限模型过不去，见第四节 |
| D | Tauri + WebKitGTK 跑在容器里 | LightTier | Tauri | — | ❌ 否决：要先补一整个平台的移植 |
| — | 用 `easytier-mini` 替换内核 | — | — | mini | ⚠️ 不是界面方案，仅作轻量形态，见第十二节 |

### D 为什么否决

即便接受在容器里跑 X/Wayland + WebKitGTK，也要先做 Tauri 的 Linux 移植（Rust 侧 Windows-only）。而 B+ 拿到的界面**与 D 是同一套 Vue 代码**，代价低一个数量级——D 唯一多出来的是"原生窗口"，那在 NAS 场景毫无意义。**需要窗口时选容器，需要界面时选 Web，本项目只需要界面。**

### C 为什么否决（权限模型）

`easytier-core` 建 TUN 需要 `NET_ADMIN`（+ 访问 `/dev/net/tun`）。飞牛 `config/privilege` 只有两种身份，官方对第二种的措辞很硬（✅ 引自 `docs/core-concepts/privilege`）：

> 普通应用运行时**不建议**使用 Root 模式……只有生命周期脚本确实需要执行特权准备任务时才使用 Root 模式，例如准备系统集成，或**访问包用户无法处理的设备**。长期运行并对外提供访问的进程，应尽可能以非 root 用户运行。

C 要让宿主包用户起的进程去建 TUN，只能全程 `run-as=root`，正面违背这条建议；而容器路径（A/F2/B+）用 `cap_add` 是**已文档化、且 A 已真机跑通 🖥** 的授权方式。**特权问题在容器里解决，不要在宿主上解决。**

---

## 三、前端可移植性审计（决定 B+ 与 F2 各自的工作量）

### 3.1 抽象层已经存在 🔬

`src/utils/coreApi.ts` 文件头即自称"内核操作统一抽象层 —— 视图只依赖此层，屏蔽平台差异"。真正的环境分发器是 `src/hooks/useMockData.ts`（593 行）：

```ts
// L44  const isTauriEnv = () => window.__TAURI__ !== undefined
// L157 const isMock = !isTauriEnv()
// L270 起每个能力一个 getXxx()：isMock ? mock : 真实实现（同签名）
```

分发器覆盖的完整能力面（**16 项，即 B+ 的 agent 必须实现的 API 契约**）：

| 能力 | 桌面真实实现 | fnOS agent 对应 |
| --- | --- | --- |
| `getListTomlFiles` / `Read` / `Write` / `DeleteFileOrDir` | `plugin-fs`，`config/*.toml` | 配置 CRUD |
| `getRunEasyTierCore` | `shellUtil` 起子进程 + 端口分配 | 启动实例 |
| `getKillProcess` | 按 pid 结束 | 停止实例 |
| `getFetchRunningList` / `getGetRunningProcesses` | 进程扫描（CIM） | agent 自持实例登记表 |
| `getCheckPortConflicts` | 读 TOML 监听端口 + 宿主占用 | 同算法 |
| `getHostname` | `plugin-os` | 系统信息 |
| `getCheckService` / `Install` / `Uninstall` / `Start` / `Stop` | NSSM / `easytier-cli service` | **不提供**，UI 隐藏 |

**⇒ B+ 的前端改动集中在这一个文件**（加第三档 `fnos` 分支），视图层不动。这是项目此前为 Android/mock 做的架构投资在 fnOS 上直接回本。

### 3.2 绕过抽象层直接用 Tauri 的地方（18 个文件）🔬

**① utils 层，属平台实现，按环境短路**：`fileUtil.ts`、`shellUtil.ts`、`sysUtil.ts`、`routeUtil.ts`。 **② 外壳装饰，fnOS 版不装配**：`App.vue`（event/window/window-state）、`main.ts`（window）、`layout/NewLayout.vue`、`store/modules/trayStore.ts`（tray/menu/app/window/window-state）、`store/modules/easytier.ts`（path/plugin-http）。⇒ 托盘、窗口状态、桌面通知在浏览器里不存在，**用能力位移除，不要留下点了没反应的按钮**。 **③ 需要换实现的交互（仅 4 处）**：`SettingsDialog/index.vue`、`useCoreInstall.ts`、`useExternalThemes.ts`、`EditDialog.vue` 与 `monitor/index.vue`（`plugin-dialog` + `plugin-fs`）。⇒ 原生文件对话框换成页面内 TOML 编辑器（`EditDialog.vue:500-551` 已具备 TOML 解析与回写能力）+ `<input type=file>` / `URL.createObjectURL`。

### 3.3 静态托管无障碍 🔬

- 路由是 **hash 模式**（`router/index.ts:27`，注释写明"Tauri / Android WebView 环境无服务端，hash 刷新不丢路由"）。⇒ agent 侧**不需要服务端 history 回退**。
- `base` 已是环境变量：`vite.config.ts:31` 读 `VITE_BASE_PATH`。⇒ 走统一网关设 `/app/lighttier/`，**不改代码**。
- 监控刷新是 `setInterval` 轮询（`monitor/index.vue:400,930`，间隔取 `easyTierStore.refreshInterval`，默认 3s）。⇒ **不需要 WebSocket 也能工作**。统一网关支持 WebSocket ✅，但本项目没有非用不可的理由，留作后续优化。

### 3.4 与官方 web 前端的差异（决定 F2 的真实成本）🔬

| 维度 | LightTier | 官方 `easytier-web/frontend` |
| --- | --- | --- |
| 组件库 | **Element Plus 2.13.7** | **PrimeVue 4.3.9 + `@primeuix/themes` + Tailwind 3.4.17** |
| 编辑器/图表 | monaco-editor 0.55.1 | chart.js 4.5.0 |
| i18n | vue-i18n **11.3.2** | vue-i18n **9.9.1** |
| 请求层 | Tauri `plugin-http`（只打远端 HTTPS） | axios + `easytier-frontend-lib` |
| 框架 | vue 3.5.32 / vue-router 4.6.4 | vue 3.5.12 / vue-router 4 |

⇒ **"LightTier 风格"不是改 CSS 能套上去的**：组件库不同族，`.vue` 模板几乎不能互相复用。F2 的前端是**新写**，能带过去的是观感（配色、密度、信息层级、监控页布局），不是代码。

### 3.5 数据模型语义完全不同 🔬

LightTier 的类型层**贴着 TOML 与 CLI JSON 两套具体格式**（`types/easyTier.ts:4-7` 自称"与 .toml 字段语义一致"）：

- 读侧：`PeerInfo`（`cost/hostname/id/ipv4/lat_ms/loss_rate/nat_type/rx_bytes/tunnel_proto/tx_bytes/version`）、`NetworkIdentity`（含 `network_secret_digest`）
- 写侧：`Flags`、`EasyTierConfig`、`RunningItem`、`RunningWebItem`；表单 `EasyTierFormData` 经 `easyTierUtil` 转成 `.toml`
- 渲染来源：`monitor/index.vue:166-202` 直接渲染 CLI `peer` 的 snake_case 字段；`config-view/index.vue:528` `toml.parse` 后取 `network_identity.network_name`、`rpc_portal`、遍历 `flags`

**字段名全部是 easytier 的 snake_case，没有任何"用户/网络/成员"的中心化抽象。** 而官方控制台 v2.7.0 的语义是 `users / networks / network_members / credentials / ACL / Gateway / 临时成员`（v2.7.0 刚加的中心化管理模型）。

⇒ F2 要做的是**照 web API 重写界面**；B+ 要做的是**把 LightTier 的 TOML+CLI 语义在服务器上重建**。两者都躲不开"设计一遍 NAS 交互"，区别只在复用哪一层。

### 3.6 LightTier 完全没有鉴权 🔬

`router/index.ts:17-18` 注释「当前无权限体系，保持为空」，`asyncRouterMap: []`，全仓无 `beforeEach` / token / session / Bearer。三类同名但无关的东西：本地锁屏密码（`App.vue:39,57-59,125` 比对 `easyTierStore.lockPassword`）、Windows 服务账号（`formTypes.ts:139-146`）、EasyTier 层 secret/credential（`easyTier.ts:134-135`）。

⇒ **F2 要新增登录页与 session 处理**（官方 web 有账号体系，预置 `admin`/`user` 🖥，前端用 `ts-md5` 预哈希口令再交给服务端 argon2）。B+ 同样要自己决定鉴权——因为 fnOS 上裸端口意味着同网段任何人都能操作你的组网。**这是两条路共同的必修项，不是 F2 独有的成本**；走统一网关可把登录态直接复用飞牛 ✅。

### 3.7 mock 模式能不能当接口契约用 🔬

`useMockData.ts` 覆盖 16 项分发能力，但 **`queryNode`/`queryPeer` 在 `coreApi.ts:88-110` 没有 mock 分支**，mock 的节点/peer 数据写在视图里（`monitor/index.vue:443+` 的 `mockPeers`，字段名与 CLI peer JSON 一致）。且 `useMockData` 的示例 TOML（L61-150）含 `EasyTierConfig` 里没有的键（如 `no_proxy`、外层 `[network]`），与真实字段集不一致。

⇒ **只有 `mockPeers` 具备契约价值**，其余 mock 仅演示。B+ 的 agent 契约要以真实 CLI 输出为准，不能拿 mock 当真。

---

## 四、特权与 TUN

结论见第二节 C 方案条目：**容器 `cap_add: ["NET_ADMIN","NET_RAW"]` + `devices: /dev/net/tun`** 是唯一既文档化 ✅ 又已真机验证 🖥 的路径。

⚠️ 必须记住的真机教训 🖥：`--no-tun` **不是加个参数就完事**，必须同时把 `devices:` 与 `cap_add:` 整行摘空——宿主没有该设备时保留 `devices:` 会让 dockerd **直接拒绝创建容器**（起不来，不是功能缺失）。免特权开关要做成"一条真正走得通的路径"。代价也要写进向导：无 TUN 时 NAS 只能被访问、不能主动访问组网内其他设备。

---

## 五、F2 设计：官方后端不动，只换界面

### 5.1 两个使能事实 🔬

1. **web 控制台的前端不是硬编码在二进制里的。** `easytier-web/` 下是完整的 `frontend/` + `frontend-lib/` + `config-generator/` + `locales/` + `migrations/` + `build.rs`。官方前端脚本自己写着 `pnpm --dir ../frontend-lib build && vue-tsc -b && vite build`，只有跑 e2e 时才 `cargo build -p easytier-web --features embed`。**⇒ "embed" 是把 dist 编进二进制的 feature 开关；默认编译的 `easytier-web` 就是纯 API 服务，界面本来就可以不带。**
2. **官方发布了前端 API 客户端库。** `easytier-web/frontend-lib/package.json` 依赖 `@protobuf-ts/runtime` + `@protobuf-ts/runtime-rpc`，scripts 里有 `codegen:proto: node scripts/codegen-proto.mjs`。⇒ **web 后端的 RPC 契约有官方生成、可直接 import 的 TS 客户端**，v1 担心的"要逆向 web API 面"这个成本基本不存在。

### 5.2 拓扑

```
容器 easytier-web  ← 官方镜像，entrypoint 仍是 easytier-web-embed（A 包已真机验证 🖥）
容器 easytier-core ← 官方镜像默认入口，作为受管节点接入
容器 ui            ← 新增：自研静态站点 + 同源反代（把 /api 转发到 web 的 11211）
桌面入口           ← 指向 ui 容器端口（或统一网关）
```

**反代不是可选项**：静态站点与 API 不同源会撞 CORS，除非官方 web 自己发 CORS 头（未验证 ❓）。反代同时把 API 与页面收在同一个 origin 下，也让"走统一网关"成为后续可选项。

### 5.3 与 A 的 delta（极小）

fpk 侧只需：compose 加第三个 service、`app/ui/config` 的入口 `port` 指向 ui、`manifest.service_port` 同步、`cmd/main` 的 `status` 多检查一个 `container_name`。其余（`et.db` 持久化、向导、钩子、端口模型、`--config-server udp://127.0.0.1:22020/admin`）**原样继承 A 已经真机验证过的部分** 🖥。

### 5.4 F1 为什么划掉

F1（自研前端 + 自己编 `easytier-web`）能拿到 F2 的全部观感收益，代价是持有一个上游分叉：要维护 Rust + protobuf + 前端工具链的编译环境，且**"换版本 tag 是一次完整核对，不是改一个数字"** 🖥（A 包的跨版本核对清单有 5 步：release 产物 → Dockerfile diff → clap 参数逐条比 → 端口偏移算法 → registry 探活）。F2 后端零改动，跟版本只需换 image tag。

---

## 六、B+ 设计：agent 直接编排 core

（架构与 v1 一致，此处保留要点，字段级模板见第七节）

```
容器 lighttier
├── Node agent (:8080)  ← 托管 LightTier dist + 3.1 表的 11 项 API
│     ├── POST /core/start   生成/读 TOML → 端口自动分配 → spawn easytier-core
│     ├── POST /core/stop    按 pid 结束
│     ├── GET  /running      agent 自持实例登记表（取代 CIM 进程扫描）
│     └── GET  /cli          easytier-cli -p <rpc> --output json node|peer|route
├── cap_add: NET_ADMIN, NET_RAW     devices: /dev/net/tun
└── easytier-core × N（同一容器内的多个子进程，或一个 core 进程内多实例）
```

三个实现要点：

1. **实例登记表取代进程扫描**：`Map<pid|instanceId, {name, rpcPortal, startedAt}>` + 落盘 `${TRIM_PKGVAR}/data/instances.json`，`status` 用 `kill -0`。顺带绕开"宿主 `ps` 能否看见容器进程 ❓"这个不确定性。
2. **端口分配搬现有算法**：`shellUtil.ts` 的"扫描已占用 rpc-portal → 挑空端口 → 双层冲突检测"是纯逻辑，直接翻译。
3. **RPC 地址归一沿用**：`coreApi.ts:33` 已把 `0.0.0.0` 归一成 `127.0.0.1`，agent 返回同约定，前端零改动。

**注意**：既然 core 本身就支持单进程多实例（第十一节），B+ 的"多个 core 子进程"只是其中一种用法。是否用单进程多实例，取决于你要不要每个网络完全独立的端口与生命周期——**多进程隔离更彻底但吃端口，单进程多实例更省资源但共享宿主 runtime**。这条建议实测后再定，不要先选。

---

## 七、fpk 工程事实（两条路共用）

### 7.1 manifest 要点

`checksum` 由 `fnpack build` 自动写入，**不要手填** 🔬（MD5(app.tgz)，且每次构建都变——fnpack 把 `app.tgz` 每个条目 mtime 写成构建时刻，所以 checksum 不能当"内容是否改过"的判据 🖥）。

**B+ 若把内核二进制随包携带，`platform` 必须写 `x86`/`arm`，不能写 `all`** ✅（`all` 仅当包内不含架构相关二进制）。F2 沿用官方多架构镜像，`platform=all` 依然成立 ✅。架构判定用 `TRIM_SYS_ARCH` ✅。

**版本纪律** ✅🖥：包版本严格等于上游内核/镜像版本，不做 `+1` 修订号，禁止 `:latest`（设备显示版本会与实际运行的不一致）。

### 7.2 compose 关键约束

- `container_name` 必须与 `cmd/main` 检查的名字**双向交叉一致** 🖥，对不上就是"应用中心永远显示未运行而容器活得好好的"。
- `network_mode: host` 与 `ports:` **互斥** 🖥，写了报错；host 下端口全部落宿主。
- 卷用 `${TRIM_PKGVAR:?}/data:/data`——缺变量时直接报错，而不是静默挂出空目录名 🔬。
- `command:` 写成**单行字符串**、`devices`/`cap_add` 写成**单行 flow 风格**，因为钩子用 sed 改文件时整行替换远比跨行块替换可靠 🔬（A 的离线测试抓到过"参数被追加进中文注释"这个真 bug）。
- 一个镜像跑两种角色时**必须整段覆盖 `entrypoint:`**——镜像默认入口是 `easytier-core`，只改 `command` 等于把 web 的参数喂给 core 🖥。
- 容器 PID 1 是 root（镜像无 `USER`）🖥，所以挂载目录属主天然一致，**不需要** bjanirss 那套容器侧先 chown 再 su-exec 的降权兜底。

### 7.3 端口占用模型 🔬

裸基端口 `P` 会展开成 4 组（偏移取自 `easytier-core/src/connectivity/protocol/mod.rs` 的 `protocol_port_offset`；v2.6.4 同一逻辑在 `IpScheme::attributes`，**数值完全相同** ⇒ 文案不用分版本）：tcp/udp=0、wg/ws=+1、quic/wss=+2、faketcp=+3。镜像 `EXPOSE` 只列到 `P+2` 且漏了 quic 的 udp 与 faketcp——**别用 EXPOSE 推断占用范围，会少算一个端口** 🖥。另有固定占用：Web `11211`、配置下发 `22020/udp`、RPC `127.0.0.1:15888`（同机只有一个实例能用它）。

### 7.4 生命周期与向导

Docker 应用的起停由系统按 `docker-project` 资源处理，`cmd/main` 的 `start`/`stop` 直接 `exit 0`，但 **`status` 必须准确**。退出码 `0`/`1`/`3` ✅，失败前把用户可见文案写进 `$TRIM_TEMP_LOGFILE` ✅。

`uninstall_callback` 仅在 `wizard_delete_data=true` 时删，且路径必须命中 `@appdata`/`@appconf`/`@apphome` 白名单 🖥。

向导：字段名即环境变量名（不加前缀 ✅），禁用 `TRIM_` ✅；把端口/开关放 `wizard/config`，**`wizard/install` 只放 `tips`**——`required` 字段在不经向导的安装路径（商店 / 无 `--env` 的 `appcenter-cli`）拿不到值会让安装失败 ⚠️。

**任何关键逻辑都不能挂在钩子上** 🖥（钩子侧 chown 已被真机证伪；同版本覆盖安装可能不重跑向导）。compose 与前端必须自带可用默认值，钩子只做"旧值→新值"的可选增强。

### 7.5 桌面入口：两种写法

- **端口 iframe**（A 已真机验证 🖥）：`"protocol":"http","port":"<port>","url":"/"`，MVP 用这个。
- **统一网关** ✅：`"protocol":"","gatewayPrefix":"/app/lighttier","gatewaySocket":"app.sock"`，需 manifest 去掉 `service_port`、`os_min_version=1.1.3100`、agent 在挂载目录建 Unix Socket、路由同时挂在 `/` 与 `gatewayPrefix` 下，请求头 `X-Trim-Userid` 为可信身份来源。**它的额外价值是免费拿到登录态**（呼应 3.6 的鉴权缺口），建议作为第二期。

### 7.6 构建与验证

照 A 的 `build.ps1` 模式：**打包前先跑离线测试**，不绿就 `throw`。断言至少覆盖：必需文件（含非框架文件 `cmd/common.sh`）、`checksum == MD5(app.tgz)`、JSON 可解析、中文未被编码破坏、`container_name` ↔ `cmd/main` 双向、端口三处（manifest/compose/ui/config）相等、compose 字面默认值 == `common.sh` 兜底常量、`devices`/`cap_add` 锚点在、`ports:` 不存在、包版本 == 内核版本。**并故意改坏一份副本来验证断言真的会抛**，否则它是装饰 🔬。

compose 改动先在本地按规范模拟插值再 `sh -n`；模拟必须**单遍扫描、先判 `$$` 再判 `${VAR}`**，两遍处理会把 `$${PUID}` 错当变量替换得出假结论 🔬。

Windows 开发机四件套 🔬：含中文的 `.ps1` 存 UTF-8 **with BOM**（每次编辑后要重补，前 3 字节应为 `EF BB BF`）；文件读写显式指定 UTF-8（否则按 GBK 写坏 manifest 中文）；解包用 `$env:SystemRoot\System32\tar.exe`（Git 的 GNU tar 会把 `D:\` 当远程主机）；`fnpack` 官方下载名无 `.exe`，PowerShell `&` 调用会**静默失败**。

---

## 八、前端改造清单

**B+ 需要**：`useMockData.ts` 加 `fnos` 分支 → 新增 `src/utils/fnosApi.ts` 实现 3.1 表 11 项 → 能力位 `PLATFORM_CAPS`（`service`/`tray`/`windowState`/`nativeDialog`/`autostart` 置 false，UI 按位隐藏）→ `main.ts`/`App.vue`/`trayStore.ts` 非 Tauri 分支跳过外壳装配 → 3.2③ 的 4 处换实现 → 新增 `.env.fnos`（`VITE_BASE_PATH`、`VITE_PLATFORM=fnos`）。

**F2 需要**：新建独立前端工程（可选是否沿用 LightTier 的 Vite/less/i18n 基建），依赖 `easytier-frontend-lib`；按 web 语义重做页面（3.5）；补登录与 session（3.6）；配 ui 静态服务 + 反代。

**两者共用**：所有用户可见文案同时更新 `src/locales/zh-CN.ts` 与 `en.ts`，禁止硬编码（`agents.md`）。图标由脚本按矢量参数画（GDI+），**不要用 AI 生成图**——右下角水印与不可控的圆角过不了 64px 清晰度要求 ✅；64×64、256×256、单文件 ≤1024 KB，构建期断言。

---

## 九、风险登记表

| 级别 | 风险 | 现状 | 影响面 | 处置 |
| --- | --- | --- | --- | --- |
| 🔴 | 容器能否真的建 TUN 并通网 | ❓（A 带 `devices:` 打过包，"通网"未确认） | **全部方案** | 开工前用一次真机安装打钩；失败则退 `--no-tun` 并明确写清代价 |
| 🔴 | 控制台多网络时，第 N 个网络的转发落在 web 还是 core 进程 | ❓ 源码有两个同名 `NetworkInstanceManager`，未见结论 | **F2 的界面语义** | 第十一节实测方法，不阻塞 A |
| 🟠 | 自建镜像在设备侧能否拉到 | ❓ 代理型加速器只保留部分 tag（同 tag `ghcr.io` 200 / `docker.1ms.run` 401 🔬） | B+（需自建镜像） | F2 用官方镜像天然规避；B+ 优先随包携带二进制 |
| 🟠 | 鉴权：裸端口 = 同网段任何人可操作组网 | 两边都要处理 | B+ / F2 | 短期反代加 basic auth，中期走统一网关复用飞牛登录态 ✅ |
| 🟠 | 生命周期钩子不可靠 | 🖥 已证伪 | 全部 | 关键逻辑不挂钩子，默认值自带 |
| 🟡 | F2 组件库与 LightTier 不兼容（Element Plus vs PrimeVue） | 🔬 | F2 工作量 | 明确按"新写前端"排期，不要按"改皮"排期 |
| 🟡 | 改端口后桌面入口不跟进 | ❓ fnOS 是否重读 `target/ui/config` | 全部 | 照 A 做 `rewrite_ui()`，最坏仅显示旧端口 |
| 🟡 | ARM 设备覆盖 | ❓ | B+ 随包二进制 | 首发只做 x86，`platform` 如实写 |

---

## 十、上游前端生态（F 系的依据）🔬

主仓库 v2.7.0 根目录是 `easytier-monorepo`（pnpm workspace）。相关目录：

```
easytier-proto/            protobuf 定义（单一真源）
easytier-web/
├── src/                   Rust 服务端：restful/ central_network/ migrator/ …
├── frontend/              控制台前端：PrimeVue + Tailwind，Vite 工程
├── frontend-lib/          ★ 可复用客户端库：protobuf-ts 生成 + 组件 + api.ts/i18n/statusDisplay/vpnPortal
├── config-generator/      独立 WASM 配置生成器（v2.7.0 新增）
└── build.rs               embed feature：把 dist 编进二进制
easytier-gui/              官方 Tauri 桌面客户端
easytier-js/               ★ WASM core 的浏览器/Cloudflare 宿主（browser / cloudflare / runtime / examples）
```

两点值得单独标注：

- **`easytier-js` 是数据面的浏览器/WASM 形态**，不是界面方案。它能跑浏览器 TCP 客户端和 Durable Object 中继，构建需 Node 22 + pnpm 10 + Rust 1.95 `wasm32-wasip1` + protobuf 35.1。与 fnOS 打包无关，但它是"NAS 之外还能在哪"的线索。
- **`frontend-lib` 是被低估的资产**：官方已经把 web API 客户端化并对外发布，F2 的成本估算因此从"逆向协议"降到"接现成 SDK"。

---

## 十一、多实例：v1 的错误与实测方法 🔬

**v1 曾写"官方 web 控制台是单设备单节点模型，多实例是 B+ 相对它的优势"——这条是错的，已推翻。** 证据：

1. **core 天生是"一进程多实例"**。`easytier-core/src/process_runtime.rs`：L6 文件头 `Host-domain portable resources shared by core instances.`，L27 `Owns portable resources whose identity is shared across core instances in ...`。用词是复数 **core instances** 配单数 host runtime。`easytier-core/src/instance/` 下是完整的 `manager.rs`（`pub struct InstanceManager<F: InstanceFactory>`）、`lifecycle.rs`、`management.rs`、`build_capabilities.rs`。
2. **CLI 面按实例寻址**。`easytier/src/easytier-cli.rs`：全局 `InstanceSelectArgs`（L168-172，`-i/--instance-id`、`-n/--instance-name`），并 import `ListNetworkInstanceRequest` / `ListNetworkInstanceMetaRequest`（L70）；`PeerSubCommand` L201 甚至有 `/// List foreign networks discovered by this instance`。实例级补丁命令齐全（port-forward / ACL / whitelist / connector / route）。
3. **LightTier 自己已经在用**。[android/mod.rs](/d:/develop/otherProjects/LightTier/src-tauri/src/android/mod.rs) L21 `use easytier::instance_manager::NetworkInstanceManager`、L101-109 `resolve_instance_id` + `list_network_instance_ids()`、L140 `Selector::Id(uuid)`、L181-201 事件订阅（`dhcp_ip_changed` / `proxy_cidrs_updated`）。⇒ 这也解释了一个此前没讲清的现象：**LightTier 的桌面模型（多进程）与 Android 模型（进程内多实例）是同一份能力的两种用法**，所以类型层能同时贴 TOML 和实例，不是两套抽象。
4. **web 控制台侧**：`easytier-web/src/central_network/service.rs` L194 持有 `network_instances: Option<Arc<crate::central_network::gateway::NetworkInstanceManager>>`，L261-263 注释提到"删掉最后一个网络时也 retire 它的 Gateway runtime"；`gateway.rs` / `gateway/listener.rs` / `restful/central_network.rs` 构成完整的"创建网络→分配成员→建监听"面。

### 待实测的那一条（重要）

源码里存在**两个不同的 `NetworkInstanceManager`**：core 的 `easytier::instance_manager::…`（LightTier Android 用的那个）与 web 自己的 `crate::central_network::gateway::…`。**我没有在源码里找到证据说明"从控制台给某台设备建的第 N 个网络，会落到那台设备的 core 进程里"**——更可能的情况是它由 web 服务端进程本地实现（Gateway 设施就在 web 里）。

区别很实际：若是后者，NAS 上多网络的**转发与路由跑在 web 容器而非 core 容器**，于是进程边界、资源占用、以及"停掉控制台这些网络还在不在"都会和直觉不符。

**实测方法（只读，不影响设备）**：控制台给同一台设备建两个网络 → `docker exec easytier-core ip addr`（看第二个虚拟 IP 在不在 core 容器里）→ `docker exec easytier-web ip addr`（对照）→ `docker exec easytier-core easytier-cli --output json node`（能否列出两个实例）→ `docker stats --no-stream`（哪个容器涨内存）→ 停掉 web 容器看第二个网络是否仍通。

这一步**不阻塞 A**，但**决定 F2 的界面该怎么画**（该把"实例"呈现为 NAS 的能力，还是控制台的能力）。

---

## 十二、easytier-mini 在本方案里的位置

上游在 [EasyTier v2.7.0](https://github.com/EasyTier/EasyTier/releases/tag/v2.7.0) 附带精简客户端 [easytier-mini](https://github.com/EasyTier/easytier-mini)（源码 `easytier-contrib/easytier-mini`，官方自称 POC），Linux x86-64 musl 构建控制在 5 MB 内，release 包约 2.3 MB（完整版 zip 约 24–31 MB）。它与完整版**共享协议、默认 AES-GCM、TUN、STUN/UDP 打洞、DHCP**，可与 LightTier 管理的完整节点同网互通。

🔬 v1 曾把"RPC 端口写死 127.0.0.1:15888、一机一进程"列为"否决多实例"——**现在要说清它的准确含义**：mini 限制的是**宿主上并存多个 mini 进程**，而 core 的"一进程多实例"在 mini 上并未声明支持（README 未提及 instance 面）。所以对**依赖进程内多实例或需要多进程并存的方案，mini 仍不可用**。其余裁剪：只认 `--config`/`-c`/`--config-server`（现有 `--file-log-dir --file-log-level --config-file` 参数集会启动失败）；本地 RPC 只读；仅 `tcp://`/`udp://`，无 `http(s)/txt/srv` 端点发现与 WSS/QUIC/KCP；**端口转发/退出节点写了被静默忽略**（UI 必须显式禁用而非"配了没用"）。

**判定：不作为界面方案的组成部分，只在"纯组网轻量节点"形态下有价值**——配合 `--config-server udp://<web>:22020/<user>` 由官方控制台托管即可，mini 保留完整权威配置模型、Web 侧一致性校验能收敛 🔬。现在只有 v2.7.0 prerelease，建议等 stable。

顺带一条比 mini 更该先处理：v2.7.0 有两个破坏性变更 ✅——`--config-server` 不再接受仅 token 的简写（须完整 URL，如 `udp://config-server.easytier.cn:22020/TOKEN`）、旧版 `wg://host:port/CIDR` 与 `client_cidr` 被拒（改 `wg://host:port` + `--vpn-portal-client NAME=CIDR`）。**LightTier 桌面版升 2.7.0 同样会打到配置生成逻辑，与 fnOS 无关也要做。**

---

## 十三、待真机定案清单

1. ❓ 容器能否建 TUN 并通网（**决定全部方案**）。
2. ❓ 控制台多网络落在 web 还是 core 进程（**决定 F2 界面语义**，方法见第十一节）。
3. ❓ 官方 web 是否返回 CORS 头（决定 F2 的反代能否省略，默认按"必须有"设计）。
4. ❓ fnOS 安装后是否重读 `target/ui/config`（决定改端口后桌面图标是否跟上）。
5. ❓ 设备 `registry-mirrors` 能否命中所需镜像 tag（F2 用官方 image，B+ 需自建）。
6. ❓ `config_callback` 后飞牛是否可靠重建容器（不重建则需手动重启应用设置才生效）。

**真机必查顺序**：`docker ps` 容器齐 → 入口能否打开 → 登录并立刻改密码（`admin`/`admin` 已真机确认 🖥，该凭据公开在上游仓库）→ 控制台设备列表出现 `easytier-core` → 建网络分配设备 → **第二网络归属定位（第 2 项）** → 跨设备连通。

---

## 十四、参考资源

| 内容 | 位置 |
| --- | --- |
| 飞牛官方开发文档（本地全文） | `fnos/fnos-dev-docs/飞牛fnOS-开发文档.md`、`飞牛fnOS-开发API.md` |
| fpk 打包通用结论（18 节，含坑归属表、跨版本核对清单） | `fnos/fpk-packaging-reference.md` |
| EasyTier 双容器包（参考实现 B，已真机） | `fnos/easytier/` + `easytier-fpk-调研结论.md` |
| 单容器降权包（参考实现 A） | `fnos/bjanirss-fnpack/` |
| Native 应用官方案例（Node + React + 统一网关） | `fnos/fnos-dev-docs/md/docs__examples__native.md` |
| fnpack 1.2.3 二进制 | `fnos/fnpack-1.2.3-windows-amd64` · https://static2.fnnas.com/fnpack/ |
| LightTier 关键源码 | [coreApi.ts](/d:/develop/otherProjects/LightTier/src/utils/coreApi.ts) · [useMockData.ts](/d:/develop/otherProjects/LightTier/src/hooks/useMockData.ts) · [shellUtil.ts](/d:/develop/otherProjects/LightTier/src/utils/shellUtil.ts) · [types/easyTier.ts](/d:/develop/otherProjects/LightTier/src/types/easyTier.ts) · [android/mod.rs](/d:/develop/otherProjects/LightTier/src-tauri/src/android/mod.rs) · [easytier.ts](/d:/develop/otherProjects/LightTier/src/constants/easytier.ts) |
| EasyTier 上游（参数/实例/端口偏移按 tag 读源码） | https://github.com/EasyTier/EasyTier/tree/v2.7.0 · `easytier-core/src/process_runtime.rs` · `easytier-core/src/instance/manager.rs` · `easytier-web/src/central_network/service.rs` · `easytier-web/frontend-lib/` |
| easytier-mini | https://github.com/EasyTier/easytier-mini |
