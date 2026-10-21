/**
 * themeColorUtil 单测：Naive UI 暗色基础主题的判定依据。
 */
import { describe, expect, it } from 'vitest'
import {
  detectDarkTheme,
  isDarkBackgroundColor,
  parseCssColor,
  relativeLuminance
} from '@/utils/themeColorUtil'

describe('parseCssColor', () => {
  it('解析 3/6 位十六进制颜色', () => {
    expect(parseCssColor('#fff')).toEqual([255, 255, 255])
    expect(parseCssColor('#0d1b2a')).toEqual([13, 27, 42])
  })

  it('解析 4/8 位十六进制颜色并忽略 alpha', () => {
    expect(parseCssColor('#0d1b2acc')).toEqual([13, 27, 42])
  })

  it('解析逗号与空格两种 rgb 写法', () => {
    expect(parseCssColor('rgb(253, 248, 244)')).toEqual([253, 248, 244])
    expect(parseCssColor('rgb(13 27 42 / 80%)')).toEqual([13, 27, 42])
    expect(parseCssColor('rgba(27, 40, 56, 0.9)')).toEqual([27, 40, 56])
  })

  it('拒绝不支持的写法与非法通道', () => {
    expect(parseCssColor('hsl(210 30% 20%)')).toBeNull()
    expect(parseCssColor('rgb(255, nope, 0)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor(undefined)).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('黑为 0、白为 1，奶油底色接近浅色', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
    expect(relativeLuminance([253, 248, 244])).toBeGreaterThan(0.9)
  })
})

describe('isDarkBackgroundColor', () => {
  it('区分内置主题底色', () => {
    expect(isDarkBackgroundColor('#0d1b2a')).toBe(true)
    expect(isDarkBackgroundColor('#fdf8f4')).toBe(false)
  })

  it('无法解析时返回 null，交给调用方回退', () => {
    expect(isDarkBackgroundColor('oklch(0.2 0.02 240)')).toBeNull()
    expect(isDarkBackgroundColor(undefined)).toBeNull()
  })
})

describe('detectDarkTheme', () => {
  it('内置主题按名称快判，不依赖背景色', () => {
    expect(detectDarkTheme('dark', '#ffffff')).toBe(true)
    expect(detectDarkTheme('cream', '#000000')).toBe(false)
  })

  it('外部主题优先按背景亮度判定', () => {
    expect(detectDarkTheme('sakura', '#101820')).toBe(true)
    expect(detectDarkTheme('midnight', '#fefefe')).toBe(false)
  })

  it('背景无法解析时按名称语义回退', () => {
    expect(detectDarkTheme('midnight-blue', 'oklch(0.2 0.02 240)')).toBe(true)
    expect(detectDarkTheme('paper', 'oklch(0.95 0.02 90)')).toBe(false)
  })
})
