import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { useThemeLoader } from './useThemeLoader'

/**
 * 订阅主题 token 失效。
 *
 * 主题切换只更新 CSS 变量；任何把主题变量快照进 JS 的模块（圆角、尺寸、
 * Naive 颜色解析等）都必须通过本 composable 注册同步回调，否则会继续使用
 * 旧快照。回调在 post flush 执行：此时 data-theme 与外部主题 <style> 已写入，
 * 可以安全读取 getComputedStyle。
 *
 * 同时监听 currentTheme 与 themeRevision：主题名不变但外部主题重新注入
 * （如重启恢复、同主题更新）时 revision 仍会递增。
 */
export const useThemeTokenSync = (sync: () => void) => {
  const { currentTheme, themeRevision } = useThemeLoader()
  const stop = watch([currentTheme, themeRevision], () => sync(), { flush: 'post' })
  if (getCurrentScope()) onScopeDispose(stop)
  return { currentTheme, themeRevision, stop }
}
