/**
 * useExternalThemes 单测：主题显示名解析、构建期内置主题与资源目录覆盖
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { extractThemeLabel, useExternalThemes } from '@/hooks/useExternalThemes'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  BaseDirectory: { Resource: 11 }
}))

const mockedReadDir = vi.mocked(readDir)
const mockedReadTextFile = vi.mocked(readTextFile)

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

describe('discoverThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('资源目录不可读时回退到构建期内置主题', async () => {
    mockedReadDir.mockRejectedValue(new Error('asset URI not enumerable'))

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()

    const names = themes.map((theme) => theme.name)
    expect(names).toHaveLength(10)
    expect(names).toContain('cha-yan')
    expect(names).toContain('cyberpunk-2077')
    expect(new Set(names).size).toBe(names.length)
    expect(themes.find((theme) => theme.name === 'cha-yan')?.label).toBe('茶烟')
  })

  it('资源目录中的同名主题覆盖内置版本，其余内置主题保留', async () => {
    mockedReadDir.mockResolvedValue([{ name: 'cha-yan.css' }] as never)
    mockedReadTextFile.mockResolvedValue(
      '/* @theme-label: 自定义茶烟 */\n:root { --theme-bg: #fff; --theme-text-primary: #000; --theme-accent-primary: #123456; }'
    )

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()

    expect(themes).toHaveLength(10)
    const custom = themes.find((theme) => theme.name === 'cha-yan')
    expect(custom?.label).toBe('自定义茶烟')
    expect(custom?.color).toBe('#123456')
  })

  it('资源目录中的非法主题不会覆盖内置版本', async () => {
    mockedReadDir.mockResolvedValue([{ name: 'qing-ci.css' }] as never)
    mockedReadTextFile.mockResolvedValue(':root { color: red; }')

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()

    expect(themes.find((theme) => theme.name === 'qing-ci')?.label).toBe('青瓷')
  })
})
