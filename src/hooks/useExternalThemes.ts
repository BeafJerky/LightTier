/**
 * 外部主题发现与恢复
 *
 * - 扫描 resource/themes/*.css（Tauri Resource 目录），至少含 3 个 --theme- 变量才视为合法主题
 * - 主题色徽标从 --theme-accent-primary 或 --theme-color-success 提取
 * - 浏览器 dev 模式（无 Tauri API）下静默跳过，不阻塞页面
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

// 模块级单例：发现列表多组件共享
const extThemes = ref<ExternalThemeInfo[]>([])

export const useExternalThemes = () => {
  // 扫描资源目录并解析全部合法主题
  const discoverThemes = async (): Promise<ExternalThemeInfo[]> => {
    extThemes.value = []
    try {
      const entries = await readDir('resource/themes', { baseDir: BaseDirectory.Resource })
      for (const e of entries.filter((e) => e.name?.endsWith('.css'))) {
        const name = e.name!.replace('.css', '')
        if (!isValidThemeName(name)) continue
        try {
          const cssText = (await readTextFile(`resource/themes/${e.name}`, {
            baseDir: BaseDirectory.Resource
          })) as string
          if (!isValidThemeCss(cssText)) continue
          const match = cssText.match(/--theme-(?:accent-primary|color-success)\s*:\s*([^;]+)/)
          extThemes.value.push({
            name,
            label: name,
            color: match ? match[1].trim() : '#888',
            cssText
          })
        } catch {
          /* 单个文件读取失败，跳过 */
        }
      }
    } catch {
      /* Tauri API 不可用，浏览器 dev 模式降级 */
    }
    return extThemes.value
  }

  return { externalThemes: extThemes, discoverThemes }
}

/** 重启后恢复上次使用的外部主题 */
export const restoreTheme = async () => {
  const saved = localStorage.getItem('theme')
  // 内置主题无需恢复；主题名不合法（手工篡改 localStorage 等）直接忽略
  if (!saved || saved === 'cream' || saved === 'dark') return
  if (!isValidThemeName(saved)) return
  try {
    const css = (await readTextFile(`resource/themes/${saved}.css`, {
      baseDir: BaseDirectory.Resource
    })) as string
    // 恢复前再次确认 localStorage 中的主题仍是预期的（防止异步期间用户手动切换被覆盖）
    if (localStorage.getItem('theme') !== saved) return
    if (!isValidThemeCss(css)) return
    const { applyTheme } = useThemeLoader()
    applyTheme(saved, css) // 统一处理：注入CSS + 更新currentTheme + 设置data-theme
  } catch {
    /* 文件不存在或无法读取，忽略 */
  }
}
