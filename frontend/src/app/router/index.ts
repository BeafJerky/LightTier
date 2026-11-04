/**
 * 路由实例与装配
 *
 * - 采用哈希模式：Tauri / Android WebView 环境无服务端，hash 刷新不丢路由
 * - 仅保留 LightTier 新版布局路由（newLayoutRouterMap），根路径重定向到 /new
 * - setupRouter 在 main.ts 中调用
 */
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHashHistory } from 'vue-router'
import type { App } from 'vue'
import newLayoutRouterMap from './newLayout'

// 静态路由：仅根路径重定向（业务路由全部挂在 /new 布局下）
const rootRedirect: AppRouteRecordRaw = {
  path: '/',
  name: 'RootRedirect',
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
  app.use(router)
}

export default router
