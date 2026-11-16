/**
 * 外部主题元数据解析
 *
 * CSS 顶部注释 `@theme-label: 青瓷` 声明显示名，未声明时回退主题 ID（文件名）；
 * `@theme-category: color|style` 声明分类，缺省由调用方按规则推断。
 * 独立成模块供主题发现与主题加载共用，避免两者循环依赖。
 */
const THEME_LABEL_PATTERN = /@theme-label\s*:\s*([^*\r\n]+)/
const THEME_LABEL_MAX_LENGTH = 40
const THEME_CATEGORY_PATTERN = /@theme-category\s*:\s*([^*\r\n]+)/

/** 主题分类：颜色主题只换色板，风格化主题改写视觉骨架或组件样式 */
export type ThemeCategory = 'color' | 'style'

export const extractThemeLabel = (cssText: string, fallback: string): string => {
  const label = cssText.match(THEME_LABEL_PATTERN)?.[1].trim()
  if (!label) return fallback
  return label.slice(0, THEME_LABEL_MAX_LENGTH)
}

/** 读取 `@theme-category`：非法取值与缺省同样返回 null，交由调用方推断 */
export const extractThemeCategory = (cssText: string): ThemeCategory | null => {
  const value = cssText.match(THEME_CATEGORY_PATTERN)?.[1].trim().toLowerCase()
  return value === 'color' || value === 'style' ? value : null
}
