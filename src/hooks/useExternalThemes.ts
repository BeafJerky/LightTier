/**
 * 外部主题发现、导入与恢复
 *
 * - 预置外部主题在构建期由前端打包（Android APK 的 resource 目录不可枚举，见下方 glob 说明）
 * - 桌面端另行扫描 resource/themes/*.css（Tauri Resource 目录），同名文件覆盖内置版本，支持用户自定义
 * - 导入的主题写入 AppData/themes（两端可写），优先级高于 Resource 与内置版本；浏览器预览存 localStorage
 * - 至少含 3 个 --theme- 变量才视为合法主题
 * - 显示名优先取 CSS 内的 `@theme-label: <中文名>` 元数据，缺省回退文件名
 * - 主题色徽标从 --theme-accent-primary 或 --theme-color-success 提取
 */
import { ref } from 'vue'
import { readTextFile, readDir, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { isAndroid } from '@/utils/platformUtil'
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

// 导入主题的落地目录：AppData 在桌面与 Android 均可写，避免修改安装目录/只读资源
const IMPORTED_THEME_DIR = 'themes'
// 浏览器预览无文件系统，导入主题存 localStorage 以便本地验收
const IMPORTED_THEME_STORAGE_KEY = 'lt.importedThemes'
// 内置主题由界面固定渲染，同名外部主题不会出现在列表中，直接拒绝
const RESERVED_THEME_NAMES = new Set(['cream', 'dark'])

const isTauriRuntime = (): boolean => {
  try {
    return isTauri()
  } catch {
    return false
  }
}

/** 已导入主题（仅浏览器 Mock）：忽略手工篡改的非法条目 */
const readMockImportedThemes = (): Map<string, string> => {
  const themes = new Map<string, string>()
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORTED_THEME_STORAGE_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return themes
    for (const item of parsed) {
      if (
        item &&
        typeof item.name === 'string' &&
        typeof item.cssText === 'string' &&
        isValidThemeName(item.name) &&
        !RESERVED_THEME_NAMES.has(item.name)
      ) {
        themes.set(item.name, item.cssText)
      }
    }
  } catch {
    /* 未导入或数据损坏：按无导入主题处理 */
  }
  return themes
}

const writeMockImportedThemes = (themes: Map<string, string>) => {
  try {
    const payload = [...themes].map(([name, cssText]) => ({ name, cssText }))
    localStorage.setItem(IMPORTED_THEME_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* 存储空间不足等场景：写入失败由调用方统一提示 */
  }
}

/** 读取全部已导入主题（AppData 目录 / 浏览器 localStorage） */
const readImportedThemes = async (): Promise<Map<string, string>> => {
  if (!isTauriRuntime()) return readMockImportedThemes()
  const themes = new Map<string, string>()
  try {
    const entries = await readDir(IMPORTED_THEME_DIR, { baseDir: BaseDirectory.AppData })
    for (const entry of entries) {
      const fileName = entry.name
      if (!fileName || !fileName.toLowerCase().endsWith('.css')) continue
      const name = fileName.replace(/\.css$/i, '')
      if (!isValidThemeName(name)) continue
      try {
        const cssText = (await readTextFile(`${IMPORTED_THEME_DIR}/${fileName}`, {
          baseDir: BaseDirectory.AppData
        })) as string
        themes.set(name, cssText)
      } catch {
        /* 单个文件读取失败：跳过 */
      }
    }
  } catch {
    /* 尚未导入过主题（目录不存在）或 AppData 不可读 */
  }
  return themes
}

/** 读取单个已导入主题，供应用/恢复时优先命中 */
const readImportedTheme = async (name: string): Promise<string | null> => {
  if (!isTauriRuntime()) return readMockImportedThemes().get(name) ?? null
  try {
    const cssText = (await readTextFile(`${IMPORTED_THEME_DIR}/${name}.css`, {
      baseDir: BaseDirectory.AppData
    })) as string
    return cssText
  } catch {
    return null
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
    // 导入主题优先级最高：同名时覆盖 Resource 扫描结果与构建期内置版本
    for (const [name, cssText] of await readImportedThemes()) {
      const theme = toThemeInfo(name, cssText)
      if (theme) merged.set(name, theme)
    }
    extThemes.value = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
    return extThemes.value
  }

  return { externalThemes: extThemes, discoverThemes }
}

/** 读取主题 CSS：导入主题 > 资源目录 > 构建期内置版本 */
export const loadThemeCss = async (name: string): Promise<string | null> => {
  const imported = await readImportedTheme(name)
  if (imported && isValidThemeCss(imported)) return imported
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

/** 导入结果：失败原因由界面映射为 i18n 文案 */
export type ImportThemeResult =
  | { ok: true; theme: ExternalThemeInfo }
  | { ok: false; reason: 'invalid-name' | 'reserved-name' | 'invalid-css' | 'write-failed' }

/** 校验并保存导入的主题文件（文件名即主题 ID，同名覆盖） */
export const importThemeFile = async (
  fileName: string,
  cssText: string
): Promise<ImportThemeResult> => {
  const name = fileName.replace(/\.css$/i, '').trim()
  if (!name || !isValidThemeName(name)) return { ok: false, reason: 'invalid-name' }
  if (RESERVED_THEME_NAMES.has(name)) return { ok: false, reason: 'reserved-name' }
  if (!isValidThemeCss(cssText)) return { ok: false, reason: 'invalid-css' }

  try {
    if (isTauriRuntime()) {
      await mkdir(IMPORTED_THEME_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      await writeTextFile(`${IMPORTED_THEME_DIR}/${name}.css`, cssText, {
        baseDir: BaseDirectory.AppData
      })
    } else {
      const themes = readMockImportedThemes()
      themes.set(name, cssText)
      writeMockImportedThemes(themes)
    }
  } catch (error) {
    console.error('导入主题失败:', error)
    return { ok: false, reason: 'write-failed' }
  }

  const theme = toThemeInfo(name, cssText)
  return theme ? { ok: true, theme } : { ok: false, reason: 'invalid-css' }
}

// 编写指南随构建内联：Android 与浏览器无需 Tauri 文件系统也能导出
const themeGuideFiles = import.meta.glob('/src-tauri/resource/themes/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const themeGuideText =
  Object.entries(themeGuideFiles).find(([path]) => /THEME_GUIDE\.md$/i.test(path))?.[1] ?? ''

export const THEME_GUIDE_FILE_NAME = 'LightTier-THEME_GUIDE.md'

export type SaveThemeGuideResult = 'saved' | 'cancelled' | 'failed'

/** 下载主题编写指南：桌面走保存对话框，Android/浏览器走 Blob 下载 */
export const downloadThemeGuide = async (): Promise<SaveThemeGuideResult> => {
  if (!themeGuideText) return 'failed'
  try {
    if (isTauriRuntime() && !isAndroid()) {
      const path = await save({
        defaultPath: THEME_GUIDE_FILE_NAME,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (!path) return 'cancelled'
      await writeTextFile(path, themeGuideText)
      return 'saved'
    }
    if (typeof document === 'undefined') return 'failed'
    const blob = new Blob([themeGuideText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = THEME_GUIDE_FILE_NAME
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // 立即 revoke 会让浏览器在写入完成前失去 blob，下载被取消；留足时间后再释放
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return 'saved'
  } catch (error) {
    console.error('下载主题编写指南失败:', error)
    return 'failed'
  }
}
