# LightTier UI/UX 修复规划（不含对比度）

> [已归档 2026-10-22] 26 项修复均已在后续版本落地；配套审查报告保留于本目录。

> 依据：[`UI-UX-审查报告.md`](./UI-UX-审查报告.md)，2026-10-21。范围：报告中的 26 个非对比度问题（P0 3 项、P1 9 项、P2 9 项、P3 5 项）。 **实施状态（2026-10-21）**：26 项均已在当前工作区落地，UX-102（对比度）按约定排除。验证结果见第 0 节；尚未提交/发版。

## 0. 实施状态

| 批次 | 问题 | 状态 | 主要落点 |
| --- | --- | --- | --- |
| 1 | UX-001 / 002 / 003 | 已完成 | CreamDialog 关闭守卫、脏检查与放弃确认、TOML 实时校验、写盘成功后关闭、缓存白名单与 `.bak` 备份 |
| 2 | UX-101 / 108 / 303 | 已完成 | 配置详情与监控显式状态机、失败重试与过期提示、数字输入保留并报错 |
| 3 | UX-103 / 104 / 302 | 已完成 | 原生 checkbox/radio/select/button、label/id、tab/tabpanel 语义、删除按钮无障碍名与命中区 |
| 4 | UX-107 / 204 | 已完成 | 锁屏双输确认与显式提交、引导 dialog 语义/焦点圈定/圆点按钮化 |
| 5 | UX-105 / 106 / 109 / 203 | 已完成 | 设置 inline 透传、细滚动条与 FAB 避让、详情头部自然换行、窗口最小尺寸、统计卡 2×2 与 nowrap |
| 6 | UX-110 / 205 | 已完成 | 运行/停止单一上下文主操作、窗口最小化/最大化/还原/关闭、双击拖拽条、Tauri 权限 |
| 7 | UX-206 / 207 / 208 | 已完成 | 空态 CTA 与 `?create=1` 直达新建、Tauri API 初始化守卫、检查更新启用与三态处理（10s 超时） |
| 8 | UX-201 / 202 / 209 / 301 / 304 / 305 | 已完成 | 字号下限、趋势图轴/单位/15 分钟/aria、搜索与运行中优先稳定排序、PID 空格、命名统一、FAB 可见性与键盘焦点 |

**验证记录**：

- 最后一轮修改后重新执行：`pnpm ts:check` 通过；`pnpm test` 15 个测试文件、138 项全部通过；`pnpm build` 成功。
- 浏览器 Mock（2560×1215 桌面与 390×844 窄屏，中/英）：总览、配置、Web 配置、监控、设置、编辑/新增、空态与搜索无结果均已实测；无未捕获错误。最终复验在桌面视口完成路由切换与设置弹窗打开，控制台零警告/错误，Vue 路由 `class=""` 警告与浏览器 Mock 下内核路径探测报错均已消除。
- 检查更新实测：浏览器 Mock 下 GitHub API 成功返回并显示 `v1.5.0 / 当前已是最新版本`；断网错误态显示“检查更新失败，请检查网络”，入口可重试。桌面端走 plugin-http 的分支仅通过类型检查与前端构建，未在本次会话启动 Tauri 实机；Android 真机/模拟器未运行。
- 窗口按钮拖拽/双击最大化、Android 物理返回键、只读目录保存失败、`.bak` 内容校验仍需在 Tauri/Android 环境按 6.2–6.4 手工矩阵复验。

## 1. 范围与原则

### 1.1 纳入与排除

| 范围 | 内容 |
| --- | --- |
| 纳入 | 数据安全、状态真实性、无障碍、响应式、术语与操作层级、空态、平台差异、字号与图表信息、搜索排序等交互与布局问题 |
| 排除 | UX-102 及所有“只改颜色值/对比度即可解决”的样式项；不修改 `src/styles/theme.css` 中的颜色 token |
| 例外 | UX-202 只做坐标轴、单位、时间范围、aria 与字号，不调整导出按钮颜色对比度；UX-305 提高 FAB 常态可见度属于层级问题，保留；UX-110 的禁用按钮视觉层级保留 |
| 不做 | 整体视觉改版、引入图表库、重写路由或状态管理、调整 EasyTier 内核行为 |

### 1.2 审查复核修正

实施前先修正报告中的两处事实偏差，避免按错误前提改代码：

1. **UX-305“重复刷新入口”不成立。** 截图 02 中的“刷新配置”是全局 FAB 展开后的菜单项；日志面板里的“刷新”是 `LogViewer` 的日志刷新（`newConfig.logRefresh`），两者作用域不同。不要删除任何一个入口，只做 FAB 可见性与命名区分。
2. **趋势图时间窗口是 15 分钟，不是 1 小时。** `src/hooks/useTrendBuffer.ts` 的 `TREND_WINDOW_MS = 15 * 60 * 1000`，图表文案与 aria 必须写“近 15 分钟”。

### 1.3 修复原则

- **先保数据，再谈观感。** P0 的未保存保护、TOML 校验、缓存误清必须最先落地。
- **原生语义优先。** 能用 `input/select/button/label` 解决的不再手写 `div + click`；这样键盘、读屏、焦点环一次性达标。
- **最小改动。** 不重排页面结构，只在现有断点、现有组件和现有 token 上补状态与语义。
- **平台一致。** 桌面弹窗与 Android 二级页共用同一套脏检查、保存与备份逻辑；浏览器 Mock 不得被 Tauri API 打断。
- **文案双语言。** 所有新增文案同步 `src/locales/zh-CN.ts` 与 `src/locales/en.ts`，禁止硬编码。
- **可独立回滚。** 按批次拆 PR，每批都能单独构建、单独验收。

## 2. 总体方案

### 2.1 问题与批次总览

| 编号 | 问题 | 优先级 | 批次 | 核心改法 |
| --- | --- | --- | --- | --- |
| UX-001 | 编辑配置无未保存保护 | P0 | 1 | CreamDialog 关闭守卫 + 脏检查 + 放弃确认；Android 路由守卫 |
| UX-002 | 清除缓存清空全部 localStorage | P0 | 1 | 白名单清理工具，只清 STUN/公共节点缓存 |
| UX-003 | 非法 TOML 仍可保存 | P0 | 1 | 实时校验、保存阻断、表单解析失败阻断、写盘成功后再关闭 |
| UX-101 | 详情读取失败静默展示演示数据 | P1 | 2 | 详情状态机；Mock 标“演示数据”，Tauri 显示错误与重试 |
| UX-108 | 监控空态与失败态误导 | P1 | 2 | 区分无配置/无运行实例/拉取失败；保留最后数据 + 过期提示 + 重试 |
| UX-303 | 数字输入越界静默重置 | P3 | 2 | 保留输入、显示错误、失焦校验，不再静默 clamp |
| UX-103 | 伪按钮广泛存在 | P1 | 3 | 原生 checkbox/radio/select/button，补焦点环 |
| UX-104 | 表单控件缺标签与 Tab 语义 | P1 | 3 | label/id、aria-label、tablist/tab/tabpanel |
| UX-302 | 删除按钮无无障碍名称 | P3 | 3 | aria-label、title、32px 命中区 |
| UX-107 | 锁屏密码失焦即生效、无确认 | P1 | 4 | 两次输入、长度校验、显式按钮、toast；锁屏 aria |
| UX-204 | 引导持久化与无障碍不完整 | P2 | 4 | dialog 语义 + 焦点圈定；圆点按钮化；默认勾选；安装步骤不跳过 |
| UX-105 | 移动设置页 inline 失效且只显示一个分类 | P1 | 5 | 透传 inline；修正横向 tab 的 `width:100%` |
| UX-106 | 隐藏滚动条 + FAB 无避让 | P1 | 5 | 恢复细滚动条；内容底部留出 FAB 安全区 |
| UX-109 | 1000×650 详情头部被挤压 | P1 | 5 | 头部自然换行；窗口最小尺寸 900×600 |
| UX-203 | 手机统计卡数值换行 | P2 | 5 | 2×2 网格 + 数值 nowrap；Web 表单单列 |
| UX-110 | 操作层级反转、术语不统一 | P1 | 6 | 统一“运行/停止”；每处一个上下文主操作；服务/窗口术语分义 |
| UX-205 | 窗口栏只有关闭、无最小尺寸 | P2 | 6 | 最小化/最大化/关闭 + 双击拖拽条；补 Tauri 权限与 min 尺寸 |
| UX-206 | 空态缺下一步行动 | P2 | 7 | 空态 CTA；引导结束直达新建首个配置 |
| UX-207 | 浏览器 Mock 初始化被托盘 API 中断 | P2 | 7 | `isTauri()` 包裹托盘/窗口/文件初始化 |
| UX-208 | 检查更新被永久关闭 | P2 | 7 | 打开开关并验证有更新/无更新/网络失败三态 |
| UX-201 | 次要文字与元数据过小 | P2 | 8 | 字号下限：正文 13、辅助 12、元数据 ≥11 |
| UX-202 | 趋势图缺轴、单位、时间与 aria | P2 | 8 | 左右纵轴 + 时间轴 + 15 分钟标识 + aria 摘要 |
| UX-209 | 配置列表无搜索/排序 | P2 | 8 | 搜索框 + 运行中优先排序 + 无匹配空态 |
| UX-301 | PID 文案缺空格 | P3 | 8 | 统一 `PID {{ pid }}` |
| UX-304 | 命名不统一 | P3 | 8 | “全局”→“总览”；清理装饰前缀与重复标题 |
| UX-305 | FAB 常态可见性低 | P3 | 8 | 常态 opacity 0.65；aria-label / expanded / 焦点环；不删刷新入口 |

### 2.2 共享基础改造（先于功能批次）

这五项会被多个问题复用，建议作为第一批 PR 的“公共部分”一次完成。

#### A. CreamDialog 关闭协议（服务 UX-001/003/204）

文件：`src/components/CreamDialog/index.vue`

- 新增 prop `beforeClose?: () => boolean | Promise<boolean>`；返回 `false` 时取消关闭。
- 新增内部 `closing` 标志，防止异步守卫期间重复触发。
- 把遮罩点击、Esc、标题栏关闭统一改为调用 `requestClose()`；`requestClose` 先执行 `beforeClose`，通过后再置 `visible = false`。
- `requestClose` 通过 `defineExpose` 暴露给父组件，供底部“取消”按钮调用。
- **Android 底部面板**：`sheetEntry.close`（物理返回键）也必须走 `requestClose`，不能直接 `visible = false`。若用户取消关闭，需要补回被系统弹出的 history 条目，避免“返回键保护”失效。
- 明确约定：父组件不得在未确认的情况下直接把 `v-model` 置 `false`；所有 UI 关闭路径必须走 `requestClose`。

#### B. 脏检查与放弃确认（服务 UX-001/003）

- 不用“监听整个表单深度变化”做脏检查，避免打开时默认值回填误判。
- 在编辑内容外层监听 `@input` / `@change`，并在代码编辑器 `@update:modelValue`、模板应用、TOML 导入、模式切换等程序化改动处显式 `markDirty()`。
- 打开时重置 `dirty=false`；保存成功后重置。
- 脏状态下关闭：弹出二次确认（CreamDialog，380px），确认放弃后再关闭；取消则停留。
- **保存时序**：当前 `EditDialog` / `WebConfigForm` 都是先 emit `saved` 再立即关闭，父组件异步写盘失败时用户修改已经丢失。改为“写盘结果回调后再关闭”：`saved` 事件附带 `done(ok: boolean)` 回调，或由父组件通过 ref 通知保存结果；失败时保持弹窗与内容不变。

#### C. 原生控件规范（服务 UX-103/104/302）

- 开关：`<label><input type="checkbox"><span class="slider"></span><span>文案</span></label>`。输入可视觉隐藏，但必须可聚焦；用 `input:focus-visible + .slider` 画焦点环，焦点环颜色沿用现有 `--theme-accent-primary`，不新增颜色值。
- 单选：原生 `input[type=radio]` + `label`，用 `v-model` 绑定；不再用 `label @click` 改值。
- 下拉：单选场景优先原生 `<select>`；若保留自定义触发器，则触发器补 `aria-haspopup="listbox"`、`aria-expanded`，选项改 `button[role=option]` 并支持 Up/Down/Enter/Esc。
- 删除图标：必须是有 `aria-label` 的 `<button type="button">`，命中区不小于 32×32。
- 新增全局 `.lt-sr-only` 工具类（`src/styles/index.less`），用于只读屏可见的标签。

#### D. 显式数据状态（服务 UX-101/108/202）

- 配置详情：`idle | loading | ready | demo | error`，错误对象包含 `kind: read | parse` 与原始消息。
- 监控：`idle | loading | ready | stale | error`，记录 `lastSuccessAt`，失败时不再清空 `selectedData`。
- 空态判断顺序固定为：无配置 → 无运行实例 → 有实例但数据未到。禁止用同一个 `noConfig` 文案覆盖三种情况。
- 所有错误/过期提示使用 `role="alert"` 或 `aria-live="polite"`。

#### E. 缓存白名单（服务 UX-002）

新增 `src/utils/cacheUtil.ts`：

```ts
export const APP_CACHE_KEYS = ['stunServerList', 'publicPeerList'] as const

export const clearAppCache = (storage: Storage = window.localStorage): void => {
  for (const key of APP_CACHE_KEYS) storage.removeItem(key)
}
```

- 只清远端可再取的临时数据；`easytier`、`app`、`tray`、`theme`、语言、锁屏密码、引导状态、`settings.*`、`runningList`、`lastRunConfigName`、`lastSelectedConfig` 一律保留。
- `mirror-source` 是用户/自动选择结果，不视为临时缓存，保留。
- 不清空后 `location.reload()`；清完直接 toast 成功。
- 单测覆盖：无关键保留、目标键删除、空存储不抛错。

## 3. 分批实施

### 批次 1：数据安全（P0）

#### UX-001 编辑配置无未保存保护

**改动文件**

- `src/components/CreamDialog/index.vue`
- `src/views/new/config-view/EditDialog.vue`
- `src/views/new/config-view/index.vue`
- `src/views/new/config-edit-view/index.vue`
- `src/views/new/web-config-view/WebConfigForm.vue`
- `src/views/new/web-config-view/index.vue`

**实施要点**

1. 按共享基础 A/B 落地 `beforeClose`、`requestClose`、`dirty`。
2. `EditDialog`：
   - 底部“取消”改为 `dialogRef.requestClose()`。
   - `beforeClose`：无修改直接关；有修改弹“放弃未保存的修改？”。
   - `:close-on-overlay` 保持 true，但同样经过守卫；避免用户误点遮罩直接丢内容。
   - 保存成功后先重置 `dirty`，再由写盘结果关闭。
3. `WebConfigForm`：同样增加脏检查与放弃确认；取消按钮走 `requestClose`。
4. Android `config-edit-view`：
   - `EditDialog` 通过 `defineExpose({ isDirty, requestClose, confirmDiscard })` 暴露状态；`confirmDiscard()` 复用编辑弹窗自身的“放弃未保存修改”确认框，避免再写一套。
   - 页面增加 `onBeforeRouteLeave`：脏状态下 `await editRef.confirmDiscard()`，确认后才允许离开；保存成功时先置 `dirty=false` 再回退。
   - 物理返回键、页面返回按钮都经过同一守卫。
5. 写盘前备份：
   - `config-view/index.vue` 的 `handleSaved` 与 `config-edit-view` 的 `handleSaved`，在编辑模式覆盖前读取旧内容并写入 `${fileName}.bak`。
   - 备份失败则中止保存并提示；新增模式不需要备份。
   - `.bak` 不匹配 `.toml` 列表过滤，不会出现在配置列表中；实现后确认 `listTomlFiles` 只取 `.toml`。
6. `saved` 事件改为带结果回调，父组件写盘成功后回调 `true`，失败回调 `false`；失败时弹窗不关闭、内容不丢。

**验收**

- Esc、遮罩、关闭按钮、取消按钮、Android 返回键，在有修改时都会提示。
- 保存失败时弹窗仍打开，原内容仍在。
- 覆盖保存后同目录存在 `.bak`，内容为上一版。
- 保存成功后再次打开不残留脏状态。

#### UX-002 清除缓存实际清空全部 localStorage

**改动文件**

- 新增 `src/utils/cacheUtil.ts`
- 新增 `src/utils/__tests__/cacheUtil.test.ts`
- `src/components/SettingsDialog/index.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 按共享基础 E 实现白名单。
2. 设置页按钮文案改为“清除临时缓存”，确认文案明确列出只清 STUN 与公共节点缓存。
3. 成功提示“临时缓存已清除”；不刷新页面。
4. 同步清理内存中的 `easyTierStore.stunServerList` / `publicPeerList`（如 store 提供刷新方法则调用；否则下一次加载自然重取）。
5. 保留 `useStorage.clear` API 不动，但不再用于该按钮。

**验收**

- 清除后锁屏密码、主题、语言、自动运行设置、引导状态、运行记录全部保留。
- 单元测试通过。

#### UX-003 非法 TOML 仍可保存

**改动文件**

- `src/views/new/config-view/EditDialog.vue`
- `src/utils/easyTierUtil.ts`（如需要统一解析错误结构）
- 新增/扩展 `src/utils/__tests__/` 下的 TOML 校验测试

**实施要点**

1. 代码模式实时校验：对 `tomlContent` 做 300ms 防抖 `toml.parse`，得到 `codeError: { line, column, message }`。
2. 编辑器上方显示错误条：`TOML 语法错误：第 X 行第 Y 列`；有错误时保存按钮禁用，但保留输入。
3. `handleSave` 移除 `catch { /* 解析失败按原样保存 */ }`。解析失败时：
   - 设置错误、聚焦编辑器、`return`；
   - 不 emit `saved`，不关闭。
4. 表单模式：
   - `switchToForm` 解析失败时**不进入表单**，停留代码模式并显示错误；避免“空表单保存后覆盖原文件”。
   - 保存前断言 `formParsedOk === true`；不满足则阻断并提示。
5. 从文件导入 TOML 时沿用现有 `toml.parse` 校验，并标记脏状态。
6. `normalizeToml` 若抛错，同样阻断并提示，不落盘。

**验收**

- 输入 `foo = [` 等非法内容，保存按钮禁用，无法写盘。
- 在非法代码状态下切表单被阻止，原文件不受影响。
- 修复语法后错误条消失，保存成功。

### 批次 2：状态真实性

#### UX-101 详情读取失败静默展示演示数据

**改动文件**

- `src/views/new/config-view/index.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 增加 `detailState` 与 `detailError`；`selectConfig` 开始时先置 `loading` 并清空旧详情，避免失败后仍显示上一个配置。
2. 读取/解析失败：
   - 浏览器 Mock（`!item.fileName && !isTauri()`）→ `demo`，正常显示演示数据；
   - Tauri 环境 → `error`，显示错误面板：原因、重试、打开配置目录（桌面）。
3. 详情头部在 `demo` 状态显示“演示数据”徽标；Tauri 错误态绝不展示演示数据。
4. 打开配置目录复用 `openPath` / 现有目录工具；Android 不提供该按钮。
5. 读取成功但内容为空也归入 `error`，不要保留旧详情。

**验收**

- 浏览器 Mock 下明确标“演示数据”。
- Tauri 下重命名/删除配置文件后，详情显示错误与重试，不显示东京/新加坡演示内容。
- 重试能恢复；切换配置不会串数据。

#### UX-108 监控空态与失败态具有误导性

**改动文件**

- `src/views/new/monitor/index.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 空态分流：
   - `configList` 为空 → “暂无配置” + “新建配置” CTA；
   - 有配置但没有运行实例 → “暂无运行中的配置” + “去配置页” CTA；
   - 有运行实例但首帧未到 → 骨架/加载态，不显示“暂无配置”。
2. 轮询失败：
   - 前两次失败保留最后数据，显示轻量“正在重试”状态；
   - 连续 3 次失败停止轮询，但**不清空 `selectedData`**，显示“数据可能已过期，上次更新 HH:mm” + “重试”按钮；
   - 若从未成功过，显示错误态与重试。
   - `retry` 重置失败计数并重新 `startPolling`。
3. 停止实例、切换配置、返回列表时才清空详情。
4. 过期/错误提示加 `role="alert"`；重试按钮可键盘操作。
5. 空态 CTA 路由：`/new/config`；Android 新建可直接去 `/new/config-add`。

**验收**

- 无配置、无运行实例、拉取失败三种画面文案与按钮不同。
- 断开内核/CLI 后最后数据仍在，有过期提示和重试。
- 恢复后数据继续刷新。

#### UX-303 输入越界静默重置

**改动文件**

- `src/components/SettingsDialog/index.vue`
- `src/views/new/web-config-view/WebConfigForm.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 刷新间隔：
   - 用本地 `refreshInput` 承接输入，`@input` 只更新文本，不再逐键 `clampNumber`；
   - 失焦/回车时校验 1–60 的整数；非法时保留输入并在字段下方显示错误；
   - 合法时才写回 store。
2. Web 端口：
   - 增加 `portError`；非整数或超出 1–65535 时显示错误，不把 22020 静默写回；
   - 保存被阻断，直到修正。
3. 错误文案加 `role="alert"`，输入加 `aria-invalid` 与 `aria-describedby`。
4. 其余数字输入做一次全量搜索，确保没有新的 `clampNumber` 路径。

**验收**

- 输入 0、61、空值、字母时能看见原因，值不会被悄悄改掉。
- 修正后可正常保存。

### 批次 3：无障碍控件

#### UX-103 伪按钮广泛存在

**改动文件**

- `src/components/ThemeDialog/index.vue`
- `src/components/SettingsDialog/index.vue`
- `src/views/new/config-view/EditDialog.vue`
- `src/views/new/web-config-view/index.vue`
- `src/views/new/web-config-view/WebConfigForm.vue`
- `src/components/OnboardingGuide/index.vue`
- `src/styles/index.less`

**实施要点**

1. 主题列表：`div.td-item` → 原生 radio + label（`role="radiogroup"` 可省略，原生 radio 自带分组）；加 `:focus-visible` 可见焦点环；选中由 `v-model`/`@change` 驱动。
2. 设置页自定义下拉：服务方式、自动运行配置、内核版本改用原生 `<select>`；镜像源改为原生 radio 列表（保留延迟徽标）。若保留自定义下拉，必须补齐 listbox 键盘与 aria。
3. 编辑弹窗：
   - 模板选项 `div` → 原生 `<select>` 或 `button[role=option]`；
   - DHCP、高级开关、安全模式开关 → 原生 checkbox + label；
   - 删除按钮见 UX-302。
4. 服务安装方式：`label @click` → 原生 radio + `v-model`。
5. 控制台地址：`span @click` → `<button type="button" class="nwc-link">` 或带 `href` 的 `<a>`，保留 `openConsoleUrl` 行为。
6. 引导圆点：`span` → `<button type="button">`，视觉圆点放到内部 `span`，命中区 ≥24×24（建议 32）；补 `aria-label="第 N 步"` 与 `aria-current="step"`。
7. 所有自定义可交互元素补 `:focus-visible` 样式，使用现有 `--theme-accent-primary`；不新增颜色 token。

**验收**

- 仅用 Tab/Shift+Tab/Enter/Space/方向键可完成主题选择、开关切换、下拉选择、安装方式选择、打开控制台、引导跳步。
- 每个可交互元素都有可见焦点环，明暗主题下均可辨认。

#### UX-104 表单控件缺标签与 Tab 语义

**改动文件**

- `src/components/SettingsDialog/index.vue`
- `src/views/new/config-view/EditDialog.vue`
- `src/views/new/web-config-view/WebConfigForm.vue`
- `src/views/new/web-config-view/index.vue`
- `src/App.vue`（锁屏部分与 UX-107 一起）

**实施要点**

1. 设置分类：
   - 导航 `role="tablist"`（`aria-orientation="vertical"`）；
   - 按钮 `role="tab"`、`aria-selected`、`aria-controls`、roving `tabindex`；
   - 内容 `role="tabpanel"`、`aria-labelledby`；
   - 支持 Up/Down/Home/End 移动并激活。
2. 编辑弹窗的“代码编辑/表单编辑”也按 tab/tabpanel 处理。
3. 静态表单字段：用 Vue 3.5 `useId()` 生成 id，`label for` 与输入 `id` 对应。
4. 动态数组输入（监听/对端/路由/出口/flag）：没有独立 label，给每个输入 `:aria-label="`${字段名} ${index + 1}`"`。
5. 设置页刷新间隔、自动运行配置、服务方式、内核版本、镜像源、锁屏密码输入补可访问名称。
6. WebConfigForm 全部 `label` 与 `select/input` 建立关联；服务安装弹窗同样处理。
7. 错误文案统一 `role="alert"`，输入框 `aria-invalid` + `aria-describedby`。

**验收**

- 读屏可正确播报每个输入的名称、当前值与错误。
- 设置分类可用方向键切换，不依赖鼠标。

#### UX-302 图标删除按钮无无障碍名称

**改动文件**

- `src/views/new/config-view/EditDialog.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 五个 `✕` 按钮补 `type="button"`、`title`、`:aria-label`，分别描述删除对象：监听地址、对端、路由、出口节点、自定义参数。
2. 新增 i18n 键 `newEdit.removeItem`（`删除{label}` / `Remove {label}`），复用字段名。
3. `.ed-tag-del` 命中区从当前小尺寸提升到 32×32，视觉图标大小不变。
4. 焦点环沿用现有样式。

**验收**

- Tab 到删除按钮时读屏播报“删除监听地址”等，不再读成乘号。
- 触控命中区 ≥32px。

### 批次 4：密码与引导

#### UX-107 锁屏密码失焦即生效、无确认、无反馈

**改动文件**

- `src/components/SettingsDialog/index.vue`
- `src/App.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 设置页两种状态：
   - 未设置：显示“新密码”“确认密码”两个输入 + “设置密码”按钮；
   - 已设置：显示状态 + “修改密码”（展开同样的两个输入）+ “清除”。
2. 校验：非空、至少 6 位、两次一致；错误就地展示并 `role="alert"`；成功 toast。
3. 移除 `@blur="commitLockPassword"`，只在显式按钮/表单回车时提交。
4. “清除”复用 `showConfirm`，确认后清除并 toast；不再直接生效。
5. 锁屏页：
   - 密码输入补 `aria-label`（或视觉隐藏 label）与 `autocomplete="current-password"`；
   - 错误信息 `role="alert"`；
   - 解锁失败时保持焦点并选中输入内容；
   - 空密码时禁用解锁按钮。
6. 输入框增加 `autocomplete="new-password"`（设置新密码时）以兼容密码管理器。

**验收**

- 输入后失焦不再自动保存。
- 两次不一致、少于 6 位都有明确提示。
- 设置/修改/清除均有 toast；清除需确认。
- 锁屏错误可被读屏播报。

#### UX-204 引导流程的持久化与无障碍不完整

**改动文件**

- `src/components/OnboardingGuide/index.vue`
- `src/App.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 覆盖层补 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`；打开时聚焦卡片，Tab 圈定在引导内，结束后还原焦点。
2. 圆点改按钮（见 UX-103）；只允许在 1–3 步之间跳转，第 4 步必须经“安装/跳过”到达，避免绕过安装决策。
3. 桌面第 3 步隐藏通用“下一步”，只保留“安装核心/跳过安装”；Android 无安装步骤，可保留“下一步”。
4. “下次不再显示”默认勾选；结束时按勾选状态持久化（未勾选仍每次显示）。
5. 完成页增加主 CTA：
   - 若没有配置，点击“创建第一个配置”跳转 `/new/config?create=1`；
   - Android 跳 `/new/config-add`；
   - 没有配置时引导结束也可自动跳转，避免用户停在空总览。
6. 引导内所有按钮使用原生 `button`，保留现有视觉。

**验收**

- 键盘可完成 4 步，焦点不逃逸。
- 默认勾选后完成引导，重启不再出现；取消勾选则再次出现。
- 第 3 步不能靠“下一步”跳过安装。
- 引导结束能直接进入新建配置。

### 批次 5：响应式与滚动

#### UX-105 移动端设置页 inline 失效，且只能看到第一个分类

**改动文件**

- `src/components/SettingsDialog/index.vue`
- `src/views/new/settings-view/index.vue`（确认透传即可）

**实施要点**

1. `SettingsDialog` 补 `inline?: boolean` prop，主 `CreamDialog` 加 `:inline="inline"`；确认弹窗仍为普通弹窗。
2. 移动端横向分类：
   - `.sd-nav-item` 在 `@media (width <= 640px)` 下改为 `width: auto`（当前基础样式是 `width:100%`，横向排列时每个按钮占满整行，导致只看到第一个）；
   - 增加左右渐隐提示或可见滚动条；
   - 打开时把当前 active tab `scrollIntoView({ inline: 'nearest' })`。
3. `inline` 模式下 `.sd-body` 高度由页面承载，确认内容区可滚动、底部按钮不被裁切。
4. 检查 `settings-view` 的 `height:100%` 与 `.nl-content` padding 是否产生双滚动；必要时只保留内容区滚动。

**验收**

- Android/390px 下设置页是页面内卡片，不再出现遮罩弹窗。
- 至少能看到多个分类，横向可滚动且当前分类自动可见。
- 桌面设置弹窗形态不变。

#### UX-106 全局隐藏滚动条 + FAB 无内容避让

**改动文件**

- `src/layout/NewLayout.vue`
- 各页面根容器（按需）

**实施要点**

1. 删除 `NewLayout.vue` 末尾的全局 `::-webkit-scrollbar { display:none !important }` 与 `scrollbar-width:none !important`。
2. 改为全局细滚动条：
   - `::-webkit-scrollbar { width: 6px; height: 6px; }`
   - thumb 用 `--theme-border`，track 透明；
   - Firefox `scrollbar-width: thin`；
   - 不用 `!important`，让 `CreamDialog`、Monaco 等组件保留自己的滚动条样式。
3. FAB 避让：
   - `.nl-content` 底部增加 `calc(var(--theme-space-6) + var(--lt-fab-clearance, 0px))`；
   - 在窄屏把 `--lt-fab-clearance` 设为 72–88px，确保最后一张卡片/按钮不被 48px FAB 遮挡；
   - 桌面可设 56px。
4. 检查长内容页面（监控详情、配置详情、设置、引导）滚动条可见且不产生横向滚动。
5. 日志面板的“刷新”是日志专用，不要与 FAB 合并；如仍易混淆，把 FAB 菜单项改名为“刷新配置列表”。

**验收**

- 桌面鼠标滚轮场景能看到滚动位置。
- 390px 下滚动到底部，最后一张卡片可完整露出，FAB 不覆盖操作。
- 各弹窗内部滚动条仍正常。

#### UX-109 默认 1000×650 下配置详情头部被挤压

**改动文件**

- `src/views/new/config-view/index.vue`
- `src-tauri/tauri.conf.json5`

**实施要点**

1. 把详情头部的换行规则从 `@media (width <= 900px)` 提前为默认/中等宽度：
   - `.nw-detail-header { flex-wrap: wrap; gap: var(--theme-space-3); }`
   - `.nw-detail-title-row { flex-wrap: wrap; min-width: 0; }`
   - `.nw-detail-actions { flex-wrap: wrap; }`
   - 标题 `overflow-wrap: break-word`，徽标 `white-space: nowrap`。
2. 1000px 下允许操作按钮落到第二行，不再压扁标题。
3. `tauri.conf.json5` 增加 `minWidth: 900`、`minHeight: 600`，防止用户缩到布局无法承载的尺寸。
4. Web 配置详情使用同一套头部规则，顺带修复相同问题。

**验收**

- 1000×650 与最小 900×600 下，标题、状态徽标、四个操作均完整可见，无重叠。
- 1122px 下仍保持单行布局。

#### UX-203 手机端统计卡数值换行，英文长文案拥挤

**改动文件**

- `src/views/new/monitor/index.vue`
- `src/views/new/web-config-view/WebConfigForm.vue`
- `src/components/SettingsDialog/index.vue`（英文行布局）

**实施要点**

1. 监控统计区在 `@media (width <= 480px)` 改为 2×2 网格；`.nm-ps-num { white-space: nowrap; }`；单位不单独换行。
2. 总览统计卡同样检查 390px 下三项是否拥挤，必要时缩小图标与间距，不改字号下限。
3. WebConfigForm 的 `.wcf-grid` 在 `<=640px` 改为单列，避免表单横向溢出。
4. 设置页英文描述：`sd-row` 已允许换行，补充 `min-width: 0` 与 `overflow-wrap: anywhere`，避免长单词撑破容器。
5. 所有移动端修改在 390×844 与英文下验收。

**验收**

- 390px 下 `310.0 MB` 不折行，四个统计项不互相挤压。
- 英文设置页描述不溢出卡片。

### 批次 6：术语、操作层级与窗口

#### UX-110 操作层级反转，术语不统一

**改动文件**

- `src/locales/zh-CN.ts`、`src/locales/en.ts`
- `src/views/new/overview/index.vue`
- `src/views/new/config-view/index.vue`
- `src/views/new/web-config-view/index.vue`
- `src/layout/NewLayout.vue`

**术语表**

| 场景             | 统一用词            | 英文                         |
| ---------------- | ------------------- | ---------------------------- |
| 组网实例生命周期 | 运行 / 停止         | Run / Stop                   |
| 组网实例状态     | 运行中 / 已停止     | Running / Stopped            |
| Windows 服务     | 启动服务 / 停止服务 | Start service / Stop service |
| 窗口             | 关闭窗口            | Close window                 |
| 页面名           | 总览                | Overview                     |
| 配置列表标题     | 配置列表            | Configurations               |

**实施要点**

1. 配置页卡片与详情把 `newCommon.close` 改为 `newCommon.stop`；窗口关闭使用新增 `newCommon.closeWindow`。
2. Web 配置卡片/详情同样用“运行/停止”；状态不再用“未运行”，统一“已停止”。
3. 每个上下文只保留一个生命周期主操作：
   - 卡片：一个按钮，按状态在“运行/停止”之间切换；运行中的停止按钮用中性描边/文字样式，不再保留另一个禁用的绿色实心按钮。
   - 桌面详情头部：只保留编辑/删除；列表已提供生命周期操作。
   - 窄屏详情：列表不可见，详情头部保留一个上下文生命周期按钮。
   - Web 配置列表与详情二选一，不重复。
4. 删除 `notRunning` 在 Web 配置中的使用，或把其文案改为“已停止”并仅保留一个键，避免同义多键。
5. Android 单实例切换的原生 `window.confirm` 改为 `showConfirm`，与全站弹窗一致，支持主题与键盘。
6. 检查所有 `newCommon.start` 使用：组网实例统一改 `run`，服务保留 `start`。
7. 主题预览中的示例按钮同步用“运行/停止”，不再用“关闭”表示停止。

**验收**

- 全站搜索不到用“关闭”表示停止实例的文案。
- 任何一张卡片/详情同一时刻只有一个可点的生命周期主按钮。
- 运行中状态不再出现绿色实心但禁用的“运行”按钮。
- Android 切换实例提示为应用内弹窗。

#### UX-205 自定义窗口栏只有关闭按钮，且未声明最小尺寸

**改动文件**

- `src/layout/NewLayout.vue`
- `src-tauri/capabilities/default.json`
- `src-tauri/tauri.conf.json5`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 拖拽条右侧增加最小化、最大化/还原、关闭三个按钮；尺寸 ≥32×32，带 `aria-label` 与 `title`。
2. 使用 `getCurrentWindow().minimize()`、`toggleMaximize()`、`close()`；监听 resize 或调用 `isMaximized()` 切换“最大化/还原”图标。
3. 拖拽条 `@dblclick` 切换最大化（Windows 习惯）；按钮区域阻止拖拽事件冒泡。
4. 浏览器 Mock：用 `isTauri()` 守卫，点击不抛错；可选择在 Mock 下隐藏最大化/最小化，保留关闭占位。
5. `src-tauri/capabilities/default.json` 增加：
   - `core:window:allow-toggle-maximize`
   - `core:window:allow-is-maximized` 如改用 `maximize()/unmaximize()`，则改为 `allow-maximize` / `allow-unmaximize`。
6. `tauri.conf.json5` 增加 `minWidth: 900`、`minHeight: 600`（与 UX-109 同一改动）。
7. 窗口按钮的焦点环、hover、disabled 状态沿用现有样式。

**验收**

- 三个按钮均可用，最大化后可还原，双击拖拽条生效。
- 窗口无法缩到 900×600 以下。
- 构建通过，权限不报错（注意 capability 标识符必须 kebab-case）。

### 批次 7：Mock、空态与更新

#### UX-206 空态缺少下一步行动

**改动文件**

- `src/views/new/overview/index.vue`
- `src/views/new/config-view/index.vue`
- `src/router/newLayout.ts`（如处理 query）
- `src/components/OnboardingGuide/index.vue`

**实施要点**

1. 总览空态：图标 + “还没有组网配置” + “新建配置”主按钮。
2. 配置列表空态：同 CTA；Android 直接去 `/new/config-add`。
3. 监控空态按 UX-108 分流并给 CTA。
4. 配置页支持 `?create=1`：挂载时若存在该 query，打开新增弹窗（Android 跳新增页），随后用 `router.replace` 去掉 query，避免刷新重复打开。
5. 引导完成页在无配置时直接走同一入口。
6. 所有空态文案走 i18n，不再复用 `newCommon.noConfig` 一个键覆盖所有场景。

**验收**

- 三个页面的空态都能一步到达“新建配置”。
- 从引导结束到新建配置不超过一次点击。

#### UX-207 浏览器 Mock 下初始化被托盘 API 中断

**改动文件**

- `src/App.vue`

**实施要点**

1. 引入 `isTauri`（`@tauri-apps/api/core`），在初始化阶段区分 Tauri / Android / 浏览器。
2. 桌面 Tauri 专属逻辑统一包裹：
   - `trayStore.initTray()`
   - `restoreStateCurrent(StateFlags.ALL)`
   - `checkDir()`、`easytierStore.setConfigPath()`
   - `getCurrentWindow().show()`、`currentMonitor()`、`emit('frontend-ready')`
   - 聚焦重新锁定监听、启动最小化到托盘
   - `window-state` 插件调用
3. 浏览器 Mock：
   - 不做托盘/窗口/资源目录初始化；
   - 保留锁屏（若本地有密码）与引导；
   - 文件操作走 `useMockData`，配置为空时展示空态，不再被演示数据掩盖。
4. 每个 Tauri 调用保留 `.catch`，单个失败不阻断后续初始化。
5. 不把 `getCurrentWindow()` 等调用提到模块顶层执行。

**验收**

- `pnpm dev` 浏览器控制台无未捕获错误。
- 锁屏、引导、设置、配置编辑、Web 配置预览均可用。

#### UX-208 「检查更新」被永久关闭

**改动文件**

- `src/components/SettingsDialog/index.vue`
- `src/store/modules/easytier.ts`（如需调整请求错误处理）

**实施要点**

1. 先把 `UPDATE_CHECK_ENABLED` 改为 `true`，仅保留在关于页。
2. 验证三种状态：
   - 有更新：显示最新版本号 + “前往下载”；
   - 无更新：显示“已是最新版本”；
   - 网络失败/空列表：显示错误提示，不误报“已是最新”。
3. 请求失败与空列表分开处理：空列表是异常，不是“无更新”。
4. 检查 `MANAGER_INFO_API` 与 v1.5.0 Release 资产是否可访问；若 API 限流，增加一次会话内缓存或手动重试，不自动轮询。
5. 浏览器 Mock 下请求失败要优雅提示，不抛未捕获异常。

**验收**

- 关于页入口可见，三态均有明确反馈。
- 无网络时不会卡死或误报。

### 批次 8：打磨

#### UX-201 次要文字与元数据普遍过小

**改动文件**

- `src/views/new/monitor/index.vue`
- `src/views/new/config-view/index.vue`
- `src/views/new/config-view/EditDialog.vue`
- `src/views/new/web-config-view/*`
- `src/components/SettingsDialog/index.vue`
- `src/components/TrendChart/index.vue`
- `src/components/OnboardingGuide/index.vue`
- `src/components/ThemeDialog/index.vue`
- `src/components/FloatingMenu/index.vue`

**实施要点**

1. 字号下限：
   - 正文/输入：13px；
   - 辅助说明/图例：12px；
   - 元数据/徽标：≥11px；
   - 9–10px 只允许装饰性角标，不允许承载状态或关键操作。
2. 优先改监控页 9–11px 标签、配置 PID 10px、编辑表单标签 11px、Web 表单标签 11px。
3. 字号增大后检查：
   - 1000×650 头部是否再次换行过度；
   - 390px 卡片/统计是否溢出；
   - 英文长文案是否截断。
4. 不通过全局缩放或 `rem` 重构；逐处调整，避免连锁布局变化。

**验收**

- 关键状态、单位、字段名在默认窗口与 390px 下均清晰可读。
- 无新增横向滚动。

#### UX-202 趋势图缺坐标轴、单位、时间范围与无障碍描述

**改动文件**

- `src/components/TrendChart/index.vue`
- `src/views/new/monitor/index.vue`（导出按钮字号/命中区；不改颜色）
- `src/hooks/useTrendBuffer.ts`（只引用常量，不改窗口）

**实施要点**

1. 图表改为“SVG 曲线 + HTML 轴标签”组合，避免 `preserveAspectRatio="none"` 拉伸文字：
   - 左侧纵轴：顶部 `formatRate(maxBytes)`，底部 `0 B/s`；
   - 右侧纵轴：顶部 `${maxLatency} ms`，底部 `0 ms`；
   - 底部横轴：“近 15 分钟”与“现在”；
   - 网格线保留。
2. 时间范围从 `TREND_WINDOW_MS` 计算分钟数，禁止硬编码“1 小时”。
3. 图表容器 `role="img"` + `aria-label` 摘要：当前上传、下载、延迟与时间窗口；SVG 设 `aria-hidden="true"`。
4. 空数据态补一句“运行后自动记录采样”，而不只是“暂无数据”。
5. 图例字号提升到 12px；导出按钮提升到 12–13px、增加命中区（颜色对比度不在本次范围）。
6. 检查图例三项在 390px 下可换行且不遮挡。

**验收**

- 一眼能看出左轴是速率、右轴是延迟、横轴是近 15 分钟。
- 读屏能读出趋势摘要。
- 空数据提示明确下一步。

#### UX-209 配置列表无搜索/排序

**改动文件**

- `src/views/new/config-view/index.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 列表标题栏增加搜索框（`aria-label`），按配置名/文件名不区分大小写过滤。
2. 默认“运行中优先”，同状态保持原加载顺序（稳定排序）；搜索时仍保持该排序。
3. 增加“无匹配结果”空态，与“无配置”区分；提供清除搜索按钮。
4. 列表数量较多时，搜索框固定在标题栏，不随列表滚动。
5. 1000px 下标题栏不能挤压新增按钮；必要时搜索框单独一行。
6. 配置详情内的路由筛选与列表搜索互不影响。

**验收**

- 输入关键字即时筛选；清空恢复全部。
- 运行中配置排在前面；无匹配有明确提示。
- 列表滚动时搜索框仍可见。

#### UX-301 PID 文案缺空格

**改动文件**

- `src/views/new/overview/index.vue`

**实施要点**

- `PID{{ cfg.pid }}` → `PID {{ cfg.pid }}`；全站搜索 `PID{{` 确保无遗漏。
- 与监控页、配置页格式保持一致。

**验收**

- 截图中不再出现 `PID1001`。

#### UX-304 命名不统一

**改动文件**

- `src/router/newLayout.ts`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`
- `src/views/new/config-view/index.vue`
- `src/views/new/web-config-view/index.vue`
- `src/views/new/monitor/index.vue`

**实施要点**

1. 中文侧栏“全局”改为“总览”；英文保持 Overview。
2. 清理页面标签前的装饰性 `✦`（配置列表、Web 配置列表、监控列表等），保留图标体系即可。
3. “配置清单”改为“配置列表”，避免与页面名“配置”重复。
4. 统一大小写与空格：`Web 配置`（中文）、`Web Config`（英文）。
5. 路由 meta 的 `title` 同步，避免影响窗口标题或调试信息。

**验收**

- 侧栏、页面标题、列表标题用词一致。
- 无装饰性前缀残留。

#### UX-305 FAB 可见性与刷新入口

**改动文件**

- `src/components/FloatingMenu/index.vue`
- `src/locales/zh-CN.ts`、`src/locales/en.ts`

**实施要点**

1. 桌面常态 `opacity: 0.3` → `0.65`；hover/focus/open 为 1。
2. 主按钮补 `aria-label`、`aria-expanded`、`aria-haspopup="menu"`；菜单 `role="menu"`，菜单项 `role="menuitem"`。
3. 增加 `:focus-visible` 焦点环（现有 accent token）。
4. 菜单项“刷新配置”可改为“刷新配置列表”，与日志面板的“刷新”区分；**不要删除日志刷新按钮**。
5. 触屏下保持现有 48px 与 0.9 可见度。

**验收**

- 不 hover 也能看出 FAB 存在；键盘可打开菜单并执行刷新。
- 与日志刷新不再混淆。

## 4. i18n 键清单

新增键必须同时写入 `zh-CN.ts` 与 `en.ts`。建议分组如下（最终以实现为准）：

### newCommon

| key               | zh-CN                  | en                         |
| ----------------- | ---------------------- | -------------------------- |
| `closeWindow`     | 关闭窗口               | Close window               |
| `retry`           | 重试                   | Retry                      |
| `staleData`       | 数据可能已过期         | Data may be out of date    |
| `lastUpdated`     | 上次更新 {time}        | Last updated {time}        |
| `createConfig`    | 新建配置               | Create configuration       |
| `goConfig`        | 去配置页               | Go to configurations       |
| `noRunningConfig` | 暂无运行中的配置       | No running configurations  |
| `loadFailed`      | 加载失败               | Failed to load             |
| `demoData`        | 演示数据               | Demo data                  |
| `searchConfig`    | 搜索配置               | Search configurations      |
| `noSearchResult`  | 未找到匹配的配置       | No matching configurations |
| `discardTitle`    | 放弃未保存的修改？     | Discard unsaved changes?   |
| `discardMsg`      | 关闭后本次修改将丢失。 | Your changes will be lost. |
| `discardConfirm`  | 放弃修改               | Discard changes            |

### newConfig

| key | zh-CN | en |
| --- | --- | --- |
| `detailLoadFailed` | 无法读取配置文件 | Failed to read configuration file |
| `detailParseFailed` | 配置文件格式错误 | Invalid configuration file |
| `openConfigDir` | 打开配置目录 | Open configuration folder |
| `emptyHint` | 新建配置以开始组网 | Create a configuration to get started |
| `backupFailed` | 原配置备份失败，已取消保存 | Could not back up the original configuration; save canceled |
| `runningFirst` | 运行中优先 | Running first |

### newEdit

| key | zh-CN | en |
| --- | --- | --- |
| `codeInvalid` | TOML 语法错误：第 {line} 行第 {column} 列 | TOML syntax error at line {line}, column {column} |
| `codeInvalidSave` | 请先修复语法错误再保存 | Fix syntax errors before saving |
| `formParseFailed` | 当前代码无法解析，无法切换到表单模式 | Fix the code before switching to form mode |
| `removeItem` | 删除{label} | Remove {label} |
| `removeListener` | 删除监听地址 | Remove listener |
| `removePeer` | 删除对端节点 | Remove peer |
| `removeRoute` | 删除路由 | Remove route |
| `removeExitNode` | 删除出口节点 | Remove exit node |
| `removeFlag` | 删除自定义参数 | Remove custom flag |

### newSettings

| key | zh-CN | en |
| --- | --- | --- |
| `refreshIntervalInvalid` | 请输入 1–60 之间的整数 | Enter an integer from 1 to 60 |
| `lockPasswordNew` | 新密码 | New password |
| `lockPasswordConfirm` | 确认密码 | Confirm password |
| `lockPasswordSet` | 设置密码 | Set password |
| `lockPasswordChange` | 修改密码 | Change password |
| `lockPasswordMismatch` | 两次输入的密码不一致 | Passwords do not match |
| `lockPasswordTooShort` | 密码至少 6 位 | Password must be at least 6 characters |
| `lockPasswordSetSuccess` | 锁屏密码已设置 | Lock password set |
| `lockPasswordClearConfirm` | 清除后启动将不再需要解锁，是否继续？ | After clearing, the app will no longer require unlocking at startup. Continue? |
| `clearCacheNewMsg` | 仅清除 STUN 与公共节点缓存，不影响配置、主题、语言与锁屏密码。 | Only STUN and public peer caches will be cleared. Configurations, theme, language, and lock password are kept. |
| `cacheCleared` | 临时缓存已清除 | Temporary cache cleared |
| `tabsLabel` | 设置分类 | Settings categories |

### newMonitor

| key | zh-CN | en |
| --- | --- | --- |
| `emptyNoConfig` | 暂无配置 | No configurations yet |
| `emptyNoRunning` | 暂无运行中的配置 | No running configurations |
| `emptyNoRunningDesc` | 在配置页运行一个实例后即可查看监控。 | Run an instance from the configurations page to start monitoring. |
| `fetchFailed` | 监控数据获取失败 | Failed to fetch monitoring data |
| `fetchFailedDesc` | 请检查内核状态后重试。 | Check the core status and try again. |
| `staleBanner` | 已连续 {count} 次获取失败，显示最后一次数据 | {count} consecutive updates failed; showing the last data |
| `trendWindow` | 近 {minutes} 分钟 | Last {minutes} min |
| `trendAria` | 近 {minutes} 分钟趋势：当前上传 {tx}，下载 {rx}，延迟 {latency} | {minutes}-minute trend: upload {tx}, download {rx}, latency {latency} |
| `trendAxisRate` | 速率 | Rate |
| `trendAxisLatency` | 延迟 | Latency |
| `trendEmptyHint` | 运行后自动记录采样 | Samples are recorded automatically while running |

### newWebForm / newWebConfig

| key | zh-CN | en |
| --- | --- | --- |
| `newWebForm.portInvalid` | 端口需为 1–65535 的整数 | Port must be an integer between 1 and 65535 |
| `newWebConfig.openConsole` | 打开控制台 | Open console |
| `newCommon.notRunning` | 已停止（复用现有键或删除） | Stopped (reuse existing key or remove) |

### newOnboarding / newLock / newLayout

| key                         | zh-CN          | en                              |
| --------------------------- | -------------- | ------------------------------- |
| `newOnboarding.stepLabel`   | 第 {n} 步      | Step {n}                        |
| `newOnboarding.createFirst` | 创建第一个配置 | Create your first configuration |
| `newLock.passwordLabel`     | 解锁密码       | Unlock password                 |
| `newLayout.minimize`        | 最小化         | Minimize                        |
| `newLayout.maximize`        | 最大化         | Maximize                        |
| `newLayout.restore`         | 还原           | Restore                         |

## 5. Tauri 配置与权限

| 文件 | 修改 | 关联 |
| --- | --- | --- |
| `src-tauri/tauri.conf.json5` | 窗口增加 `minWidth: 900`、`minHeight: 600` | UX-109/205 |
| `src-tauri/capabilities/default.json` | 增加 `core:window:allow-toggle-maximize`、`core:window:allow-is-maximized` | UX-205 |
| `src-tauri/capabilities/default.json` | 若新增打开目录/文件相关 API，按实际调用补权限 | UX-101 |

注意：Tauri capability 标识符必须使用 kebab-case；新增后运行一次 `pnpm tauri build` 或 `pnpm td` 验证 schema 通过。

## 6. 测试与验收

### 6.1 自动化

每个批次至少执行：

```bash
pnpm ts:check
pnpm test
pnpm lint:eslint
pnpm lint:style
pnpm build
```

新增单测：

- `src/utils/__tests__/cacheUtil.test.ts`：白名单清理。
- `src/utils/__tests__/tomlValidation.test.ts`：非法 TOML 返回行列；合法 TOML 通过。
- 如把脏检查抽成 composable，补 `useDirtyGuard` 单测。

### 6.2 手工矩阵

| 环境 | 尺寸/语言 | 重点 |
| --- | --- | --- |
| 浏览器 Mock `pnpm dev` | 1122×742、390×844；中/英 | 无未捕获错误；引导、锁屏、设置、配置编辑、Web 配置、空态 |
| Tauri 桌面 `pnpm td` | 1000×650、900×600、1122×742 | 窗口按钮、最小尺寸、详情头部、滚动条、FAB、更新检查 |
| Tauri 桌面 | 文件被删除/无权限 | 详情错误态、保存备份、保存失败不丢内容 |
| Android（模拟器/真机） | 390×844；中/英 | 设置 inline、分类横滑、返回守卫、单实例切换弹窗、新建配置 CTA |
| 主题 | cream / dark / 任一外部主题 | 焦点环、原生控件、图表轴标签可读；不验证颜色对比度改动 |

### 6.3 数据安全专项

1. 编辑配置，改一个值，分别用 Esc、遮罩、关闭按钮、取消按钮关闭，均应提示。
2. Android 编辑页按物理返回键，应提示；取消后仍停留且内容完整。
3. 保存时把配置目录设为只读，保存失败后弹窗仍打开、内容未丢。
4. 正常覆盖保存后检查 `.bak` 内容为旧版本。
5. 输入非法 TOML，保存按钮不可用；从非法代码切表单被阻止。
6. 清除临时缓存后重启，确认主题、语言、锁屏密码、自动运行设置均保留。

### 6.4 回归重点

- 设置弹窗从桌面打开仍是居中弹窗；从 Android 二级页打开是 inline 卡片。
- 原生控件替换后，所有主题下视觉不塌陷、长英文不溢出。
- 滚动条恢复后，弹窗内部滚动与 Monaco 编辑器滚动正常。
- 窗口最小尺寸不影响 Android 构建（`tauri.conf.json5` 窗口配置仅桌面生效）。
- 更新检查失败不会阻塞设置页其他操作。

## 7. 风险与规避

| 风险 | 影响 | 规避 |
| --- | --- | --- |
| 异步 `beforeClose` 与 Android history 交互复杂 | 返回键可能绕过守卫或丢失 history 条目 | 先实现桌面路径；Android 单独测试“确认取消后再次按返回” |
| 脏检查误报/漏报 | 用户被频繁打扰或改动未提示 | 用用户事件 + 显式程序化标记，不用深度 watch；保存/打开时重置 |
| `saved` 事件契约变更 | 两个父组件与 Android 页需同步改 | 同一 PR 内改完三个调用点，类型检查兜底 |
| 原生 select/radio 改变视觉 | 与现有奶油风不一致 | 保留现有 class，`appearance:none` + 自绘箭头；逐主题验收 |
| 恢复滚动条影响全局 | 页面宽度变化、双滚动条 | 只在 `.nl-window` 内设细滚动条，移除 `!important`，逐页检查 |
| 字号增大导致 1000px 头部再拥挤 | 按钮换行更多 | 与 UX-109 同批验收；必要时减少装饰间距而非压字号 |
| 启用检查更新触发 API 限流/空列表 | 误报失败 | 区分空列表与网络错误；会话内缓存；手动重试 |
| 窗口权限遗漏 | `pnpm tauri build` 失败或运行时拒绝 | 补 capability 后执行桌面构建；标识符用 kebab-case |
| Mock 守卫改变桌面初始化时序 | 锁屏/托盘行为回归 | 仅包裹 Tauri 调用，不改变桌面分支顺序；桌面与浏览器各跑一遍 |

## 8. 排期与提交策略

粗略估算（不含对比度）：

| 批次 | 内容                            |              估算 |
| ---- | ------------------------------- | ----------------: |
| 1    | UX-001/002/003 数据安全         |        2.5–3 人日 |
| 2    | UX-101/108/303 状态真实性       |        1.5–2 人日 |
| 3    | UX-103/104/302 无障碍控件       |      2.5–3.5 人日 |
| 4    | UX-107/204 密码与引导           |        1–1.5 人日 |
| 5    | UX-105/106/109/203 响应式       |        1.5–2 人日 |
| 6    | UX-110/205 术语与窗口           |        1.5–2 人日 |
| 7    | UX-206/207/208 空态与平台       |        1–1.5 人日 |
| 8    | UX-201/202/209/301/304/305 打磨 |      1.5–2.5 人日 |
| 合计 |                                 | **约 13–18 人日** |

建议顺序：

1. 批次 1 必须先合入，并单独发一个 patch 版本。
2. 批次 2、3 可并行（不同文件为主），但都要基于批次 1 的 CreamDialog/状态基础。
3. 批次 4–8 按依赖顺序推进；批次 8 最后统一做字号与布局回归。

提交约定：

- 每批一个 PR，遵循 Conventional Commits（`fix` / `feat` / `refactor`）。
- 按项目约定，在准备提交/发布时评估并同步 `package.json`、`src-tauri/tauri.conf.json5`、`src-tauri/Cargo.toml` 的版本号；若多个 PR 连续交付，可在最后一个发布 PR 统一 bump，但每个可发布批次必须版本一致。
- PR 描述附本批次对应的 UX 编号与验收截图（桌面 1000×650、移动 390×844、英文各一张）。

## 9. 完成定义（DoD）

- 26 个非对比度问题全部有对应改动或明确说明不适用。
- 不修改 `theme.css` 的颜色值；新增焦点环复用现有 token。
- `pnpm ts:check`、`pnpm test`、`pnpm build` 通过。
- 浏览器 Mock 无未捕获错误；Android 与桌面关键路径手工验收通过。
- 所有新增文案中英同步，无硬编码。
- 数据安全专项全部通过：未保存提示、TOML 阻断、保存失败保留内容、`.bak` 备份、缓存白名单。
- 本文与审查报告互相链接；实施完成后在报告问题表中标注修复版本。
