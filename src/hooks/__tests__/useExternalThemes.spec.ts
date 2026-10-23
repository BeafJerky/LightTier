/**
 * useExternalThemes 单测：主题显示名解析、构建期内置主题与资源目录覆盖
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import {
  extractThemeLabel,
  importThemeFile,
  loadThemeCss,
  useExternalThemes
} from '@/hooks/useExternalThemes'

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
