import { ref, watch } from 'vue'

/**
 * 页面级确认弹窗：把确认操作 Promise 化，供 CreamDialog 驱动。
 * 遮罩/取消等外部关闭同样按“取消”结算，避免调用方 await 永久悬挂。
 */
export function usePageConfirm() {
  const visible = ref(false)
  const title = ref('')
  const message = ref('')
  let resolvePending: ((value: boolean) => void) | null = null

  const show = (nextTitle: string, nextMessage: string): Promise<boolean> => {
    title.value = nextTitle
    message.value = nextMessage
    visible.value = true
    // 同一时刻仅保留一个确认框：新请求到达时旧请求按取消结算
    resolvePending?.(false)
    return new Promise<boolean>((resolve) => {
      resolvePending = resolve
    })
  }

  const resolve = (value: boolean) => {
    // 先摘除并结算，再隐藏；否则 sync watcher 会抢先按“取消”结算
    const settle = resolvePending
    resolvePending = null
    visible.value = false
    settle?.(value)
  }

  // sync：同一 tick 内“打开即关闭”也不会漏掉结算
  watch(
    visible,
    (v) => {
      if (!v && resolvePending) {
        resolvePending(false)
        resolvePending = null
      }
    },
    { flush: 'sync' }
  )

  return { visible, title, message, show, resolve }
}
