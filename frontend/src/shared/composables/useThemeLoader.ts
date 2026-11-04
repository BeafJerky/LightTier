/**
 * 主题加载器
 *
 * - 内置主题通过 data-theme 属性生效（cream / dark 由 CSS 变量定义）
 * - 外部主题（resource/themes/*.css）注入 <style id="custom-theme"> 后生效
 * - currentTheme 为模块级单例，多个组件共享同一主题状态
 * - 默认主题跟随系统深色偏好：用户未显式选择（localStorage 无 theme）时，
 *   系统深色 → dark，否则 cream；用户手动选择后持久化并优先
 * - 切换主题后缓存首屏调色板，供 index.html 在主题 CSS 加载前还原背景与强调色
 */
import { ref } from 'vue'

/** 系统是否偏好深色（非浏览器环境恒为 false） */
const prefersDark = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 读取用户显式选择的主题名（非浏览器环境为 null） */
const readSavedTheme = (): string | null => {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem('theme')
}

/** 系统偏好推导出的默认主题（不含用户显式选择） */
export const systemDefaultTheme = (): string => (prefersDark() ? 'dark' : 'cream')

/** 解析默认主题：显式选择 > 系统深色偏好 > cream */
export const resolveDefaultTheme = (): string => readSavedTheme() || systemDefaultTheme()

const currentTheme = ref(resolveDefaultTheme())
// 主题应用版本号：即使主题名未变（重启恢复外部主题），也能通知依赖方重新读取计算样式
const themeRevision = ref(0)

const SPLASH_PALETTE_KEY = 'theme-splash-palette'

/** 缓存首屏实际生效的颜色：主题 CSS 在应用启动后才加载，首屏脚本只能读 localStorage */
const persistSplashPalette = (name: string) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  try {
    const style = window.getComputedStyle(document.documentElement)
    const read = (property: string, fallback: string) =>
      style.getPropertyValue(property).trim() || fallback
    localStorage.setItem(
      SPLASH_PALETTE_KEY,
      JSON.stringify({
        name,
        bg: read('--theme-bg', '#fdf8f4'),
        title: read('--theme-text-primary', '#4a3728'),
        accent: read('--theme-accent-primary', '#e8a0a0'),
        accentSoft: read('--theme-accent-secondary', '#b8a9c9')
      })
    )
  } catch {
    /* 存储不可用时首屏保持兜底色，不影响主题切换 */
  }
}

export const useThemeLoader = () => {
  // 注入外部主题样式（先移除旧的，保证单实例）
  const injectExternalTheme = (cssText: string) => {
    removeExternalTheme()
    const style = document.createElement('style')
    style.id = 'custom-theme'
    style.textContent = cssText
    document.head.appendChild(style)
  }

  const removeExternalTheme = () => {
    document.getElementById('custom-theme')?.remove()
  }

  // 应用主题：记录名称 + 注入/移除外部 CSS + 更新 data-theme 属性
  const applyTheme = (name: string, externalCss?: string) => {
    currentTheme.value = name
    localStorage.setItem('theme', name)

    if (externalCss) {
      injectExternalTheme(externalCss)
    } else {
      removeExternalTheme()
    }
    document.documentElement.setAttribute('data-theme', name)
    themeRevision.value++
    persistSplashPalette(name)
  }

  // 切换内置主题（不写 localStorage：用于「跟随系统」场景，避免被当成用户显式选择）
  const setBuiltinTheme = (name: string) => {
    removeExternalTheme()
    currentTheme.value = name
    document.documentElement.setAttribute('data-theme', name)
    themeRevision.value++
    persistSplashPalette(name)
  }

  // 重置回默认主题（清理存储与注入的样式）；返回实际生效的默认主题名
  const resetTheme = (): string => {
    localStorage.removeItem('theme')
    const fallback = systemDefaultTheme()
    setBuiltinTheme(fallback)
    return fallback
  }

  /**
   * 跟随系统深色偏好变化：仅在用户未显式选择主题时生效
   * 返回取消监听函数（非浏览器环境返回 null）
   */
  const watchSystemTheme = (): (() => void) | null => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      // 用户已手动选过主题：不再跟随系统，尊重显式选择
      if (readSavedTheme()) return
      setBuiltinTheme(e.matches ? 'dark' : 'cream')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }

  return {
    currentTheme,
    themeRevision,
    applyTheme,
    resetTheme,
    setBuiltinTheme,
    watchSystemTheme,
    injectExternalTheme,
    removeExternalTheme
  }
}
