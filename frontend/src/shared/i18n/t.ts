/**
 * i18n 便捷入口 — 在非组件上下文（工具函数 / store）中调用全局翻译
 * 直接透传 key 与参数，不做命名空间拼接。
 */
import { i18n } from '@/shared/i18n'

export const t = (key: string, params?: Record<string, any>) => {
  // @ts-expect-error 非组件上下文的全局 t 调用参数类型与组件内 useI18n 不一致
  return i18n.global.t(key, params)
}
