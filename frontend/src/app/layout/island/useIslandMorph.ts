import { onBeforeUnmount, watch, type Ref } from 'vue'
import { ISLAND_SPRINGS, Spring } from '@/shared/lib/island/spring'

/**
 * 只驱动外壳宽高，直接写 DOM，绕过逐帧响应式更新：
 * 形态动画期间不触发组件重渲染，也不让内容随宽度逐帧重排。
 * 内容层由外壳裁切、用固定目标尺寸排版，收展时只做透明度交叉淡入淡出。
 */
export function useIslandMorph(
  el: Ref<HTMLElement | null>,
  reduced: Ref<boolean>,
  initialWidth = 118,
  initialHeight = 40
) {
  const width = new Spring(initialWidth, ISLAND_SPRINGS.width)
  const height = new Spring(initialHeight, ISLAND_SPRINGS.height)

  let targetWidth = initialWidth
  let targetHeight = initialHeight
  let frame = 0
  let last = 0

  const applySize = () => {
    const node = el.value
    if (!node) return
    node.style.width = `${width.x}px`
    node.style.height = `${height.x}px`
  }

  const applyNow = () => {
    width.snapTo(targetWidth)
    height.snapTo(targetHeight)
    applySize()
  }

  const loop = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1_000) : 1 / 60
    last = now
    const movingWidth = width.step(dt)
    const movingHeight = height.step(dt)
    applySize()

    if (movingWidth || movingHeight) {
      frame = requestAnimationFrame(loop)
      return
    }

    frame = 0
    last = 0
    applyNow()
  }

  const kick = () => {
    if (frame) return
    last = 0
    frame = requestAnimationFrame(loop)
  }

  const setTarget = (nextWidth: number, nextHeight: number) => {
    targetWidth = nextWidth
    targetHeight = nextHeight

    if (reduced.value) {
      applyNow()
      return
    }

    width.retarget(nextWidth)
    height.retarget(nextHeight)
    kick()
  }

  watch(reduced, (value) => {
    if (value) applyNow()
  })

  // 元素挂载后立刻写入初始尺寸，避免首帧按 0 宽高绘制
  watch(el, () => applySize(), { immediate: true })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { setTarget }
}
