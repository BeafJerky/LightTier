/**
 * 内核日志配置与路径工具（纯函数，无 Tauri 依赖，便于单测）
 *
 * 背景（修复 H-02，2026-10 校准）：
 * - v2.6.4 的 Config 虽然定义了 `[file_logger]` 段，但内核日志初始化只读取 CLI 参数
 *   `--file-log-dir/--file-log-level/--file-log-size/--file-log-count`，
 *   文件名固定为 `easytier.log`（CLI 无文件名字段），因此管理器必须把 TOML 配置翻译成 CLI 参数；
 * - 轮转为 Debian 风格：当前文件无后缀，历史文件为 `easytier.log.1/.2/...`（并非日期后缀），
 *   `.1` 是最新的历史分段，`count` 约等于“活跃文件 + 历史文件”的总数；
 * - 旧版内核可能按 TOML `file` 字段写 `{configName}.log` 或带日期后缀的文件，读取端需兼容；
 * - 默认目录按配置隔离到 `logs/kernel/<scope>`，旧版共享 `logs/` 作为只读回退；
 *   用户显式配置绝对目录时原样使用（读取端受 Tauri fs 作用域限制，见设计文档）。
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

// 配置文件名 → 日志基名（去掉 .toml；旧版内核按基名写 {name}.log）
export const getConfigLogBaseName = (configFileName: string): string =>
  (configFileName || '').replace(/\.toml$/i, '').trim()

// 转义正则元字符（配置文件名可能包含 . + ( ) 等字符）
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 数字轮转分段：base.N（N 越小越新；不能用字典序，否则 .9 会压过 .10）
const numericSegments = (files: string[], base: string): Array<{ file: string; index: number }> => {
  const re = new RegExp(`^${escapeRegExp(base)}\\.(\\d+)$`)
  return files.flatMap((file) => {
    const match = re.exec(file)
    return match ? [{ file, index: Number(match[1]) }] : []
  })
}

// 日期后缀分段（兼容旧版 {config}.YYYY-MM-DD.log / {config}.log.YYYY-MM-DD）
const datedSegments = (files: string[], configName: string): string[] => {
  const baseName = getConfigLogBaseName(configName)
  const bases = ['easytier.log', `${baseName}.log`, baseName].filter(Boolean)
  const candidates: Array<{ file: string; key: string }> = []
  for (const file of files) {
    for (const base of bases) {
      if (!file.startsWith(`${base}.`)) continue
      const suffix = file.slice(base.length + 1)
      if (/^\d{4}-\d{2}-\d{2}/.test(suffix)) {
        candidates.push({ file, key: suffix })
        break
      }
    }
  }
  return candidates.sort((a, b) => a.key.localeCompare(b.key)).map((item) => item.file)
}

/**
 * 从 logs 目录的文件列表中挑选当前配置要读取的日志文件：
 * 1. `easytier.log` 是当前内核正在写入的文件，优先级最高；
 * 2. 旧版内核按配置名写 `{configName}.log`，作为兼容读取；
 * 3. 数字轮转分段按编号取最小（`.1` 最新，`.2` 次之……）；
 * 4. 日期后缀分段取日期最大；
 * 5. 全部缺失时仍返回 `easytier.log`，由调用方按“暂无日志”处理。
 *
 * 旧实现优先 `{configName}.log` 且用字典序取最大，会在升级后长期展示旧文件，
 * 并在 `.9/.10` 之间选错，已在此修正。
 */
export const pickLogTarget = (files: string[], configName: string): string => {
  const baseName = getConfigLogBaseName(configName)
  if (files.includes('easytier.log')) return 'easytier.log'
  if (baseName && files.includes(`${baseName}.log`)) return `${baseName}.log`

  // 当前内核族优先，其次旧版按配置名写入的分段
  const currentRotations = numericSegments(files, 'easytier.log')
  if (currentRotations.length > 0) {
    return currentRotations.sort((a, b) => a.index - b.index)[0].file
  }
  if (baseName) {
    const legacyRotations = numericSegments(files, `${baseName}.log`)
    if (legacyRotations.length > 0) {
      return legacyRotations.sort((a, b) => a.index - b.index)[0].file
    }
  }

  const dated = datedSegments(files, configName)
  if (dated.length > 0) return dated[dated.length - 1]
  if (baseName && files.includes(baseName)) return baseName
  return 'easytier.log'
}

/**
 * 判断文件名是否属于内核日志（供“清除日志”精确匹配，含轮转与旧版命名）：
 * easytier.log / easytier.log.N / easytier.log.YYYY-MM-DD* /
 * {configName}.log / {configName}.log.N / {configName}.log.YYYY-MM-DD* /
 * 旧版裸文件名 {configName} / 旧版日期后缀 {configName}.YYYY-MM-DD*
 *
 * 不再使用 `startsWith(configName + '.')` 的宽匹配，避免误删同目录下的
 * `{configName}.toml` 等非日志文件。
 */
export const isKernelLogFile = (fileName: string, configName: string): boolean => {
  const baseName = getConfigLogBaseName(configName)
  const escaped = escapeRegExp(baseName)
  return (
    fileName === 'easytier.log' ||
    /^easytier\.log\.\d+$/.test(fileName) ||
    /^easytier\.log\.\d{4}-\d{2}-\d{2}/.test(fileName) ||
    (!!baseName &&
      (fileName === baseName ||
        fileName === `${baseName}.log` ||
        new RegExp(`^${escaped}\\.log\\.\\d+$`).test(fileName) ||
        new RegExp(`^${escaped}\\.log\\.\\d{4}-\\d{2}-\\d{2}`).test(fileName) ||
        new RegExp(`^${escaped}\\.\\d{4}-\\d{2}-\\d{2}`).test(fileName)))
  )
}

/** 正在写入、不应被清理的内核日志文件名 */
export const isActiveKernelLogFile = (fileName: string, configName: string): boolean => {
  const baseName = getConfigLogBaseName(configName)
  return (
    fileName === 'easytier.log' ||
    (!!baseName && (fileName === `${baseName}.log` || fileName === baseName))
  )
}

/**
 * 按配置隔离内核日志目录：配置名去掉 .toml 并清理路径非法字符。
 * 空配置名（如 Web 配置）由调用方显式传入作用域名。
 */
export const getKernelLogScope = (configFileName: string): string => {
  const base = getConfigLogBaseName(configFileName)
  const sanitized = base.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+$/, '_')
  return sanitized || 'default'
}

/**
 * 解析日志行级别：只认“时间戳/方括号 + 级别”出现在行首的格式，
 * 避免把正文里的 error/warn 单词误判为日志级别。
 * 时间戳按 EasyTier 的 RFC3339（OffsetTime）格式实现：毫秒/纳秒后可能带
 * `+08:00` 或 `Z` 时区，例如 `2026-10-21T12:00:00.123456789+08:00  INFO ...`。
 */
const TIMESTAMP_LEVEL_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+(?:\[)?(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)(?:\])?\b/i
const BRACKET_LEVEL_RE = /^\s*\[(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]/i

export const getLogLineLevel = (line: string): 'error' | 'warn' | '' => {
  const match = TIMESTAMP_LEVEL_RE.exec(line) || BRACKET_LEVEL_RE.exec(line)
  if (!match) return ''
  const level = match[1].toUpperCase()
  if (level === 'ERROR' || level === 'FATAL') return 'error'
  if (level === 'WARN') return 'warn'
  return ''
}
