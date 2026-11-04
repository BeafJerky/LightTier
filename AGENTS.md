# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## 仓库定位

本目录即 LightTier 源码仓库根：只包含可发布的源码与构建配置，项目文档、设计与个人笔记不在本仓库内，也不随发布分发。所有 `pnpm` / `cargo` 命令都在本目录执行。默认分支为 `main`。

## 项目概览

LightTier 是 Vue 3.5 + Tauri 2 的 EasyTier 内核可视化桌面管理器。包管理器为 **pnpm**（勿用 npm/yarn）。Rust 后端以 Windows 桌面为主，macOS/Linux 分支保留但未经实机验证；Android 走进程内内核（`crates/android`）。

## 命令

- `pnpm dev`：浏览器预览（vite --mode base），**Mock 模式**——浏览器中无 Tauri API，Tauri 调用需经 `isTauri()`（@tauri-apps/api/core）检测降级（见 frontend/src/shared/platform/mockData.ts）。新增依赖 Tauri API 的功能必须提供浏览器 mock 实现，否则 `pnpm dev` 会崩。
- `pnpm td`：Tauri 桌面开发（需 Rust 工具链）。
- `pnpm ts:check`：vue-tsc 类型检查（`tsc` 检查不到 .vue 文件）。
- `pnpm test`：vitest（测试与模块同目录，位于 `frontend/src/**/__tests__/`）。
- 打包：`pnpm build:win64`（NSIS+MSI，产物在 `target/release/bundle/`）；Android 用 `powershell -ExecutionPolicy Bypass -File .\android\lt-android-repack.ps1`（新 clone 需先跑一次 `android\lt-android-build.ps1` 生成不入库的 Tauri Android 工程文件）；双端 `scripts/lt-repack-all.ps1`。桌面与 Android 共用 `frontend/dist/` 与 `target/`，必须串行。
- Android 环境由 `android/android-env.ps1` 自动探测（SDK/NDK/JDK/protoc），可用 `ANDROID_HOME`、`ANDROID_NDK_HOME`、`JAVA_HOME`、`PROTOC` 覆盖；Node 由 `scripts/lt-node-env.ps1` 优先取 nvm 安装版本。不要在脚本里写死本机路径或版本号。

## 项目结构

`frontend/src/` 按功能切片分层：`app/`（启动、路由、布局、全局资源）→ `features/`（instances、configs、web-configs、settings、themes）→ `entities/`（领域类型与纯规则）+ `shared/`（ui、lib、i18n、constants、composables、platform、store）。依赖单向：feature 之间禁止互相 import；`shared/**` 与 `entities/**` 不得反向依赖 `app/` 或 `features/`（ESLint `no-restricted-imports` 强制）。

Rust 侧为 Cargo workspace（根清单 `Cargo.toml`）：`src-tauri/` 是 Tauri 应用壳，`src/commands/` 只保留 `#[tauri::command]` 薄包装并在 `lib.rs` 统一注册；实现位于 `crates/core`（lighttier-core：日志/端口/外链）、`crates/desktop`（lighttier-desktop：进程与更新安装，桌面 target）、`crates/android`（lighttier-android：进程内内核 instance/rpc/vpn，Android target）。依赖方向 `src-tauri → crates/*`，crates 之间不互相依赖；新增命令时同步更新 `lib.rs` 注册列表与 capability 声明。

Tauri CLI 固定读取 `src-tauri`（含 `gen/android`），前端产物入口为 `frontendDist: "../frontend/dist"`，不要改名或外移 `src-tauri`。

## 项目特定约定

- 所有用户可见文案必须走 i18n：同时更新 frontend/src/shared/i18n/locales/zh-CN.ts 与 en.ts，禁止硬编码。
- 桌面内核安装包不再随应用内置，`src-tauri/resource/core/` 由设置页按需下载生成；构建配置不要恢复 `resource/core/*` 资源通配符（内核版本列表见 frontend/src/entities/kernel/kernelCompat.ts）。
- frontend/src/shared/platform/fileUtil.ts 的 Tauri 文件操作基于 `BaseDirectory.Resource`：只传相对路径，禁止用 resourceDir() 拼绝对路径。
- 新增 Tauri API/插件调用需同步在 src-tauri/capabilities/default.json（移动端见 mobile.json）声明权限，否则运行时报错。
- frontend/src/shared/constants/easytier.ts 中 MANAGER_REPO_URL / MANAGER_INFO_API 指向 BeafJerky/LightTier 发布仓库（“检查更新”用），在 GitHub 发布 Release 后生效。
- 全局样式位于 frontend/src/app/styles/，由 frontend/src/app/main.ts 显式引入；不存在自动注入的 less 变量文件。
- monaco-editor 强制独立 chunk（manualChunks），勿拆勿改，避免循环依赖。

## 提交规范

husky + commitlint 强制 Conventional Commits；type 含自定义项：`workflow`、`mod`、`types`、`release`、`wip`。pre-commit 自动运行 `pnpm run ts:check` 与 lint-staged（eslint / prettier / stylelint 自动修复）。
