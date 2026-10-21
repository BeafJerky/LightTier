/**
 * Naive UI 主题适配
 *
 * 不复制一套色板，而是把主题层的 --theme-* 变量直接写进 themeOverrides：
 * 换肤/外部主题注入后由 CSS 变量自动生效，无需 JS 重新计算颜色。
 * 只有 light / dark 基础主题需要按当前背景亮度切换。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { useThemeLoader } from '@/hooks/useThemeLoader'
import { detectDarkTheme, parseCssColor } from '@/utils/themeColorUtil'

const cssVar = (name: string, fallback: string) => `var(${name}, ${fallback})`

const accent = cssVar('--theme-accent-primary', '#e8a0a0')
const accentHover = cssVar('--theme-accent-hover', '#d49090')
const accentPressed = `color-mix(in srgb, ${accent} 82%, #000000)`
const textPrimary = cssVar('--theme-text-primary', '#4a3728')
const textSecondary = cssVar('--theme-text-secondary', '#7a6e5e')
const textMuted = cssVar('--theme-text-muted', '#c8bdb2')
const textOnAccent = cssVar('--theme-text-on-accent', '#ffffff')
const bgPage = cssVar('--theme-bg', '#fdf8f4')
const bgCard = cssVar('--theme-bg-card', '#ffffff')
const bgHover = cssVar('--theme-bg-hover', 'rgba(232, 160, 160, 0.06)')
const bgActive = cssVar('--theme-bg-active', 'rgba(232, 160, 160, 0.1)')
const bgTag = cssVar('--theme-bg-tag', '#f5ede6')
const border = cssVar('--theme-border', '#ede4db')
const radiusPill = cssVar('--theme-radius-pill', '100px')
const radiusLg = cssVar('--theme-radius-lg', '14px')
const fontBody = cssVar('--theme-font-body', "'Sora', sans-serif")
const fontMono = cssVar('--theme-font-mono', 'ui-monospace, monospace')
const shadowSm = cssVar('--theme-shadow-sm', '0 8px 28px rgba(74, 55, 40, 0.06)')
const shadowToast = cssVar('--theme-shadow-toast', '0 6px 24px rgba(74, 55, 40, 0.1)')

/**
 * 全局主题覆盖：颜色全部指向主题变量，保持与自定义组件同一套色板。
 * 与 Naive 内置 light/dark 主题合并后，由背景亮度决定的基础主题提供其余中性色。
 */
export const NAIVE_THEME_OVERRIDES: GlobalThemeOverrides = {
  common: {
    primaryColor: accent,
    primaryColorHover: accentHover,
    primaryColorPressed: accentPressed,
    primaryColorSuppl: accentHover,
    infoColor: cssVar('--theme-color-info', '#e8a0a0'),
    infoColorHover: accentHover,
    infoColorPressed: accentPressed,
    infoColorSuppl: accentHover,
    successColor: cssVar('--theme-color-success', '#7fba8a'),
    successColorHover: cssVar('--theme-color-success-dark', '#6aaa78'),
    successColorPressed: cssVar('--theme-color-success-dark', '#6aaa78'),
    successColorSuppl: cssVar('--theme-color-success-dark', '#6aaa78'),
    warningColor: cssVar('--theme-color-warning', '#e6a23c'),
    warningColorHover: cssVar('--theme-color-warning', '#e6a23c'),
    warningColorPressed: cssVar('--theme-color-warning', '#e6a23c'),
    warningColorSuppl: cssVar('--theme-color-warning', '#e6a23c'),
    errorColor: cssVar('--theme-color-danger', '#e8a0a0'),
    errorColorHover: accentHover,
    errorColorPressed: accentPressed,
    errorColorSuppl: accentHover,
    textColorBase: textPrimary,
    textColor1: textPrimary,
    textColor2: textSecondary,
    textColor3: textMuted,
    textColorDisabled: textMuted,
    placeholderColor: textMuted,
    placeholderColorDisabled: textMuted,
    iconColor: textSecondary,
    iconColorHover: accent,
    iconColorPressed: accentHover,
    dividerColor: border,
    borderColor: border,
    bodyColor: bgPage,
    cardColor: bgCard,
    modalColor: bgCard,
    popoverColor: bgCard,
    tableColor: bgCard,
    tableHeaderColor: bgTag,
    inputColor: bgTag,
    actionColor: bgHover,
    hoverColor: bgHover,
    pressedColor: bgActive,
    tagColor: bgTag,
    avatarColor: bgTag,
    invertedColor: textPrimary,
    scrollbarColor: cssVar('--theme-color-scrollbar', '#e8d5c4'),
    scrollbarColorHover: textMuted,
    fontFamily: fontBody,
    fontFamilyMono: fontMono,
    fontWeightStrong: '600',
    boxShadow1: shadowSm,
    boxShadow2: shadowToast,
    boxShadow3: shadowToast
  },
  Button: {
    borderRadiusTiny: radiusPill,
    borderRadiusSmall: radiusPill,
    borderRadiusMedium: radiusPill,
    borderRadiusLarge: radiusPill,
    heightMedium: '32px',
    fontSizeSmall: '12px',
    fontSizeMedium: '12px',
    fontSizeLarge: '13px',
    fontWeight: '500',
    color: bgCard,
    colorHover: bgHover,
    colorPressed: bgActive,
    colorFocus: bgHover,
    border: `1px solid ${border}`,
    borderHover: `1px solid ${accent}`,
    borderPressed: `1px solid ${accent}`,
    borderFocus: `1px solid ${accent}`,
    textColor: textSecondary,
    textColorHover: accent,
    textColorPressed: accent,
    textColorFocus: accent,
    textColorPrimary: textOnAccent,
    textColorHoverPrimary: textOnAccent,
    textColorPressedPrimary: textOnAccent,
    textColorFocusPrimary: textOnAccent,
    colorPrimary: accent,
    colorHoverPrimary: accentHover,
    colorPressedPrimary: accentPressed,
    colorFocusPrimary: accentHover,
    borderPrimary: `1px solid ${accent}`,
    borderHoverPrimary: `1px solid ${accentHover}`,
    borderPressedPrimary: `1px solid ${accentPressed}`,
    borderFocusPrimary: `1px solid ${accentHover}`,
    rippleColorPrimary: accent
  },
  Spin: {
    color: accent,
    textColor: textSecondary
  },
  Notification: {
    color: bgCard,
    textColor: textPrimary,
    headerTextColor: textPrimary,
    descriptionTextColor: textSecondary,
    iconColorSuccess: cssVar('--theme-color-success', '#7fba8a'),
    iconColorInfo: cssVar('--theme-color-info', '#e8a0a0'),
    iconColorWarning: cssVar('--theme-color-warning', '#e6a23c'),
    iconColorError: cssVar('--theme-color-danger', '#e8a0a0'),
    closeIconColor: textMuted,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    borderRadius: radiusLg,
    boxShadow: shadowToast,
    fontSize: '13px',
    titleFontSize: '13px',
    descriptionFontSize: '12px'
  }
}

/** 读取主题背景变量；无法直接解析时借助 canvas 归一化（兼容 hsl/oklch 等写法） */
const readThemeBackground = (): string | null => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const value = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim()
  if (!value || parseCssColor(value)) return value || null

  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return value
    // sentinel：非法颜色不会覆盖 fillStyle，用哨兵区分“解析失败”与真实颜色
    ctx.fillStyle = '#010203'
    ctx.fillStyle = value
    return ctx.fillStyle === '#010203' ? value : ctx.fillStyle
  } catch {
    return value
  }
}

/**
 * 组合式主题：根据当前主题背景选择 Naive 基础主题。
 * 监听主题名与 themeRevision，确保重启恢复外部主题（名称未变）时也会重新判定。
 */
export const useNaiveTheme = () => {
  const { currentTheme, themeRevision } = useThemeLoader()
  const isDark = ref(detectDarkTheme(currentTheme.value, readThemeBackground()))

  const refresh = async () => {
    await nextTick()
    isDark.value = detectDarkTheme(currentTheme.value, readThemeBackground())
  }

  onMounted(() => {
    void refresh()
  })
  watch([currentTheme, themeRevision], () => {
    void refresh()
  })

  return {
    isDark,
    naiveTheme: computed<GlobalTheme | null>(() => (isDark.value ? darkTheme : null)),
    themeOverrides: NAIVE_THEME_OVERRIDES
  }
}
