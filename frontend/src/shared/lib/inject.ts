import { inject, type InjectionKey } from 'vue'

/** 注入必需依赖：缺失时立即抛错，避免非空断言掩盖提供者漏配 */
export function injectRequired<T>(key: InjectionKey<T>, context?: string): T {
  const value = inject(key)
  if (value === undefined) {
    throw new Error(
      `[injectRequired] 缺少注入依赖 ${String(key)}${context ? `（使用方：${context}）` : ''}`
    )
  }
  return value
}
