import type { RouteRecordRaw } from 'vue-router'

interface RouteMetaCustom extends Record<string | number | symbol, unknown> {
  title?: string
  subtitle?: string
  titleKey?: string
  subtitleKey?: string
  icon?: string
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
