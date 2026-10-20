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
  if (!VALID_CONFIG_NAME.test(value)) return false
  return !RESERVED_CONFIG_NAME.test(value)
}
