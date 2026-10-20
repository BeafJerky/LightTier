/**
 * LightTier 私有配置（写入用户 TOML 的 [lighttier] 表）
 *
 * 兼容性约定：
 * - 官方内核只会解析自己认识的顶层字段，未知顶层表（[lighttier]）会被忽略，
 *   因此应用私有元数据只能放这里；
 * - 不能写入 [flags]：EasyTier v2.7.0+ 对未知 flags 键会解析报错、拒绝启动。
 *
 * 旧版位置（仅兼容读取，写入/迁移时清除）：
 * - flags._enable_exit_route
 * - 顶层 config_exit_nodes_route
 */
import { LIGHTTIER_CONFIG_SECTION } from '@/constants/easytier'

type ConfigLike = Record<string, any>

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 读取 [lighttier] 表（不存在或结构非法时返回空对象） */
export const getLightTierConfig = (config: ConfigLike | null | undefined): ConfigLike => {
  const section = config?.[LIGHTTIER_CONFIG_SECTION]
  return isPlainObject(section) ? section : {}
}

/**
 * 是否启用「退出节点流量接管」（启动后由 LightTier 改写系统默认路由）
 * 新位置优先；旧位置仅用于存量配置兼容。
 */
export const isExitRouteEnabled = (config: ConfigLike | null | undefined): boolean => {
  if (!config) return false
  const section = config[LIGHTTIER_CONFIG_SECTION]
  if (isPlainObject(section) && typeof section.exit_route_enabled === 'boolean') {
    return section.exit_route_enabled
  }
  const flags = config.flags
  if (isPlainObject(flags) && typeof flags._enable_exit_route === 'boolean') {
    return flags._enable_exit_route
  }
  return config.config_exit_nodes_route === true
}

/**
 * 写入退出路由开关：统一落到 [lighttier].exit_route_enabled，
 * 同时清除旧版 flags / 顶层标记，避免污染 EasyTier flags。
 * @returns 配置对象是否发生变化
 */
export const setExitRouteEnabled = (config: ConfigLike, enabled: boolean): boolean => {
  let changed = false
  // 旧版 flags 标记（v2.7.0+ 会因未知 flags 键拒绝启动，必须清除）
  if (isPlainObject(config.flags) && '_enable_exit_route' in config.flags) {
    delete config.flags._enable_exit_route
    if (Object.keys(config.flags).length === 0) delete config.flags
    changed = true
  }
  // 更早版本的顶层标记
  if ('config_exit_nodes_route' in config) {
    delete config.config_exit_nodes_route
    changed = true
  }

  const existing = config[LIGHTTIER_CONFIG_SECTION]
  let section = isPlainObject(existing) ? existing : undefined
  if (enabled) {
    if (!section) {
      section = {}
      config[LIGHTTIER_CONFIG_SECTION] = section
    }
    if (section.exit_route_enabled !== true) {
      section.exit_route_enabled = true
      changed = true
    }
  } else if (section && 'exit_route_enabled' in section) {
    delete section.exit_route_enabled
    changed = true
    // 段内没有其它元数据时删除空表，保持配置干净
    if (Object.keys(section).length === 0) delete config[LIGHTTIER_CONFIG_SECTION]
  }
  return changed
}

/**
 * 将旧版 LightTier 私有标记迁移到 [lighttier] 表（仅内存对象，落盘由调用方负责）
 * @returns 是否存在需要迁移的旧标记
 */
export const migrateLightTierConfig = (config: ConfigLike): boolean => {
  const hasLegacyFlags =
    isPlainObject(config.flags) && '_enable_exit_route' in (config.flags as ConfigLike)
  const hasLegacyTop = 'config_exit_nodes_route' in config
  if (!hasLegacyFlags && !hasLegacyTop) return false
  const enabled = isExitRouteEnabled(config)
  setExitRouteEnabled(config, enabled)
  return true
}
