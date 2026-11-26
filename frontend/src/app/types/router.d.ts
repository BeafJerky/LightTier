import type { RouteRecordRaw } from 'vue-router'

interface RouteMetaCustom extends Record<string | number | symbol, unknown> {
  title?: string
  subtitle?: string
  titleKey?: string
  subtitleKey?: string
  icon?: string
  /** 免登录页面（agent 模式下会话门禁直接放行；native / mock 不读取该标记） */
  public?: boolean
}

declare module 'vue-router' {
  interface RouteMeta extends RouteMetaCustom {}
}

declare global {
  interface AppRouteRecordRaw extends Omit<RouteRecordRaw, 'meta' | 'children'> {
    name: string
    meta: RouteMetaCustom
    component?: RouteRecordRaw['component']
    children?: AppRouteRecordRaw[]
    fullPath?: string
  }
}
