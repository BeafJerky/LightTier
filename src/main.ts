/**
 * 应用入口
 *
 * 装配顺序：i18n → store → 全局组件 → 路由 → mount；
 * 不阻塞启动的后台任务（出口路由残留清理）由 App 内的 StartupTasks 执行。
 * 启动设置（最小化到托盘 / 自动运行网络）不在本文件编排：
 * 前者由 App.vue 在窗口展示流程中处理，后者由 overview 页按 settings.autoRunNetwork 触发。
 */
import 'vue/jsx'

// 引入windi css
import '@/plugins/unocss'

// 初始化多语言
import { setupI18n } from '@/plugins/vueI18n'

// 引入状态管理
import { setupStore } from '@/store'

// 全局组件
import { setupGlobCom } from '@/components'

// 引入全局样式
import '@/styles/index.less'

// 引入主题系统
import '@/styles/theme.css'

// 引入自适应层（触屏命中区/按压态、系统减少动效、触屏窄屏字号）
import '@/styles/adaptive.css'

// 路由
import { setupRouter } from './router'

import { createApp } from 'vue'

import App from './App.vue'

import { t } from './utils/i18nUtil'

// 触摸 WebView 会把点按也判定为 focus-visible，导致按钮松手后残留焦点框；
// 记录最近一次输入模态：指针输入后关闭焦点环，任一按键（含 Esc）恢复键盘模态，
// 这样 Esc 关闭弹窗后还原焦点的按钮仍能被识别为键盘聚焦。
const rootEl = document.documentElement
window.addEventListener('pointerdown', () => (rootEl.dataset.input = 'pointer'), true)
window.addEventListener(
  'keydown',
  (e) => {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    rootEl.dataset.input = 'keyboard'
  },
  true
)

// NButton 在 mousedown 时主动聚焦；指针手势若没有产生 click（拖拽滚动、按住后拖出控件再松手），
// 焦点会一直留在按钮上，Naive 的 focus 配色会让按钮看起来始终处于按下状态。
// 正常点按交给 LtButton 在 click 后失焦（此时弹窗已记录触发元素，键盘关闭仍能还原焦点）；
// 这里只兜住被取消的指针手势，键盘焦点不受影响。
const releaseButtonFocus = (e: PointerEvent) => {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.classList.contains('lt-btn')) return
  const clickedHere =
    e.type === 'pointerup' && e.target instanceof Node && active.contains(e.target)
  if (!clickedHere) active.blur()
}
window.addEventListener('pointerup', releaseButtonFocus, true)
window.addEventListener('pointercancel', releaseButtonFocus, true)

// 创建应用实例并完成全部装配
const setupAll = async () => {
  const app = createApp(App)

  await setupI18n(app)

  setupStore(app)

  setupGlobCom(app)

  setupRouter(app)

  app.mount('#app')
}

setupAll().catch((err) => {
  console.error('应用启动失败:', err)
  alert(t('newCommon.appStartFail'))
})
