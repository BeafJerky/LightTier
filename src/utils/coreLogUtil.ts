/**
 * 内核日志配置与路径工具（纯函数，无 Tauri 依赖，便于单测）
 *
 * 背景（修复 H-02，2026-10 校准）：
 * - v2.6.x 内核忽略 TOML `[file_logger]` 段（其 Config 结构里根本没有该字段），
 *   日志文件只会由 CLI 参数 `--file-log-dir/--file-log-level/--file-log-size/--file-log-count`
 *   控制，文件名固定为 `easytier.log`（CLI 无文件名字段）；
 * - 轮转为 Debian 风格：当前文件无后缀，历史文件为 `easytier.log.1/.2/...`（并非日期后缀）；
 * - 旧版内核可能按 TOML `file` 字段写 `{configName}.log` 或带日期后缀的文件，读取端需兼容；
 * - 因此目录必须是绝对路径（相对路径随进程 CWD 漂移），统一回落到应用 logs 目录，
 *   与 LogViewer / clearETLogs / routeUtil 读取端保持同一路径链路。
 */

// 内核日志默认轮转参数（与旧版 runEasyTierCore 的硬编码 10/10 保持一致）
export const DEFAULT_LOG_SIZE_MB = 10
export const DEFAULT_LOG_COUNT = 10

// 判断绝对路径：Windows 盘符（C:\ 或 C:/）、UNC（\\server）与 Unix 根路径（/），
// 不依赖 Tauri path API，保证可在单测与浏览器 mock 环境下使用
export const isAbsolutePath = (p: string): boolean => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p)

/**
 * 归一化内核日志目录：
 * - 配置为绝对路径时原样使用（用户显式指定，尊重即可）；
 * - 为空或相对路径（如 './log'、'./logs'、'.'）时，回落到 fallback 提供的绝对目录。
 * fallback 以惰性函数传入，避免不需要时触发 Tauri 调用（也便于单测注入）。
 */
export const resolveLogDir = async (
  configured: unknown,
  fallback: () => Promise<string>
): Promise<string> => {
  const dir = typeof configured === 'string' ? configured.trim() : ''
  return dir && isAbsolutePath(dir) ? dir : await fallback()
}

// 解析正整数配置（内核 --file-log-size/--file-log-count 只接受正整数），非法值回落默认
export const parsePositiveInt = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// 内核接受的日志级别（tracing LevelFilter::from_str 的取值集合）
const CORE_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'off'])

/**
 * 归一化日志级别：内核解析 --file-log-level 时用 .unwrap()，非法值会导致内核启动 panic，
 * 因此管理器侧必须先校验，非法/缺失统一回落 fallback
 */
export const normalizeLogLevel = (value: unknown, fallback = 'info'): string => {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return CORE_LOG_LEVELS.has(level) ? level : fallback
}

/**
 * 从 logs 目录的文件列表中挑选当前配置要读取的日志文件：
 * 1. 旧版内核按配置名写 `{configName}.log`；
 * 2. v2.6.x 内核固定写 `easytier.log`（正在写入的当前文件）；
 * 3. 兜底：轮转/日期后缀历史文件取字典序最大（仅有历史文件时仍可查看）；
 * 4. 全部缺失时仍返回 `easytier.log`，由调用方按读取失败处理。
 */
export const pickLogTarget = (files: string[], configName: string): string => {
  if (files.includes(`${configName}.log`)) return `${configName}.log`
  if (files.includes('easytier.log')) return 'easytier.log'
  const matched = files.filter(
    (f) => f.startsWith(`${configName}.`) || f.startsWith('easytier.log.')
  )
  return matched.length > 0 ? matched.sort().at(-1)! : 'easytier.log'
}

/**
 * 判断文件名是否属于内核日志（供“清除日志”精确匹配，含轮转与旧版命名）：
 * easytier.log / easytier.log.N / {configName}.log / {configName}.log.N /
 * 旧版裸文件名 {configName} / 旧版日期后缀 {configName}.YYYY-MM-DD*
 */
export const isKernelLogFile = (fileName: string, configName: string): boolean =>
  fileName === 'easytier.log' ||
  fileName.startsWith('easytier.log.') ||
  fileName === configName ||
  fileName.startsWith(`${configName}.`)
