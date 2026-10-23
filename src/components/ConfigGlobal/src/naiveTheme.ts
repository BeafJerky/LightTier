/**
 * Naive UI 主题适配
 *
 * 声明层直接引用主题层的 --theme-* 变量，换肤只需更新 CSS 变量。
 * 但 Naive 内部会用 seemly 的 rgba() 对 primary/error 等颜色做二次推导，
 * 无法解析 var()/color-mix()；因此注入前必须把表达式解析为具体 RGB 值，
 * 并在主题切换后重新解析。light / dark 基础主题按背景亮度切换。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { useThemeLoader } from '@/hooks/useThemeLoader'
import { detectDarkTheme, parseCssColor } from '@/utils/themeColorUtil'

const cssVar = (name: string, fallback: string) => `var(${name}, ${fallback})`

const accent = cssVar('--theme-accent-primary', '#e8a0a0')
const accentHover = cssVar('--theme-accent-hover', '#d49090')
const accentPressed = `color-mix(in srgb, ${accent} 82%, #000000)`
const accentSoft = `color-mix(in srgb, ${accent} 12%, transparent)`
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
const borderLight = cssVar('--theme-border-light', '#f5ede6')
const success = cssVar('--theme-color-success', '#7fba8a')
const successDark = cssVar('--theme-color-success-dark', '#6aaa78')
const warning = cssVar('--theme-color-warning', '#e6a23c')
const danger = cssVar('--theme-color-danger', '#e8a0a0')
const info = cssVar('--theme-color-info', '#e8a0a0')
const focusRing = `0 0 0 3px ${accentSoft}`
const radiusSm = cssVar('--theme-radius-sm', '10px')
const radiusMd = cssVar('--theme-radius-md', '12px')
const radiusLg = cssVar('--theme-radius-lg', '14px')
const radiusPill = cssVar('--theme-radius-pill', '100px')
const radiusRound = cssVar('--theme-radius-round', '50%')
const fontBody = cssVar('--theme-font-body', "'Sora', sans-serif")
const fontMono = cssVar('--theme-font-mono', 'ui-monospace, monospace')
const shadowSm = cssVar('--theme-shadow-sm', '0 8px 28px rgba(74, 55, 40, 0.06)')
const shadowMd = cssVar('--theme-shadow-md', '0 12px 36px rgba(74, 55, 40, 0.07)')
const shadowToast = cssVar('--theme-shadow-toast', '0 6px 24px rgba(74, 55, 40, 0.1)')

/**
 * 全局主题覆盖：颜色全部指向主题变量，保持与自定义组件同一套色板。
 * 与 Naive 内置 light/dark 主题合并后，由背景亮度决定的基础主题提供其余中性色。
 */
export const NAIVE_THEME_OVERRIDES: GlobalThemeOverrides = {
  common: {
    baseColor: bgPage,
    primaryColor: accent,
    primaryColorHover: accentHover,
    primaryColorPressed: accentPressed,
    primaryColorSuppl: accentHover,
    infoColor: info,
    infoColorHover: accentHover,
    infoColorPressed: accentPressed,
    infoColorSuppl: accentHover,
    successColor: success,
    successColorHover: successDark,
    successColorPressed: successDark,
    successColorSuppl: successDark,
    warningColor: warning,
    warningColorHover: warning,
    warningColorPressed: warning,
    warningColorSuppl: warning,
    errorColor: danger,
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
    iconColorDisabled: textMuted,
    dividerColor: border,
    borderColor: border,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeIconColorPressed: accentHover,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    clearColor: textMuted,
    clearColorHover: textSecondary,
    clearColorPressed: textPrimary,
    scrollbarColor: cssVar('--theme-color-scrollbar', '#e8d5c4'),
    scrollbarColorHover: textMuted,
    scrollbarWidth: '6px',
    scrollbarHeight: '6px',
    scrollbarBorderRadius: '10px',
    progressRailColor: bgTag,
    railColor: bgTag,
    popoverColor: bgCard,
    tableColor: bgCard,
    tableHeaderColor: bgTag,
    tableColorHover: bgHover,
    tableColorStriped: bgTag,
    cardColor: bgCard,
    modalColor: bgCard,
    bodyColor: bgPage,
    tagColor: bgTag,
    avatarColor: bgTag,
    invertedColor: textPrimary,
    inputColor: bgTag,
    inputColorDisabled: bgHover,
    codeColor: bgTag,
    tabColor: bgTag,
    actionColor: bgHover,
    hoverColor: bgHover,
    pressedColor: bgActive,
    buttonColor2: bgCard,
    buttonColor2Hover: bgHover,
    buttonColor2Pressed: bgActive,
    opacityDisabled: '0.55',
    boxShadow1: shadowSm,
    boxShadow2: shadowToast,
    boxShadow3: shadowMd,
    fontFamily: fontBody,
    fontFamilyMono: fontMono,
    fontWeight: '400',
    fontWeightStrong: '600',
    borderRadius: radiusMd,
    borderRadiusSmall: radiusSm,
    fontSize: '13px',
    fontSizeMini: '10px',
    fontSizeTiny: '11px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    fontSizeHuge: '15px',
    lineHeight: '1.5',
    heightMini: '16px',
    heightTiny: '22px',
    heightSmall: '28px',
    heightMedium: '32px',
    heightLarge: '40px',
    heightHuge: '48px'
  },
  Button: {
    heightTiny: '22px',
    heightSmall: '28px',
    heightMedium: '32px',
    heightLarge: '40px',
    borderRadiusTiny: radiusPill,
    borderRadiusSmall: radiusPill,
    borderRadiusMedium: radiusPill,
    borderRadiusLarge: radiusPill,
    fontSizeTiny: '11px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '13px',
    fontWeight: '500',
    opacityDisabled: '0.55',
    color: bgCard,
    colorHover: bgHover,
    colorPressed: bgActive,
    colorFocus: bgHover,
    colorDisabled: bgHover,
    colorSecondary: bgCard,
    colorSecondaryHover: bgHover,
    colorSecondaryPressed: bgActive,
    colorTertiary: 'transparent',
    colorTertiaryHover: bgHover,
    colorTertiaryPressed: bgActive,
    colorQuaternary: 'transparent',
    colorQuaternaryHover: bgHover,
    colorQuaternaryPressed: bgActive,
    border: `1px solid ${border}`,
    borderHover: `1px solid ${accent}`,
    borderPressed: `1px solid ${accent}`,
    borderFocus: `1px solid ${accent}`,
    borderDisabled: `1px solid ${borderLight}`,
    textColor: textSecondary,
    textColorHover: accent,
    textColorPressed: accent,
    textColorFocus: accent,
    textColorDisabled: textMuted,
    textColorText: textSecondary,
    textColorTextHover: accent,
    textColorTextPressed: accent,
    textColorTextFocus: accent,
    textColorGhost: textSecondary,
    textColorGhostHover: accent,
    textColorGhostPressed: accent,
    textColorGhostFocus: accent,
    colorPrimary: accent,
    colorHoverPrimary: accentHover,
    colorPressedPrimary: accentPressed,
    colorFocusPrimary: accentHover,
    colorDisabledPrimary: bgHover,
    borderPrimary: `1px solid ${accent}`,
    borderHoverPrimary: `1px solid ${accentHover}`,
    borderPressedPrimary: `1px solid ${accentPressed}`,
    borderFocusPrimary: `1px solid ${accentHover}`,
    borderDisabledPrimary: `1px solid ${borderLight}`,
    textColorPrimary: textOnAccent,
    textColorHoverPrimary: textOnAccent,
    textColorPressedPrimary: textOnAccent,
    textColorFocusPrimary: textOnAccent,
    textColorDisabledPrimary: textMuted,
    textColorTextPrimary: accent,
    textColorTextHoverPrimary: accentHover,
    textColorTextPressedPrimary: accentPressed,
    textColorGhostPrimary: accent,
    textColorGhostHoverPrimary: accentHover,
    textColorGhostPressedPrimary: accentPressed,
    rippleColor: accentSoft,
    rippleColorPrimary: accent
  },
  Input: {
    fontWeight: '400',
    heightTiny: '22px',
    heightSmall: '28px',
    heightMedium: '32px',
    heightLarge: '40px',
    fontSizeTiny: '11px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '13px',
    lineHeight: '1.5',
    lineHeightTextarea: '1.6',
    borderRadius: radiusMd,
    iconSize: '16px',
    textColor: textPrimary,
    textColorDisabled: textMuted,
    caretColor: accent,
    placeholderColor: textMuted,
    placeholderColorDisabled: textMuted,
    color: bgCard,
    colorHover: bgCard,
    colorDisabled: bgHover,
    colorFocus: bgCard,
    border: `1px solid ${border}`,
    borderHover: `1px solid ${border}`,
    borderDisabled: `1px solid ${borderLight}`,
    borderFocus: `1px solid ${accent}`,
    boxShadowFocus: focusRing,
    loadingColor: accent,
    countTextColor: textMuted,
    countTextColorDisabled: textMuted,
    clearColor: textMuted,
    clearColorHover: textSecondary,
    clearColorPressed: textPrimary,
    iconColor: textMuted,
    iconColorHover: accent,
    iconColorPressed: accentHover,
    iconColorDisabled: textMuted,
    suffixTextColor: textSecondary,
    paddingTiny: '0 8px',
    paddingSmall: '0 10px',
    paddingMedium: '0 12px',
    paddingLarge: '0 14px',
    clearSize: '16px'
  },
  Select: {
    menuBoxShadow: shadowToast,
    peers: {
      InternalSelection: {
        fontSizeTiny: '11px',
        fontSizeSmall: '12px',
        fontSizeMedium: '13px',
        fontSizeLarge: '13px',
        heightTiny: '22px',
        heightSmall: '28px',
        heightMedium: '32px',
        heightLarge: '40px',
        borderRadius: radiusPill,
        fontWeight: '400',
        textColor: textPrimary,
        textColorDisabled: textMuted,
        placeholderColor: textMuted,
        placeholderColorDisabled: textMuted,
        color: bgTag,
        colorDisabled: bgHover,
        colorActive: bgCard,
        border: `1px solid ${border}`,
        borderHover: `1px solid ${border}`,
        borderActive: `1px solid ${accent}`,
        borderFocus: `1px solid ${accent}`,
        boxShadowHover: 'none',
        boxShadowActive: focusRing,
        boxShadowFocus: focusRing,
        caretColor: accent,
        arrowColor: textMuted,
        arrowColorDisabled: textMuted,
        loadingColor: accent,
        clearColor: textMuted,
        clearColorHover: textSecondary,
        clearColorPressed: textPrimary,
        clearSize: '16px',
        arrowSize: '16px'
      },
      InternalSelectMenu: {
        optionFontSizeTiny: '11px',
        optionFontSizeSmall: '12px',
        optionFontSizeMedium: '13px',
        optionFontSizeLarge: '13px',
        optionHeightTiny: '28px',
        optionHeightSmall: '32px',
        optionHeightMedium: '36px',
        optionHeightLarge: '40px',
        borderRadius: radiusMd,
        color: bgCard,
        groupHeaderTextColor: textMuted,
        optionTextColor: textSecondary,
        optionTextColorPressed: textPrimary,
        optionTextColorDisabled: textMuted,
        optionTextColorActive: accent,
        optionColorPending: bgHover,
        optionColorActive: bgActive,
        optionColorActivePending: bgActive,
        optionCheckColor: accent,
        loadingColor: accent,
        paddingSmall: '4px',
        paddingMedium: '4px',
        loadingSize: '18px'
      }
    }
  },
  Switch: {
    iconColor: textOnAccent,
    textColor: textSecondary,
    loadingColor: textMuted,
    opacityDisabled: '0.55',
    railColor: border,
    railColorActive: success,
    buttonBoxShadow: '0 1px 3px rgba(74, 55, 40, 0.18)',
    buttonColor: bgCard,
    railBorderRadiusSmall: radiusPill,
    railBorderRadiusMedium: radiusPill,
    railBorderRadiusLarge: radiusPill,
    buttonBorderRadiusSmall: radiusRound,
    buttonBorderRadiusMedium: radiusRound,
    buttonBorderRadiusLarge: radiusRound,
    boxShadowFocus: focusRing,
    buttonHeightSmall: '16px',
    buttonHeightMedium: '20px',
    buttonHeightLarge: '22px',
    buttonWidthSmall: '16px',
    buttonWidthMedium: '20px',
    buttonWidthLarge: '22px',
    buttonWidthPressedSmall: '18px',
    buttonWidthPressedMedium: '22px',
    buttonWidthPressedLarge: '24px',
    railHeightSmall: '20px',
    railHeightMedium: '24px',
    railHeightLarge: '26px',
    railWidthSmall: '36px',
    railWidthMedium: '42px',
    railWidthLarge: '46px'
  },
  Tag: {
    heightTiny: '20px',
    heightSmall: '24px',
    heightMedium: '28px',
    heightLarge: '32px',
    borderRadius: radiusPill,
    fontSizeTiny: '10px',
    fontSizeSmall: '11px',
    fontSizeMedium: '12px',
    fontSizeLarge: '13px',
    fontWeightStrong: '600',
    border: `1px solid ${border}`,
    color: bgTag,
    textColor: textSecondary,
    colorBordered: bgCard,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeIconColorPressed: accentHover,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    borderPrimary: `1px solid ${accent}`,
    textColorPrimary: accent,
    colorPrimary: accentSoft,
    colorBorderedPrimary: bgCard,
    borderSuccess: `1px solid ${success}`,
    textColorSuccess: successDark,
    colorSuccess: `color-mix(in srgb, ${success} 14%, transparent)`,
    colorBorderedSuccess: bgCard,
    borderWarning: `1px solid ${warning}`,
    textColorWarning: warning,
    colorWarning: `color-mix(in srgb, ${warning} 14%, transparent)`,
    colorBorderedWarning: bgCard,
    borderError: `1px solid ${danger}`,
    textColorError: danger,
    colorError: `color-mix(in srgb, ${danger} 14%, transparent)`,
    colorBorderedError: bgCard,
    borderInfo: `1px solid ${info}`,
    textColorInfo: info,
    colorInfo: `color-mix(in srgb, ${info} 14%, transparent)`,
    colorBorderedInfo: bgCard,
    closeIconSizeTiny: '12px',
    closeIconSizeSmall: '13px',
    closeIconSizeMedium: '14px',
    closeIconSizeLarge: '15px',
    closeSizeTiny: '14px',
    closeSizeSmall: '16px',
    closeSizeMedium: '18px',
    closeSizeLarge: '20px',
    padding: '0 8px',
    closeMargin: '4px 0 0 4px'
  },
  Tooltip: {
    borderRadius: radiusSm,
    boxShadow: shadowToast,
    color: bgCard,
    textColor: textSecondary,
    padding: '6px 10px'
  },
  Popover: {
    fontSize: '12px',
    borderRadius: radiusMd,
    color: bgCard,
    dividerColor: border,
    textColor: textSecondary,
    boxShadow: shadowToast,
    space: '8px',
    spaceArrow: '8px',
    padding: '12px'
  },
  Dropdown: {
    borderRadius: radiusMd,
    fontSizeSmall: '12px',
    fontSizeMedium: '12.5px',
    fontSizeLarge: '13px',
    optionHeightSmall: '32px',
    optionHeightMedium: '36px',
    optionHeightLarge: '40px',
    optionTextColor: textSecondary,
    optionTextColorHover: accent,
    optionTextColorActive: accent,
    optionTextColorChildActive: accent,
    color: bgCard,
    dividerColor: border,
    suffixColor: textMuted,
    prefixColor: textMuted,
    optionColorHover: bgHover,
    optionColorActive: bgActive,
    groupHeaderTextColor: textMuted,
    optionOpacityDisabled: '0.55',
    padding: '4px'
  },
  Modal: {
    color: bgCard,
    textColor: textPrimary,
    boxShadow: shadowMd
  },
  Dialog: {
    fontSize: '13px',
    lineHeight: '1.6',
    border: `1px solid ${border}`,
    titleTextColor: textPrimary,
    textColor: textSecondary,
    color: bgCard,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeIconColorPressed: accentHover,
    closeBorderRadius: radiusRound,
    iconColor: accent,
    iconColorInfo: info,
    iconColorSuccess: success,
    iconColorWarning: warning,
    iconColorError: danger,
    borderRadius: radiusLg,
    titleFontWeight: '600',
    titleFontSize: '15px',
    padding: '20px',
    iconSize: '22px',
    actionSpace: '10px',
    contentMargin: '12px 0 0',
    iconMargin: '0 0 12px',
    closeSize: '28px',
    closeIconSize: '16px',
    closeMargin: '14px 14px 0 0'
  },
  Card: {
    lineHeight: '1.5',
    color: bgCard,
    colorModal: bgCard,
    colorPopover: bgCard,
    textColor: textSecondary,
    titleTextColor: textPrimary,
    borderColor: borderLight,
    actionColor: bgCard,
    titleFontWeight: '600',
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    closeIconColor: textMuted,
    closeBorderRadius: radiusRound,
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    boxShadow: shadowSm,
    borderRadius: radiusLg,
    paddingSmall: '12px',
    paddingMedium: '16px',
    paddingLarge: '20px',
    titleFontSizeSmall: '13px',
    titleFontSizeMedium: '14px',
    titleFontSizeLarge: '15px'
  },
  Checkbox: {
    labelLineHeight: '1.5',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    borderRadius: '6px',
    color: bgCard,
    colorChecked: accent,
    colorDisabled: bgHover,
    colorDisabledChecked: bgHover,
    checkMarkColor: textOnAccent,
    checkMarkColorDisabled: textMuted,
    border: `1px solid ${border}`,
    borderDisabled: `1px solid ${borderLight}`,
    borderChecked: `1px solid ${accent}`,
    borderFocus: `1px solid ${accent}`,
    boxShadowFocus: focusRing,
    textColor: textSecondary,
    textColorDisabled: textMuted,
    sizeSmall: '14px',
    sizeMedium: '16px',
    sizeLarge: '18px',
    labelPadding: '0 0 0 8px',
    labelFontWeight: '400'
  },
  Radio: {
    buttonHeightSmall: '28px',
    buttonHeightMedium: '32px',
    buttonHeightLarge: '40px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    boxShadow: `inset 0 0 0 1px ${border}`,
    boxShadowActive: `inset 0 0 0 1px ${accent}`,
    boxShadowFocus: focusRing,
    boxShadowHover: `inset 0 0 0 1px ${accent}`,
    boxShadowDisabled: `inset 0 0 0 1px ${borderLight}`,
    color: bgCard,
    colorDisabled: bgHover,
    colorActive: bgCard,
    textColor: textSecondary,
    textColorDisabled: textMuted,
    dotColorActive: accent,
    dotColorDisabled: textMuted,
    buttonBorderColor: border,
    buttonBorderColorActive: accent,
    buttonBorderColorHover: accent,
    buttonColor: bgCard,
    buttonColorActive: accentSoft,
    buttonTextColor: textSecondary,
    buttonTextColorActive: accent,
    buttonTextColorHover: accent,
    opacityDisabled: '0.55',
    buttonBoxShadowFocus: focusRing,
    buttonBoxShadowHover: 'none',
    buttonBoxShadow: 'none',
    buttonBorderRadius: radiusPill,
    radioSizeSmall: '16px',
    radioSizeMedium: '18px',
    radioSizeLarge: '20px',
    labelPadding: '0 0 0 8px',
    labelFontWeight: '400'
  },
  Message: {
    textColor: textPrimary,
    textColorInfo: textPrimary,
    textColorSuccess: textPrimary,
    textColorError: textPrimary,
    textColorWarning: textPrimary,
    textColorLoading: textPrimary,
    color: bgCard,
    colorInfo: bgCard,
    colorSuccess: bgCard,
    colorError: bgCard,
    colorWarning: bgCard,
    colorLoading: bgCard,
    boxShadow: shadowToast,
    boxShadowInfo: shadowToast,
    boxShadowSuccess: shadowToast,
    boxShadowError: shadowToast,
    boxShadowWarning: shadowToast,
    boxShadowLoading: shadowToast,
    iconColor: accent,
    iconColorInfo: info,
    iconColorSuccess: success,
    iconColorWarning: warning,
    iconColorError: danger,
    iconColorLoading: accent,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeIconColorPressed: accentHover,
    loadingColor: accent,
    lineHeight: '1.5',
    borderRadius: radiusLg,
    border: `1px solid ${borderLight}`,
    margin: '0 0 12px',
    padding: '10px 16px',
    maxWidth: '420px',
    minWidth: '220px',
    iconMargin: '0 8px 0 0',
    closeMargin: '0 0 0 12px',
    closeSize: '20px',
    closeIconSize: '14px',
    iconSize: '18px',
    fontSize: '12.5px'
  },
  Notification: {
    color: bgCard,
    textColor: textPrimary,
    headerTextColor: textPrimary,
    descriptionTextColor: textSecondary,
    iconColorSuccess: success,
    iconColorInfo: info,
    iconColorWarning: warning,
    iconColorError: danger,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    borderRadius: radiusLg,
    boxShadow: shadowToast,
    fontSize: '13px',
    titleFontSize: '13px',
    descriptionFontSize: '12px'
  },
  Alert: {
    fontSize: '12.5px',
    lineHeight: '1.55',
    titleFontWeight: '600',
    borderRadius: radiusMd,
    border: `1px solid ${border}`,
    color: bgTag,
    titleTextColor: textPrimary,
    iconColor: accent,
    contentTextColor: textSecondary,
    closeColorHover: bgHover,
    closeColorPressed: bgActive,
    closeIconColor: textMuted,
    closeIconColorHover: accent,
    closeBorderRadius: radiusRound,
    borderInfo: `1px solid ${info}`,
    colorInfo: accentSoft,
    titleTextColorInfo: textPrimary,
    iconColorInfo: info,
    contentTextColorInfo: textSecondary,
    borderSuccess: `1px solid ${success}`,
    colorSuccess: `color-mix(in srgb, ${success} 12%, transparent)`,
    titleTextColorSuccess: textPrimary,
    iconColorSuccess: success,
    contentTextColorSuccess: textSecondary,
    borderWarning: `1px solid ${warning}`,
    colorWarning: `color-mix(in srgb, ${warning} 12%, transparent)`,
    titleTextColorWarning: textPrimary,
    iconColorWarning: warning,
    contentTextColorWarning: textSecondary,
    borderError: `1px solid ${danger}`,
    colorError: `color-mix(in srgb, ${danger} 12%, transparent)`,
    titleTextColorError: textPrimary,
    iconColorError: danger,
    contentTextColorError: textSecondary,
    iconMargin: '0 8px 0 0',
    iconSize: '18px',
    closeIconSize: '14px',
    closeSize: '20px',
    closeMargin: '0 0 0 8px',
    padding: '10px 14px'
  },
  Empty: {
    fontSizeTiny: '11px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    fontSizeHuge: '15px',
    textColor: textMuted,
    iconColor: textMuted,
    extraTextColor: textMuted,
    iconSizeTiny: '24px',
    iconSizeSmall: '32px',
    iconSizeMedium: '40px',
    iconSizeLarge: '48px',
    iconSizeHuge: '56px'
  },
  Divider: {
    textColor: textMuted,
    color: borderLight,
    fontWeight: '500'
  },
  Tabs: {
    tabTextColorLine: textSecondary,
    tabTextColorActiveLine: accent,
    tabTextColorHoverLine: accent,
    tabTextColorDisabledLine: textMuted,
    tabTextColorBar: textSecondary,
    tabTextColorActiveBar: accent,
    tabTextColorHoverBar: accent,
    tabTextColorDisabledBar: textMuted,
    tabTextColorCard: textSecondary,
    tabTextColorHoverCard: accent,
    tabTextColorActiveCard: accent,
    tabTextColorDisabledCard: textMuted,
    tabTextColorSegment: textSecondary,
    tabTextColorHoverSegment: accent,
    tabTextColorActiveSegment: accent,
    tabTextColorDisabledSegment: textMuted,
    barColor: accent,
    colorSegment: bgTag,
    tabColor: bgCard,
    tabColorSegment: bgCard,
    tabBorderColor: border,
    tabFontWeightActive: '600',
    tabFontWeight: '400',
    tabBorderRadius: radiusPill,
    paneTextColor: textSecondary,
    fontWeightStrong: '600',
    tabFontSizeSmall: '12px',
    tabFontSizeMedium: '13px',
    tabFontSizeLarge: '14px'
  },
  Progress: {
    fontSize: '12px',
    fontSizeCircle: '12px',
    fontWeightCircle: '500',
    railColor: bgTag,
    railHeight: '6px',
    fillColor: accent,
    fillColorInfo: info,
    fillColorSuccess: success,
    fillColorWarning: warning,
    fillColorError: danger,
    textColorCircle: textSecondary,
    textColorLineInner: textOnAccent,
    textColorLineOuter: textSecondary
  },
  LoadingBar: {
    colorError: danger,
    colorLoading: accent,
    height: '2px'
  },
  Spin: {
    color: accent,
    textColor: textSecondary
  }
}

/** 把 Chrome 计算出的 color(srgb ...) 归一化为 seemly 可解析的 rgb()/rgba() */
const toLegacyColor = (value: string): string => {
  const match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i.exec(
    value.trim()
  )
  if (!match) return value
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])].map((v) =>
    Math.round(v * 255)
  )
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 借助临时节点的 computed color 归一化任意合法颜色写法 */
const normalizeColor = (value: string): string => {
  if (typeof document === 'undefined') return value
  const host = document.body || document.documentElement
  if (!host) return value
  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = value
  host.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved ? toLegacyColor(resolved) : value
}

/** 替换字符串中的 var()，支持 fallback 内嵌套括号（如 rgba()） */
const replaceVars = (input: string, depth = 0): string => {
  if (depth > 8) return input
  let output = ''
  let cursor = 0
  while (cursor < input.length) {
    const start = input.indexOf('var(', cursor)
    if (start < 0) {
      output += input.slice(cursor)
      break
    }
    output += input.slice(cursor, start)

    let nesting = 0
    let end = -1
    for (let i = start + 4; i < input.length; i++) {
      if (input[i] === '(') nesting++
      else if (input[i] === ')') {
        if (nesting === 0) {
          end = i
          break
        }
        nesting--
      }
    }
    if (end < 0) {
      output += input.slice(start)
      break
    }

    const inner = input.slice(start + 4, end)
    let comma = -1
    nesting = 0
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') nesting++
      else if (inner[i] === ')') nesting--
      else if (inner[i] === ',' && nesting === 0) {
        comma = i
        break
      }
    }
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()
    const fromCss =
      typeof document !== 'undefined' && name.startsWith('--')
        ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        : ''
    const value = fromCss || fallback
    output += value ? replaceVars(value, depth + 1) : ''
    cursor = end + 1
  }
  return output
}

/** 将字符串中所有 color-mix() 求值为具体颜色 */
const resolveColorMix = (input: string): string => {
  let output = input
  let guard = 0
  while (output.includes('color-mix(') && guard++ < 8) {
    const start = output.indexOf('color-mix(')
    let nesting = 0
    let end = -1
    for (let i = start + 'color-mix('.length; i < output.length; i++) {
      if (output[i] === '(') nesting++
      else if (output[i] === ')') {
        if (nesting === 0) {
          end = i
          break
        }
        nesting--
      }
    }
    if (end < 0) break
    const expression = output.slice(start, end + 1)
    output = output.slice(0, start) + normalizeColor(expression) + output.slice(end + 1)
  }
  return output
}

const COLOR_LITERAL = /^(#|rgba?\(|hsla?\(|oklch?\(|lab\(|lch\(|color\(|color-mix\()/i

/** 解析单个覆盖值为具体 CSS 值（颜色表达式归一化为 rgb/rgba） */
const resolveThemeValueString = (value: string): string => {
  if (!value.includes('var(') && !value.includes('color-mix(')) {
    return COLOR_LITERAL.test(value.trim()) ? normalizeColor(value) : value
  }
  const resolved = resolveColorMix(replaceVars(value))
  return COLOR_LITERAL.test(resolved.trim()) ? normalizeColor(resolved) : resolved
}

const resolveThemeOverrides = <T>(value: T): T => {
  if (typeof value === 'string') return resolveThemeValueString(value) as T
  if (Array.isArray(value)) return value.map((item) => resolveThemeOverrides(item)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = resolveThemeOverrides(item)
    }
    return result as T
  }
  return value
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
  const themeOverrides = ref<GlobalThemeOverrides>(resolveThemeOverrides(NAIVE_THEME_OVERRIDES))

  const refresh = async () => {
    await nextTick()
    themeOverrides.value = resolveThemeOverrides(NAIVE_THEME_OVERRIDES)
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
    themeOverrides
  }
}
