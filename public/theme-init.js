/**
 * 首屏主题引导脚本（同步、经典脚本，勿改为 module/async/defer）。
 *
 * 必须在 <head> 中于主应用脚本之前同步执行，避免首屏闪白/闪黑。
 * 独立为外部文件是为了配合严格 CSP（script-src 'self'，禁止内联脚本）。
 */
;(function () {
  var root = document.documentElement
  if (root.getAttribute('data-theme')) return
  var t = localStorage.getItem('theme')
  // 用户未显式选择主题时跟随系统深色偏好（首屏即生效，避免闪白/闪黑）
  if (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    t = 'dark'
  }
  if (t) root.setAttribute('data-theme', t)
})()