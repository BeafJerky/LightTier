/**
 * 路由实例与装配
 *
 * - 采用哈希模式：Tauri / Android WebView 环境无服务端，hash 刷新不丢路由
 * - 基础路由表只有根路径重定向 + 新版布局路由（newLayoutRouterMap），
 *   native / mock 模式的路由表与 agent 之前完全一致（无登录页、无兜底路由）
 * - agent 模式额外注册：登录 / 初始化整页路由（不套布局，标记 `meta.public`
 *   免会话门禁）与兜底路由；两者由 `setupRouter` 在 `initBackend()` 判定模式后
 *   通过 `addRoute` 注入——模块导入期无法得知模式，所以不能写死在 `routes` 里
 * - setupRouter 在 main.ts 中于 `initBackend()` 之后调用；agent 会话守卫同样在
 *   main.ts 按模式安装
 */
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHashHistory } from 'vue-router'
import type { App } from 'vue'
import { backendMode } from '@/shared/platform/backend'
import newLayoutRouterMap from './newLayout'

// 静态路由：仅根路径重定向（业务路由全部挂在 /new 布局下）
const rootRedirect: AppRouteRecordRaw = {
  path: '/',
  name: 'RootRedirect',
  meta: {},
  redirect: '/new'
}

// agent 鉴权页：独立整页（不套 NewLayout），仅 agent 模式注册与导航
const authRoutes: AppRouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/features/auth/views/LoginView.vue'),
    meta: { public: true }
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/features/auth/views/SetupView.vue'),
    meta: { public: true }
  }
]

// agent 兜底路由：未匹配的链接（如手输 `#/monitor`）回到应用首页，而不是空白页。
// 同样只在 agent 模式注册，native / mock 保持无兜底路由的原行为。
const catchAll: AppRouteRecordRaw = {
  path: '/:pathMatch(.*)*',
  name: 'CatchAll',
  meta: {},
  redirect: '/new'
}

const router = createRouter({
  history: createWebHashHistory(),
  strict: true,
  routes: [rootRedirect, ...newLayoutRouterMap] as RouteRecordRaw[],
  scrollBehavior: () => ({ left: 0, top: 0 })
})

export const setupRouter = (app: App<Element>) => {
  // 模式已由 main.ts 的 initBackend() 判定，这里才第一次拿到确定结果
  if (backendMode() === 'agent') {
    // 静态路径按分值优先于 `/:pathMatch(.*)*`，兜底路由放在最后注册即可
    for (const route of authRoutes) router.addRoute(route as RouteRecordRaw)
    router.addRoute(catchAll as RouteRecordRaw)
  }
  app.use(router)
}

export default router
