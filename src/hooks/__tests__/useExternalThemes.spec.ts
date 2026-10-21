/**
 * useExternalThemes 单测：主题显示名元数据解析与文件名回退
 */
import { describe, it, expect } from 'vitest'
import { extractThemeLabel } from '@/hooks/useExternalThemes'

describe('extractThemeLabel', () => {
  it('提取 @theme-label 并去除首尾空白', () => {
    const css = '/* @theme-label: 丹青水墨 */\n:root { --theme-bg: #f3f0e7; }'
    expect(extractThemeLabel(css, 'danqing-ink')).toBe('丹青水墨')
  })

  it('未声明或内容为空时回退文件名', () => {
    expect(extractThemeLabel(':root { --theme-bg: #ffffff; }', 'my-theme')).toBe('my-theme')
    expect(extractThemeLabel('/* @theme-label:   */', 'my-theme')).toBe('my-theme')
  })

  it('超长标签截断到 40 个字符', () => {
    const css = `/* @theme-label: ${'墨'.repeat(60)} */`
    expect(extractThemeLabel(css, 'my-theme')).toHaveLength(40)
  })
})
