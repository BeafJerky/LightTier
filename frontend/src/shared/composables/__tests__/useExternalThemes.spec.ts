/**
 * useExternalThemes 单测：主题显示名解析、构建期内置主题与资源目录覆盖
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import {
  extractThemeCategory,
  extractThemeLabel,
  importThemeFile,
  loadThemeCss,
  useExternalThemes
} from '@/shared/composables/useExternalThemes'

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

describe('extractThemeCategory', () => {
  it('读取 @theme-category，忽略大小写与空白', () => {
    expect(extractThemeCategory('/* @theme-category: color */\n:root {}')).toBe('color')
    expect(extractThemeCategory('/* @theme-category:  Style  */\n:root {}')).toBe('style')
  })

  it('缺省、空值或非法取值返回 null', () => {
    expect(extractThemeCategory(':root { --theme-bg: #fff; }')).toBeNull()
    expect(extractThemeCategory('/* @theme-category:   */')).toBeNull()
    expect(extractThemeCategory('/* @theme-category: fancy */')).toBeNull()
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
    expect(names).toHaveLength(13)
    expect(names).toContain('cha-yan')
    expect(names).toContain('cyberpunk-2077')
    expect(names).toContain('famicom')
    expect(names).toContain('claude')
    expect(names).toContain('neumorphism')
    expect(new Set(names).size).toBe(names.length)
    expect(themes.find((theme) => theme.name === 'cha-yan')?.label).toBe('茶烟')
    expect(themes.find((theme) => theme.name === 'neumorphism')?.label).toBe('拟态')
  })

  it('分类读取元数据，缺省按 html[data-theme] 规则推断', async () => {
    mockedReadDir.mockRejectedValue(new Error('asset URI not enumerable'))

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()
    const categoryOf = (name: string) => themes.find((theme) => theme.name === name)?.category

    // Claude 无色骨架规则，靠显式元数据归为风格化
    expect(categoryOf('claude')).toBe('style')
    // 红白机 / 拟态含 html[data-theme] 覆盖规则，自动推断为风格化
    expect(categoryOf('famicom')).toBe('style')
    expect(categoryOf('neumorphism')).toBe('style')
    // 赛博朋克只改投影语言，靠显式元数据归为风格化
    expect(categoryOf('cyberpunk')).toBe('style')
    expect(categoryOf('cyberpunk-2077')).toBe('style')
    expect(categoryOf('cha-yan')).toBe('color')
    expect(categoryOf('cream-vibrant')).toBe('color')
  })

  it('资源目录中的同名主题覆盖内置版本，其余内置主题保留', async () => {
    mockedReadDir.mockResolvedValue([{ name: 'cha-yan.css' }] as never)
    mockedReadTextFile.mockResolvedValue(
      '/* @theme-label: 自定义茶烟 */\n:root { --theme-bg: #fff; --theme-text-primary: #000; --theme-accent-primary: #123456; }'
    )

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()

    expect(themes).toHaveLength(13)
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

describe('importThemeFile（浏览器 Mock）', () => {
  const storage = new Map<string, string>()
  const VALID_CSS =
    '/* @theme-label: 海盐 */\n:root { --theme-bg: #eef6fb; --theme-text-primary: #243b53; --theme-accent-primary: #4a90c2; }'

  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    })
    mockedReadDir.mockRejectedValue(new Error('asset URI not enumerable'))
  })

  it('保存合法主题并可被发现、读取', async () => {
    const result = await importThemeFile('sea-salt.css', VALID_CSS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.theme.name).toBe('sea-salt')
      expect(result.theme.label).toBe('海盐')
      expect(result.theme.color).toBe('#4a90c2')
    }

    const { discoverThemes } = useExternalThemes()
    const themes = await discoverThemes()
    expect(themes.some((theme) => theme.name === 'sea-salt')).toBe(true)
    await expect(loadThemeCss('sea-salt')).resolves.toBe(VALID_CSS)
  })

  it('拒绝非法文件名、内置主题名与无效 CSS', async () => {
    await expect(importThemeFile('我的主题.css', VALID_CSS)).resolves.toEqual({
      ok: false,
      reason: 'invalid-name'
    })
    await expect(importThemeFile('dark.css', VALID_CSS)).resolves.toEqual({
      ok: false,
      reason: 'reserved-name'
    })
    await expect(importThemeFile('plain.css', 'body { color: red; }')).resolves.toEqual({
      ok: false,
      reason: 'invalid-css'
    })
    expect(storage.size).toBe(0)
  })

  it('同名导入覆盖已保存的版本', async () => {
    await importThemeFile('sea-salt.css', VALID_CSS)
    const updated = '/* @theme-label: 深海 */\n:root { --theme-a: 1; --theme-b: 2; --theme-c: 3; }'
    const result = await importThemeFile('sea-salt.css', updated)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.theme.label).toBe('深海')
    await expect(loadThemeCss('sea-salt')).resolves.toBe(updated)
  })
})
