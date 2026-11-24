import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { usePausableTimer } from '@/app/layout/island/usePausableTimer'

describe('usePausableTimer', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.useFakeTimers()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  it('暂停后保留剩余时长，恢复时不会立即执行', () => {
    const paused = ref(false)
    const callback = vi.fn()
    const timer = scope.run(() => usePausableTimer(paused))!
    timer.schedule(1_000, callback)
    vi.advanceTimersByTime(400)

    paused.value = true
    vi.advanceTimersByTime(2_000)
    expect(callback).not.toHaveBeenCalled()

    paused.value = false
    vi.advanceTimersByTime(599)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('悬停与焦点任一成立都暂停，两个来源都离开才恢复', () => {
    const hovered = ref(false)
    const focused = ref(false)
    const paused = computed(() => hovered.value || focused.value)
    const callback = vi.fn()
    const timer = scope.run(() => usePausableTimer(paused))!
    timer.schedule(1_000, callback)
    vi.advanceTimersByTime(200)

    hovered.value = true
    focused.value = true
    hovered.value = false
    vi.advanceTimersByTime(2_000)
    expect(callback).not.toHaveBeenCalled()

    focused.value = false
    vi.advanceTimersByTime(799)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('暂停期间收到的新计时不会在恢复时丢失', () => {
    const paused = ref(true)
    const callback = vi.fn()
    const timer = scope.run(() => usePausableTimer(paused))!
    timer.schedule(3_600, callback)
    vi.advanceTimersByTime(5_000)

    paused.value = false
    vi.advanceTimersByTime(3_599)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('重新安排会取消旧回调，作用域销毁会清理待执行任务', () => {
    const paused = ref(false)
    const first = vi.fn()
    const second = vi.fn()
    const timer = scope.run(() => usePausableTimer(paused))!
    timer.schedule(1_000, first)
    timer.schedule(500, second)
    vi.advanceTimersByTime(1_000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    timer.schedule(1_000, second)
    scope.stop()
    vi.advanceTimersByTime(1_000)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
