# Changelog

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
