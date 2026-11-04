/**
 * 轻量 Toast 提示（Cream 风格）
 *
 * 模块级单例队列：show 后按 duration 自动移除，由浮层组件统一渲染；
 * 各视图通过 success / error / warning / info 快捷调用。
 */
import { ref } from 'vue'

/** 单条提示：id 自增唯一，type 决定样式与图标 */
export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
}

const toasts = ref<ToastItem[]>([])
let nextId = 0

export const useCreamToast = () => {
  // 压入一条提示并定时移除
  const show = (message: string, type: ToastItem['type'] = 'success', duration = 2500) => {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, type }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, duration)
  }

  const success = (message: string, duration?: number) => show(message, 'success', duration)
  const error = (message: string, duration?: number) => show(message, 'error', duration)
  const warning = (message: string, duration?: number) => show(message, 'warning', duration)
  const info = (message: string, duration?: number) => show(message, 'info', duration)

  return { toasts, show, success, error, warning, info }
}
