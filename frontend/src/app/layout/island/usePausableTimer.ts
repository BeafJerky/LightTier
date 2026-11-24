import { onScopeDispose, watch, type Ref } from 'vue'

export function usePausableTimer(paused: Readonly<Ref<boolean>>) {
  let handle: number | null = null
  let callback: (() => void) | null = null
  let remaining = 0
  let startedAt = 0
  let running = false

  const clear = () => {
    if (handle !== null) globalThis.clearTimeout(handle)
    handle = null
    running = false
  }

  const start = () => {
    if (running || paused.value || !callback || remaining <= 0) return
    startedAt = Date.now()
    running = true
    handle = globalThis.setTimeout(() => {
      handle = null
      running = false
      remaining = 0
      const next = callback
      callback = null
      next?.()
    }, remaining) as unknown as number
  }

  const pause = () => {
    if (!running) return
    clear()
    remaining = Math.max(0, remaining - (Date.now() - startedAt))
  }

  const schedule = (delay: number, next: () => void) => {
    clear()
    callback = next
    remaining = Math.max(0, delay)
    start()
  }

  const cancel = () => {
    clear()
    callback = null
    remaining = 0
  }

  watch(paused, (value) => (value ? pause() : start()), { flush: 'sync' })
  onScopeDispose(cancel)

  return { schedule, cancel }
}
