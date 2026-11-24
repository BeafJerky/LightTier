/**
 * TOML 配置清洗
 *
 * 空值（空串 / 空数组 / null / undefined）一律不落盘，避免内核把空参数当真值解析；
 * 展示/解析场景可合并默认标量，保存场景只剔空值，避免配置文件膨胀。
 */
import defaultData from '@/entities/config/defaultData'
import * as toml from 'smol-toml'

export const isTomlSemanticEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isTomlSemanticEqual(value, right[index]))
    )
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && isTomlSemanticEqual(leftRecord[key], rightRecord[key])
    )
  )
}

export const serializeTomlPreservingUnchanged = (
  raw: string,
  config: Record<string, any>
): string => (isTomlSemanticEqual(toml.parse(raw), config) ? raw : toml.stringify(config))

const isEmptyValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

// 只补字符串/布尔/数字默认；数组与对象默认不注入，避免产生空结构
const isScalarDefault = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && typeof value !== 'object'

export const normalizeToml = (
  config: Record<string, any>,
  options: { mergeDefaults?: boolean } = {}
): Record<string, any> => {
  const mergeDefaults = options.mergeDefaults ?? true
  const defaults: Record<string, any> = (defaultData as any).defaultFormData || {}
  const output: Record<string, any> = {}

  for (const key of Object.keys(defaults)) {
    const value = config[key]
    if (!isEmptyValue(value)) {
      output[key] = value
    } else if (mergeDefaults && isScalarDefault(defaults[key])) {
      output[key] = defaults[key]
    }
  }

  // 默认表之外的键（用户自定义或后续内核新增字段）原样透传，但仍剔空值
  for (const key of Object.keys(config)) {
    if (!(key in defaults) && !isEmptyValue(config[key])) output[key] = config[key]
  }

  if (mergeDefaults) {
    const defaultFlags: Record<string, any> = defaults.flags || {}
    if (Object.values(defaultFlags).some(isScalarDefault)) {
      if (!output.flags || typeof output.flags !== 'object') output.flags = {}
      for (const key of Object.keys(defaultFlags)) {
        if (isEmptyValue(output.flags[key]) && isScalarDefault(defaultFlags[key])) {
          output.flags[key] = defaultFlags[key]
        }
      }
    }
  }

  if (output.flags && typeof output.flags === 'object') {
    for (const key of Object.keys(output.flags)) {
      if (isEmptyValue(output.flags[key])) delete output.flags[key]
    }
    if (Object.keys(output.flags).length === 0) delete output.flags
  }

  return output
}
