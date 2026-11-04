/**
 * i18n 便捷入口 — 在非组件上下文（工具函数 / store）中调用全局翻译
 * 直接透传 key 与参数，不做命名空间拼接。
 */
import { i18n } from '@/shared/i18n'

export const t = (key: string, params?: Record<string, any>) => {
  // @ts-ignore
  return i18n.global.t(key, params)
}
