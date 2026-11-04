/**
 * 主题颜色工具（纯函数）
 *
 * 用主题背景色判断当前主题的明暗，供 Naive UI 选择 light / dark 基础主题。
 * 内置主题可通过名称直接判定；外部主题（resource/themes/*.css）名称不可预知，
 * 因此以 `--theme-bg` 的计算值做亮度判定，解析失败时再回退到名称中的 dark 语义。
 */

export type RgbColor = [number, number, number]

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i
const RGB_PATTERN = /^rgba?\(\s*([^)]+)\)$/i

const parseColorChannel = (token: string): number | null => {
  const value = token.trim()
  if (!value) return null
  const parsed = value.endsWith('%')
    ? (Number.parseFloat(value) / 100) * 255
    : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(255, Math.max(0, parsed))
}

/**
 * 解析十六进制 / rgb() / rgba() 颜色为 RGB。
 * 不支持 hsl() 等其余写法；调用方可在浏览器环境用 canvas 兜底。
 */
export const parseCssColor = (input: string | null | undefined): RgbColor | null => {
  if (!input) return null
  const color = input.trim()
  if (!color) return null

  const hex = color.match(HEX_PATTERN)
  if (hex) {
    const raw = hex[1]
    // #rgb / #rgba / #rrggbb / #rrggbbaa：忽略 alpha，背景色以实色近似
    if (raw.length === 3 || raw.length === 4) {
      return [
        Number.parseInt(raw[0] + raw[0], 16),
        Number.parseInt(raw[1] + raw[1], 16),
        Number.parseInt(raw[2] + raw[2], 16)
      ]
    }
    if (raw.length === 6 || raw.length === 8) {
      return [
        Number.parseInt(raw.slice(0, 2), 16),
        Number.parseInt(raw.slice(2, 4), 16),
        Number.parseInt(raw.slice(4, 6), 16)
      ]
    }
    return null
  }

  const rgb = color.match(RGB_PATTERN)
  if (rgb) {
    // 兼容逗号与空格写法：rgb(13, 27, 42) / rgb(13 27 42 / 0.8)
    const [channelsPart] = rgb[1].split('/')
    const tokens = channelsPart.includes(',')
      ? channelsPart.split(',')
      : channelsPart.trim().split(/\s+/)
    if (tokens.length < 3) return null
    const channels = tokens.slice(0, 3).map(parseColorChannel)
    if (channels.some((channel) => channel === null)) return null
    return channels as RgbColor
  }

  return null
}

/** WCAG 相对亮度（0 黑 → 1 白） */
export const relativeLuminance = ([r, g, b]: RgbColor): number => {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** 背景色是否偏暗；解析失败返回 null，由调用方决定回退策略 */
export const isDarkBackgroundColor = (color: string | null | undefined): boolean | null => {
  const rgb = parseCssColor(color)
  if (!rgb) return null
  return relativeLuminance(rgb) < 0.45
}

const DARK_NAME_PATTERN = /(^|[-_\s])(dark|night|midnight|black)([-_\s]|$)/i

/**
 * 判定主题是否使用暗色基底：
 * 内置主题按名称快判 → 背景色亮度 → 名称语义 → 默认浅色。
 */
export const detectDarkTheme = (themeName: string, background?: string | null): boolean => {
  if (themeName === 'dark') return true
  if (themeName === 'cream') return false

  const byBackground = isDarkBackgroundColor(background)
  if (byBackground !== null) return byBackground

  return DARK_NAME_PATTERN.test(themeName)
}
