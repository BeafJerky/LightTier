import { type } from '@tauri-apps/plugin-os'

let cachedAndroid: boolean | undefined

/**
 * 是否运行在 Android 平台（结果缓存）
 * 浏览器 mock 模式等非 Tauri 环境返回 false
 */
export const isAndroid = (): boolean => {
  if (cachedAndroid === undefined) {
    // 浏览器预览无法调用 Tauri OS 插件：开发态可用 ?platform=android 覆盖，便于验收移动端布局
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const override = new URLSearchParams(window.location.search).get('platform')
      if (override === 'android') {
        cachedAndroid = true
        return cachedAndroid
      }
      if (override === 'desktop') {
        cachedAndroid = false
        return cachedAndroid
      }
    }
    try {
      cachedAndroid = type() === 'android'
    } catch {
      cachedAndroid = false
    }
  }
  return cachedAndroid
}

/**
 * 是否运行在桌面平台（Windows / macOS / Linux）
 * 注：首版移动端仅支持 Android，其余非 Android 环境一律按桌面处理（含浏览器 mock 模式）
 */
export const isDesktop = (): boolean => !isAndroid()
