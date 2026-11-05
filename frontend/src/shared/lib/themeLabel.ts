/**
 * 外部主题显示名解析
 *
 * CSS 顶部注释 `@theme-label: 青瓷` 声明显示名，未声明时回退主题 ID（文件名）。
 * 独立成模块供主题发现与主题加载共用，避免两者循环依赖。
 */
const THEME_LABEL_PATTERN = /@theme-label\s*:\s*([^*\r\n]+)/
const THEME_LABEL_MAX_LENGTH = 40

export const extractThemeLabel = (cssText: string, fallback: string): string => {
  const label = cssText.match(THEME_LABEL_PATTERN)?.[1].trim()
  if (!label) return fallback
  return label.slice(0, THEME_LABEL_MAX_LENGTH)
}
