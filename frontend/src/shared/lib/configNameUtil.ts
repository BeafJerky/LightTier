/**
 * 配置名校验
 *
 * 配置名会作为 `<name>.toml` 的文件名写入 config 目录，因此：
 * - 支持中文等 Unicode 字符（\p{L}）与数字，以及空格、点、下划线、连字符
 * - 必须以字母/数字开头，避免隐藏文件与前导特殊字符
 * - 排除 Windows 保留设备名（CON/NUL/COM1 等，带扩展名同样保留）
 */

const VALID_CONFIG_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u
const RESERVED_CONFIG_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 是否可作为配置文件名称（自动忽略首尾空白） */
export const isValidConfigName = (name: string): boolean => {
  const value = name.trim()
  if (!value) return false
  // 与 agent 后端 validate_config_id 对齐：按字符数（非字节）限制 64
  if ([...value].length > 64) return false
  if (!VALID_CONFIG_NAME.test(value)) return false
  return !RESERVED_CONFIG_NAME.test(value)
}

/**
 * 是否与现有配置重名。
 *
 * Windows 文件系统大小写不敏感，`Home.toml` 与 `home.toml` 会互相覆盖，
 * 因此 Windows 上必须按小写比较；其他平台保持精确比较。
 */
export const isConfigNameTaken = (
  candidate: string,
  existing: readonly string[] | undefined,
  caseInsensitive = false
): boolean => {
  const value = candidate.trim()
  return (existing ?? []).some((name) =>
    caseInsensitive ? name.toLowerCase() === value.toLowerCase() : name === value
  )
}

/**
 * 从文件选择结果提取配置名。
 *
 * Android 文件选择器返回 content URI（可能整段 URL 编码，如
 * `content://.../document/raw%3A%2Fstorage%2F...%2Fhome`），直接按 `/` 取尾段
 * 会得到 `raw%3A...`。这里先解码再取 basename，并去掉 .toml 扩展名。
 */
export const configNameFromSelection = (selected: string): string => {
  let decoded = selected
  try {
    decoded = decodeURIComponent(selected)
  } catch {
    // 非法百分号编码：保留原值，仍尝试取 basename
  }
  const base = decoded.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.toml$/i, '')
}
