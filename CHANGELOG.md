# Changelog

## 1.7.5 (2026-10-22)

> 配置编辑改为表单模式优先，应用模板更实用且不再覆盖已填内容；内核版本选择器统一为主题化下拉。

- 配置编辑
  - 新增/编辑配置默认以表单模式打开，每次打开按传入 TOML 重新解析，避免沿用上次残留值；TOML 解析失败时回退代码模式并提示
  - 表单模式下导入 TOML 会同步重解析，避免保存时用旧表单值覆盖导入内容
- 配置模板
  - 服务器模板改为 `dhcp = true`（原预设无静态 IP 不可用），客户端模板自动获取虚拟 IP；两者开启低延迟与多线程，并补充用途说明
  - 模板选择器改为与设置页一致的带说明主题化下拉，支持方向键/Home/End/Esc 与移动端自适应
  - 应用模板改为增量更新：只替换模板接管字段，保留已填写的 hostname、网络身份、Peer 等
- 设置
  - 内核版本选择器由原生 `<select>` 改为主题下拉，渠道、已下载、已安装标记保持可见
- 验证
  - vue-tsc、18 个测试文件 205 项用例、ESLint、Stylelint、Prettier 通过
  - 浏览器 Mock 实测表单模式、三种模板的应用与保留行为、键盘操作及 390px 移动端布局，并完成端到端保存验证

## 1.7.4 (2026-10-22)

> 品牌标识统一与侧边栏精简：对齐应用 logo，移除无意义的伪用户卡片，并修复主题弹窗按钮间距。

- 品牌统一
  - 侧边栏左上角占位 “ET” 与设置「关于」的字母色块统一替换为应用 logo（`public/logo.png`），与启动画面、桌面图标一致
- 侧边栏
  - 移除底部无实际功能的伪用户卡片，语言、主题、设置合并为一行图标入口
  - 删除不再使用的 `managerLabel` i18n 文案与对应自适应字号选择器
- 修复
  - 主题弹窗底部「取消 / 应用主题」按钮补回间距（Naive UI 不会自动为相邻按钮加左间距）
- 验证
  - vue-tsc、ESLint、Stylelint、Prettier 通过
  - 浏览器 Mock 实测侧边栏、设置「关于」与主题弹窗布局

## 1.7.3 (2026-10-22)

> 仓库整理与代码质量清理：归档历史文档、移除冗余资源，统一 Rust 排版并清零 clippy 告警。

- 文档
  - 将 `docs/` 与 `fnPack/` 并入文档中心 `doc/`：UI 审查报告与修复规划归档到 `doc/archive/ui-review-v1.5.0/`，`bind_device` 根因报告与 fnOS fpk 调研归档到 `doc/archive/`，v2.7.0 全字段 TOML 示例移到 `doc/design/`
  - 移除 18 张历史截图（约 1.1MB），归档报告中的图片改为文字说明
  - README 技术栈更新为 Naive UI、构建命令改为 `pnpm build`、移除已下线的快照导出说明，并补充文档入口
  - README 与 `package.json` 的 Node.js 要求同步为 Vite 7 的 `^20.19.0 || >=22.12.0`
- 清理
  - 删除无引用的 `src-tauri/icons/icon.rgba`（约 1MB）
- Rust
  - 清理 3 个 clippy 告警（`is_ok`、多余 `return`、无意义 `let _`）
  - 对 `src-tauri/src` 执行 rustfmt，统一代码排版
- 验证
  - vue-tsc、18 个测试文件 205 项用例、ESLint、Stylelint、Prettier 通过
  - `cargo clippy --all-targets` 0 告警，`cargo fmt --check` 通过

## 1.7.2 (2026-10-22)

> 修复 Web 配置运行态首帧闪变与 Windows 任务栏窗口标题回退。

- Web 配置
  - 首帧丢弃持久化运行态，进程与服务扫描完成前统一显示“检测中”，不再先显示“运行中”再跳回真实状态
  - 并发加载共享同一任务，修复加载与运行态扫描的竞态；扫描后清理过期 PID，选中项重新绑定新列表对象
  - 检测未完成时禁用启停与删除，服务状态未判定前不再误显示“未安装”
  - 浏览器 Mock 补齐 Web 进程启动参数匹配与停止逻辑
- Windows 窗口
  - 移除平台覆盖配置中的 `app.windows`：平台配置按 JSON Merge Patch 合并，数组整体替换会丢失基础窗口配置
  - 修复任务栏悬停预览标题回退为“Tauri App”，同时恢复 1000×650、minWidth 900/minHeight 600、`visible:false` 等窗口设置
- 验证
  - vue-tsc、18 个测试文件 205 项用例、ESLint 通过，浏览器 Mock 实测状态流转
  - 重新编译 dev 实例实测窗口标题为 LightTier

## 1.7.1 (2026-10-22)

> 趋势图与动效优化：固定点距右对齐、精简快照入口，并统一全应用过渡节奏。

- 趋势图
  - 横轴固定点距并右对齐，采样不足时数据只占右侧；容量随容器宽度回写，画不出的历史点不再保留
  - 时间刻度跟随真实采样点，点数过少时隐藏首/中刻度；移除快照导出入口
  - 整理趋势标题与指标行层级，与监控页其他区块保持一致
- 动效
  - 统一 150/200/280ms 三档时长与 ease-out/ease-in 曲线，新增按属性拆分的过渡令牌
  - 全项目替换 `transition: all`，移除未使用的 animate.css；修复弹窗内容瞬移
  - 语言下拉、Toast、FAB 菜单、引导页改用统一过渡
  - 配置列表启停排序、搜索过滤与删除使用 Vue TransitionGroup FLIP 过渡
- 验证
  - vue-tsc、18 个测试文件 205 项用例、stylelint、Prettier 与生产构建通过

## 1.5.0 (2026-10-21)

> 主题系统增强：外部主题支持中文显示名，并新增六套国风与现代配色。

- 主题显示名
  - 外部主题可通过 CSS 顶部的 `/* @theme-label: 中文名 */` 元数据声明显示名，未声明或为空时回退文件名
  - 文件名继续作为稳定 ID，保持 ASCII 白名单校验，不参与显示名拼接；标签仅用于界面展示
  - 新增丹青水墨、黛山、青瓷、茶烟、雾灰、极昼六套主题，原有四套外部主题补齐中文标签
- 文档
  - 更新 `THEME_GUIDE.md`：主题 ID 与显示名规则、对比度建议、模板示例
  - 新增 EasyTier v2.7.0 全字段示例配置与 `bind_device` 连接超时问题报告
- 测试
  - 新增主题显示名提取、空值回退与超长截断单测，单测增至 133 例

## 1.4.0 (2026-10-21)

> 配置表单高级开关全量化：补齐内核布尔 flags，并将当前内核不支持的存量配置项集中到只读“当前内核未兼容”栏。

- 高级开关
  - 高级选项扩充为 31 个布尔 flags，新增 `bind_device`（仅使用物理网卡）、加密、IPv6、延迟优先、多线程、打洞/中继/代理等开关
  - 开关按内核默认值显示（`bind_device`、`enable_encryption`、`enable_ipv6`、`multi_thread` 默认开启），切回默认值时不落盘冗余键
  - 按已安装内核版本过滤开关；非布尔 flags（MTU、协议、端口等）仍由“自定义 Flags”编辑
- 版本兼容
  - 配置文件中有、但当前内核不支持/已移除的 flags 与顶层字段，统一在表单末尾“当前内核未兼容”栏只读展示，默认收起
  - 这些配置项在表单保存时最后原样写回，清洗后再次补写，确保编辑过程不修改其值；`rpc_portal` 例外，仍由桌面端转 CLI 参数
- 测试
  - 新增未兼容配置项收集、锁定写回与 flags 归属测试，单测增至 130 例

## 1.3.0 (2026-10-20)

> 内核包管理优化：修复加速源测速与镜像地址，安装前清理旧内核文件，保留各版本安装包并展示下载状态。

- 加速源
  - 测速改用 Tauri plugin-http（与下载同链路），绕过 WebView CORS 预检；单源超时由 3s 调整为 8s
  - 探测目标改为所选版本的真实内核压缩包，不再请求镜像首页
  - 修复镜像下载地址遗漏 GitHub 仓库路径的问题（镜像前缀需拼接完整 GitHub URL）
  - 移除实测失效的镜像源（gh.monlor.com / down.npee.cn / ghproxy.1888866.xyz）
- 内核安装
  - 安装前保留 `resource/core` 下各版本 `.zip`，清理旧可执行文件、DLL 与下载临时文件，避免跨版本残留
  - 先完成压缩包读取与安全校验再清理旧文件；压缩包缺失、损坏或含非法条目时不会破坏现有内核
  - 安装后保留内核压缩包，设置页展示各版本“已下载”状态；未下载时禁用安装
  - 任一条目写入失败即判定安装失败，避免出现新旧版本混合运行
- 测试
  - 新增镜像 URL 拼接与内核目录清理规则测试，单测增至 124 例

## 1.2.0 (2026-10-20)

> 内核版本适配发布：配置表单、校验与服务管理按已安装内核版本切换，并修复安装包资源缺失与严格 CSP 下的内核下载问题。

- 内核版本适配
  - 固定可下载版本：v2.4.5 / v2.5.0 / v2.6.4（内置）/ v2.7.0（预发布），标注渠道与内置/已安装状态
  - 新建配置隐藏低版本不支持的字段；存量配置保留字段并给出引入版本、已移除字段与未知 flags 警告
  - 按版本校验 flags、secure_mode、VPN portal 结构；v2.7.0 的未知 flags 键与缺失必填项阻断启动
  - 内核服务安装/启停/卸载按版本切换官方 CLI 参数；rpc_portal 由桌面端转为 `--rpc-portal`
  - 切换内核版本前停止全部实例与服务并清理运行态，安装完成后重新探测版本
- 配置兼容
  - LightTier 私有退出路由标记迁移到 `[lighttier]` 表，兼容读取旧标记并在校验前自动回写
  - 修复 network_name 为空时写出空 `[network_identity]` 表导致内核解析失败
- 构建与修复
  - 恢复 `resource/core` 与 `resource/themes` 的显式打包，修复 1.1.x 安装包缺失内置内核与外部主题
  - 内核压缩包文件名改为纯字符串拼接，修复严格 CSP 拦截 lodash.template 导致下载/安装内核失效
  - 首屏加载样式改为外部样式表，避免内联 style 使 CSP 的 `unsafe-inline` 失效并波及 Monaco
  - 单测增至 117 例

## 1.1.1 (2026-10-20)

> 综合审查修复发布：安全边界收口、日志与命令链路修复、平台兼容与交互优化，无新增用户功能。

- 安全
  - 启用严格 CSP（禁内联/远程脚本），关闭 `withGlobalTauri` 并清理 `window.__TAURI__` 直用
  - fs 权限由全盘读写收窄到 resource/app 域；移除 wmic，补 whoami；新增 fs:allow-rename
  - `run_cli` / `run_command` 增加 Rust 侧白名单（仅 resource/core 下的内核与 CLI）
  - 锁屏密码改为加盐 SHA-256（`sha256$salt$hash`），启动时自动迁移旧明文
  - 下载增加协议/大小/PK 魔数校验与临时文件原子替换；解压增加路径穿越防护、容量门限与 Unix 可执行位
- 功能与可靠性
  - 内核日志统一到 `<resource>/logs` 绝对路径，日志查看、清理与出口路由恢复可用
  - `executeCmd` 以退出码为唯一成功判据；修复 Windows 单条进程结果与 Unix `ps` 文本解析
  - 配置编辑修复表单切代码模式丢失改动；密文字段掩码显示与显隐切换
  - 网卡过滤 `et*` → `et_*`，不再误排 Ethernet；Web 配置按 `--config-server` 精确匹配
  - 启动编排收敛单入口，删除不可达的 autorun 与误接线；内核安装前增加停止节点确认
  - 内置内核支持 Unix 可执行位回填；CreamDialog 增加焦点陷阱与焦点还原
- Android 与工程
  - VpnService 补前台服务与常驻通知，空 Intent 重建不再创建默认 TUN；清单补 allowBackup=false
  - gradle.properties 移除入库 JDK 路径，改由 JAVA_HOME 或用户级配置提供
  - 单测由 7 例扩充至 62 例（新增 coreLog / configForm / shell / file / lock / sys 六组）

## 1.1.0 (2026-10-09)

> 工程质量发布：集中清理历史“打补丁”式配置、恢复类型严格性、收敛权限，无新增用户功能。

- 构建与配置
  - vite.config.ts 移除 `defineModel`（Vue 3.5 默认开启）、`undefined` 占位插件、冗余 `resolve.extensions` 与无用 `/api` proxy、`hmr.overlay`
  - `.env.*` 删除未使用变量（`VITE_API_BASE_PATH` / `VITE_USE_MOCK` / `VITE_USE_ONLINE_ICON` / `VITE_HIDE_GLOBAL_SETTING`），标题统一为 LightTier
  - package.json 移除未使用依赖（`@element-plus/icons-vue`、`mitt`、`rollup`、`vite-plugin-eslint` 等）与重复脚本
  - eslint 扁平配置将 `ignores` 拆为独立全局段（修复忽略未全局生效），禁用规则补 TODO 说明
  - 启用 Cargo `[profile.release]`（`lto` / `codegen-units=1` / `opt-level=s` / `strip`），减小体积并优化产物
- 类型与代码质量
  - tsconfig 恢复 `noImplicitAny` / `strictFunctionTypes`，补全 store / utils / plugins 显式类型标注
  - `types/*.d.ts` 移除 `declare global` 内冗余 `declare`、补 `export {}` 保持模块身份、裁剪未使用全局类型
  - 删除 elementPlus 插件注释死代码（101 行）；`lib.rs` 提取公共 `log_format` 并将 `println!` 改为 `log` 宏
- 安全
  - 移除 `src/constants/easytier.ts` 中硬编码的 `COOKIE_VALUE` 密钥
  - 收敛 Tauri capabilities：移除 `fs:read-all` / `fs:write-all` / `shell:allow-execute` / `shell:allow-spawn` 等过宽权限与未使用命令白名单，删除冗余 `desktop.json`
- 工程脚本与插件
  - 新增 `src-tauri/android-env.ps1` 集中 Android 构建环境，`lt-android-*.ps1` 改为引用去重
  - vpnservice 插件移除 `ping` / `registerListener` 脚手架示例（重命名为 `register_listener`），统一 pnpm 与 `@tauri-apps/api` 版本

## 1.0.0 (2026-08-26)

- 项目独立：全新仓库与全新提交历史，保留新版控制台全部功能
  - 移除老版控制台全部代码（旧视图 / 旧布局 / 旧组件 / axios 等），不再与老版项目产生任何构建期或运行时依赖
  - 保留全部新版功能：配置管理、运行监控、Web 配置、服务安装、退出路由、内核下载、主题系统、多语言、托盘、锁屏
  - 品牌化：产品名 LightTier、全新应用图标、`com.lighttier.app` 标识符
  - 精简 store（app.ts 从 349 行减至 104 行）、依赖瘦身、locales 裁剪（仅保留 `new*` 键）
