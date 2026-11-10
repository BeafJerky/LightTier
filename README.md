# LightTier

LightTier 是一款专为 [EasyTier](https://github.com/EasyTier/EasyTier) 内核设计的可视化桌面管理器（Vue 3 + Tauri 2），提供清爽、高效的组网配置与运行监控体验。

## 功能特性

- 可视化配置管理：表单 + TOML 代码双模式编辑，支持导入/模板/高级字段（安全模式、凭据、IPv6、SOCKS5 等）
- 一键启动/停止组网：并发启动串行队列、端口冲突预检、P2P 直连通知
- 实时运行监控：节点列表、Peer 详情、NAT 类型、上传/下载/延迟趋势图（120 点环形缓冲）
- Web 配置管理：远程配置服务器（config-server）连接管理与服务化
- 服务管理：nssm / 官方 CLI 双模式安装 Windows 服务，开机自启
- 退出节点路由：启用后自动写入系统路由表，停止自动清除，异常退出残留自动补清
- 内核管理：从内置兼容列表下载/安装 EasyTier 内核（v2.4.5–v2.7.0），GitHub 镜像加速源自动测速
- 主题系统：奶油 / 暗色基础主题，内置 12 款主题（红白机、Claude、青瓷等）与用户导入主题（CSS 变量热切换，持久化）
- 多语言：简体中文 / English
- 其他：系统托盘、锁屏密码、启动自动运行、日志清理、检查更新、快捷菜单（刷新 / 检查更新 / 打开配置目录）

## 技术栈

- 前端：Vue 3.5（Composition API）+ Vite 7 + TypeScript + Pinia + vue-i18n + Naive UI
- 编辑器：Monaco Editor（TOML 代码编辑）
- 桌面端：Tauri 2（fs / dialog / http / shell / os / log / clipboard / window-state / single-instance / prevent-default 插件）
- Android：进程内内核 + `tauri-plugin-vpnservice`（本地 vendor）
- 测试：Vitest

## 文档

本仓库只包含可发布的源码与构建配置；项目规范、设计文档与历史归档不在本仓库中，也不随发布分发。

## 开发

所有命令均在本目录（仓库根）执行：

```bash
# 安装依赖
pnpm install

# 浏览器预览（Mock 模式，无需 Tauri，可体验完整 UI 流程）
pnpm dev

# 桌面端开发（Tauri）
pnpm td

# 类型检查
pnpm ts:check

# 单元测试
pnpm test
```

## 构建与打包

### 桌面端（Windows）

```bash
# 前端生产构建（两端共用产物 frontend/dist/）
pnpm build

# Windows 64 位安装包（NSIS；不带参数的 pnpm tauri:build 亦可）
pnpm build:win64
```

产物位于 `target/<target>/release/bundle/`（未指定 `--target` 时为 `target/release/bundle/`，含 NSIS `.exe` 与 MSI）。

### Android（APK）

前置环境（Windows）：

- Node 20.19+（Vite 7 要求；脚本优先使用 nvm 安装的版本，兼容 nvm-windows 1.x/2.x）
- JDK 17+（Gradle / AGP 要求；优先使用版本达标的 `JAVA_HOME`，否则探测 Android Studio 自带 jbr 与常见 JDK 安装目录）
- Android SDK Platform 36 与 NDK（工程 `compileSdk`/`targetSdk` 为 36；build-tools 自动取已安装的最高版本）、protoc，以及 Rust target：`rustup target add aarch64-linux-android`

以上组件支持用环境变量覆盖自动探测：`ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）、`ANDROID_NDK_HOME`、`JAVA_HOME`、`PROTOC`；未设置时按标准安装位置查找，找不到会直接提示缺少哪一项。

新 clone 首次打包：repack 脚本依赖 tauri CLI 生成的 Android 工程文件（`tauri.settings.gradle`、`app/tauri.build.gradle.kts` 等，均不入库且含本机绝对路径），请先执行一次官方路线生成工程：

```powershell
powershell -ExecutionPolicy Bypass -File .\android\lt-android-build.ps1
```

一键打包（推荐；脚本内已配好 NDK/JDK 环境变量、前端构建、内嵌校验与签名）：

```powershell
powershell -ExecutionPolicy Bypass -File .\android\lt-android-repack.ps1
```

管线：`pnpm build` → `cargo build --release --target aarch64-linux-android --features custom-protocol` → 复制 `.so` 到 `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a`（生产模式防回归校验）→ Gradle `assembleArm64Release`（`-x rustBuildArm64Release`）→ `apksigner` 签名（`~/.android/debug.keystore`，缺失时自动生成）。

产物：`src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-signed.apk`，安装：

```powershell
adb install -r "src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-signed.apk"
```

辅助脚本（均在 `android/` 下）：`lt-android-check.ps1`（cargo check 快速验证）、`lt-android-gradle.ps1`（已有 `.so` 后单独跑 Gradle）、`lt-android-build.ps1`（官方 `pnpm tauri android build` 路线，需 Windows 开发者模式/symlink 权限）。

### 双端一键打包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\lt-repack-all.ps1
```

串行执行「先桌面后 Android」：任一步失败即中止并指向对应日志；全部完成后汇总输出两端产物路径、大小与时间戳。

### 打包经验与注意事项

1. **桌面与 Android 必须串行打包，不能并行**：两者共用前端 `frontend/dist/`（各自都会重建）与 workspace 的 `target/`（cargo 构建目录锁），并行存在资源竞态且实际会互相排队等待；建议先桌面后安卓依次执行。
2. **Android 的 cargo 构建必须带 `--features custom-protocol`**：漏掉会内嵌 dev 资源，真机白屏并报 `Failed to request http://localhost:4000/`。repack 脚本已内置防回归校验（检查 `.so` 无该错误串、且内嵌 `index-*.css` 与 `frontend/dist/` 一致，输出 `production mode OK`）。
3. **capability / 权限改动需重新编译 Rust**：ACL 是编译期内嵌的（如 `capabilities/mobile.json` 的 `vpnservice:allow-registerListener`），只改 JSON 不重编不会生效。
4. **前端改动后必须重跑打包**：若 `jniLibs` 中 `.so` 的时间戳早于 `frontend/dist/`，说明内嵌的是旧前端，需重新执行打包。
5. **`lt-*.ps1` 保持 UTF-8 BOM + CRLF**：脚本含中文注释，编辑后需按 UTF-8 BOM 重存并用 Windows PowerShell 5.1 预检语法，避免解析乱码失败。
6. **发版前校验**：用 `apksigner verify --print-certs` 确认签名，并确认安装包/APK 时间戳为最新一次构建产物。

## 目录结构

```
.                            # 仓库根
├── frontend/                # 前端工程（Vite root）
│   └── src/
│       ├── app/             # 启动入口、路由、主布局、全局样式与 provider
│       ├── features/        # 功能切片：instances / configs / web-configs / settings / themes
│       ├── entities/        # 领域类型与纯规则：config / kernel / types
│       └── shared/          # 通用能力：ui / lib / i18n / constants / composables / platform / store
├── src-tauri/               # Tauri 应用壳（命令注册、capability、gen/android）
│   └── src/commands/        # #[tauri::command] 薄包装：process / system / update
├── crates/                  # Cargo workspace 成员（实现层）
│   ├── core/                # lighttier-core：日志、端口检测、外链
│   ├── desktop/             # lighttier-desktop：进程/服务、更新安装（仅桌面 target）
│   └── android/             # lighttier-android：进程内内核 instance / rpc / vpn（仅 Android target）
├── android/                 # Android 打包脚本 + tauri-plugin-vpnservice 本地 vendor
├── scripts/                 # 双端打包与 nightly 发布脚本
└── target/                  # Cargo workspace 构建产物（含桌面安装包 bundle/）
```

Rust 依赖方向：`src-tauri → crates/{core,desktop,android}`；`crates/*` 之间不互相依赖。`tauri::generate_handler!` 仍在 `src-tauri` 中注册薄包装命令，跨 crate 只方法调用。

前端依赖方向单向：`app → features → entities/shared`；feature 之间禁止互相 import，`entities/shared` 不得反向依赖 `app/features`（ESLint `no-restricted-imports` 强制）。

## 环境要求

- Node.js 20.19+（Vite 7 要求），pnpm >= 8
- Rust 1.92+（`src-tauri/Cargo.toml` 的 `rust-version`；构建桌面端时需要）
- Windows 10/11（服务安装、退出路由等能力依赖 Windows）
- Android 打包：Android SDK + NDK、JDK 17+、protoc、Rust `aarch64-linux-android` target（详见「构建与打包」）

## 致谢

- [EasyTier](https://github.com/EasyTier/EasyTier)：本项目管理与调用的内核 `easytier-core`、命令行工具 `easytier-cli` 均来自该项目，谨此致谢。
- [easytier-manager](https://github.com/xlc520/easytier-manager)：早期产品形态与交互设计参考了该项目，谨此致谢。

## License

[AGPL-3.0](LICENSE)。
