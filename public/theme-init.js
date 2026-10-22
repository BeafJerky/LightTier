/**
 * 首屏主题引导脚本（同步、经典脚本，勿改为 module/async/defer）。
 *
 * 必须在 <head> 中于主应用脚本之前同步执行，避免首屏闪白/闪黑。
 * 独立为外部文件是为了配合严格 CSP（script-src 'self'，禁止内联脚本）。
 */
;(function () {
  var root = document.documentElement
  var theme = root.getAttribute('data-theme')
  if (!theme) {
    theme = localStorage.getItem('theme')
    // 用户未显式选择主题时跟随系统深色偏好（首屏即生效，避免闪白/闪黑）
    if (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark'
    }
    if (theme) root.setAttribute('data-theme', theme)
  }

  // 调色板由 useThemeLoader 在每次切换主题后写入；早于应用主包加载，
  // 让首屏背景/标题/双环进度直接使用当前主题色。
  try {
    var palette = JSON.parse(localStorage.getItem('theme-splash-palette') || 'null')
    if (palette && palette.name === (theme || 'cream')) {
      if (palette.bg) root.style.setProperty('--lt-loading-bg', palette.bg)
      if (palette.title) root.style.setProperty('--lt-loading-title', palette.title)
      if (palette.accent) root.style.setProperty('--lt-loading-accent', palette.accent)
      if (palette.accentSoft) root.style.setProperty('--lt-loading-accent-soft', palette.accentSoft)
    }
  } catch (e) {
    /* 调色板缺失或损坏时保持 loading.css 的兜底色 */
  }
})()
