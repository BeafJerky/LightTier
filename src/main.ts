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

// 引入动画
import '@/plugins/animate.css'

// 路由
import { setupRouter } from './router'

import { createApp } from 'vue'

import App from './App.vue'

import { t } from './utils/i18nUtil'

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
