/**
 * 外部主题发现与恢复
 *
 * - 预置外部主题在构建期由前端打包（Android APK 的 resource 目录不可枚举，见下方 glob 说明）
 * - 桌面端另行扫描 resource/themes/*.css（Tauri Resource 目录），同名文件覆盖内置版本，支持用户自定义
 * - 至少含 3 个 --theme- 变量才视为合法主题
 * - 显示名优先取 CSS 内的 `@theme-label: <中文名>` 元数据，缺省回退文件名
 * - 主题色徽标从 --theme-accent-primary 或 --theme-color-success 提取
 */
import { ref } from 'vue'
import { readTextFile, readDir } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { useThemeLoader } from './useThemeLoader'

/** 外部主题元信息（cssText 为完整样式文本，供应用时注入） */
export interface ExternalThemeInfo {
  name: string
  label: string
  color: string
  cssText: string
}

// 合法性判定：至少包含 3 个 --theme- 自定义变量（避免误把普通 css 当主题）
const isValidThemeCss = (cssText: string): boolean => {
  return (cssText.match(/--theme-/g) || []).length >= 3
}

// 合法主题名：仅字母/数字/中划线/下划线（主题名会拼入资源目录路径，拒绝路径穿越等注入形态）
const THEME_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
export const isValidThemeName = (name: string): boolean => THEME_NAME_PATTERN.test(name)

// 显示名元数据：CSS 注释中的 `@theme-label: 丹青水墨`；仅用于界面展示，不参与路径拼接
const THEME_LABEL_PATTERN = /@theme-label\s*:\s*([^*\r\n]+)/
const THEME_LABEL_MAX_LENGTH = 40

// 主题色徽标：优先主强调色，其次成功色
const THEME_COLOR_PATTERN = /--theme-(?:accent-primary|color-success)\s*:\s*([^;]+)/

/** 提取主题显示名；未声明、为空或超长时按规则回退/截断（文件名始终作为稳定 ID） */
export const extractThemeLabel = (cssText: string, fallback: string): string => {
  const label = cssText.match(THEME_LABEL_PATTERN)?.[1].trim()
  if (!label) return fallback
  return label.slice(0, THEME_LABEL_MAX_LENGTH)
}

const toThemeInfo = (name: string, cssText: string): ExternalThemeInfo | null => {
  if (!isValidThemeName(name) || !isValidThemeCss(cssText)) return null
  const match = cssText.match(THEME_COLOR_PATTERN)
  return {
    name,
    label: extractThemeLabel(cssText, name),
    color: match ? match[1].trim() : '#888',
    cssText
  }
}

/**
 * 预置外部主题在构建期内联：Android 安装包只包含 asset URI（无法 readDir 枚举），
 * 若仅在桌面端扫描资源目录，Android 的主题选择器中会完全没有这些主题。
 * 桌面端仍会扫描 resource/themes 并以同名文件覆盖，保留用户自定义能力。
 */
const bundledThemeCss = import.meta.glob('/src-tauri/resource/themes/*.css', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const themeNameFromPath = (path: string): string =>
  path
    .split('/')
    .pop()!
    .replace(/\.css$/i, '')

const bundledThemes: ExternalThemeInfo[] = Object.entries(bundledThemeCss)
  .map(([path, cssText]) => toThemeInfo(themeNameFromPath(path), cssText))
  .filter((theme): theme is ExternalThemeInfo => theme !== null)
  .sort((a, b) => a.name.localeCompare(b.name))

// 模块级单例：发现列表多组件共享
const extThemes = ref<ExternalThemeInfo[]>([])

export const useExternalThemes = () => {
  // 合并内置主题与资源目录扫描结果（资源目录中的同名主题优先）
  const discoverThemes = async (): Promise<ExternalThemeInfo[]> => {
    const merged = new Map(bundledThemes.map((theme) => [theme.name, theme]))
    try {
      const entries = await readDir('resource/themes', { baseDir: BaseDirectory.Resource })
      for (const e of entries.filter((e) => e.name?.endsWith('.css'))) {
        const name = e.name!.replace('.css', '')
        if (!isValidThemeName(name)) continue
        try {
          const cssText = (await readTextFile(`resource/themes/${e.name}`, {
            baseDir: BaseDirectory.Resource
          })) as string
          const theme = toThemeInfo(name, cssText)
          if (theme) merged.set(name, theme)
        } catch {
          /* 单个文件读取失败，保留内置版本或跳过 */
        }
      }
    } catch {
      /* Tauri API 不可用（浏览器 dev / Android asset 目录）：仅使用内置主题 */
    }
    extThemes.value = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
    return extThemes.value
  }

  return { externalThemes: extThemes, discoverThemes }
}

/** 读取主题 CSS：桌面端优先资源目录，缺失或不可读时回退构建期内置版本 */
export const loadThemeCss = async (name: string): Promise<string | null> => {
  try {
    const css = (await readTextFile(`resource/themes/${name}.css`, {
      baseDir: BaseDirectory.Resource
    })) as string
    if (isValidThemeCss(css)) return css
  } catch {
    /* 资源目录不可读：尝试内置主题 */
  }
  return bundledThemes.find((theme) => theme.name === name)?.cssText ?? null
}

/** 重启后恢复上次使用的外部主题 */
export const restoreTheme = async () => {
  const saved = localStorage.getItem('theme')
  // 内置主题无需恢复；主题名不合法（手工篡改 localStorage 等）直接忽略
  if (!saved || saved === 'cream' || saved === 'dark') return
  if (!isValidThemeName(saved)) return
  try {
    const css = await loadThemeCss(saved)
    if (!css) return
    // 恢复前再次确认 localStorage 中的主题仍是预期的（防止异步期间用户手动切换被覆盖）
    if (localStorage.getItem('theme') !== saved) return
    const { applyTheme } = useThemeLoader()
    applyTheme(saved, css) // 统一处理：注入CSS + 更新currentTheme + 设置data-theme
  } catch {
    /* 文件不存在或无法读取，忽略 */
  }
}
