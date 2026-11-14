import { onBeforeUnmount, watch, type Ref } from 'vue'
import { ISLAND_SPRINGS, Spring } from '@/shared/lib/island/spring'

/** 减弱动效档的短补间：不做超调，与圆角/内容淡出同步完成 */
const TWEEN_MS = 160

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3)

/**
 * 只驱动外壳宽高，直接写 DOM，绕过逐帧响应式更新：
 * 形态动画期间不触发组件重渲染，也不让内容随宽度逐帧重排。
 * 内容层由外壳裁切、用固定目标尺寸排版，收展时只做透明度交叉淡入淡出。
 *
 * 标准档用弹簧（保留回弹）；减弱档用 160ms ease-out 补间，
 * 避免尺寸瞬跳而圆角仍在过渡的“胶囊突变圆角矩形”。
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
  let tween: { fromWidth: number; fromHeight: number; startedAt: number } | null = null

  const applySize = () => {
    const node = el.value
    if (!node) return
    node.style.width = `${width.x}px`
    node.style.height = `${height.x}px`
  }

  const beginTween = () => {
    tween = {
      fromWidth: width.x,
      fromHeight: height.x,
      startedAt: performance.now()
    }
    // 切回标准档时从静止重新起步，不继承补间前的弹簧速度
    width.v = 0
    height.v = 0
    if (!frame) frame = requestAnimationFrame(loop)
  }

  const stepTween = (now: number) => {
    if (!tween) return false
    const progress = Math.min(1, Math.max(0, (now - tween.startedAt) / TWEEN_MS))
    const eased = easeOutCubic(progress)
    width.x = tween.fromWidth + (targetWidth - tween.fromWidth) * eased
    height.x = tween.fromHeight + (targetHeight - tween.fromHeight) * eased
    applySize()

    if (progress < 1) return true

    tween = null
    width.snapTo(targetWidth)
    height.snapTo(targetHeight)
    applySize()
    return false
  }

  const loop = (now: number) => {
    if (tween) {
      if (stepTween(now)) {
        frame = requestAnimationFrame(loop)
        return
      }
      frame = 0
      last = 0
      return
    }

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
    width.snapTo(targetWidth)
    height.snapTo(targetHeight)
    applySize()
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
      beginTween()
      return
    }

    tween = null
    width.retarget(nextWidth)
    height.retarget(nextHeight)
    kick()
  }

  watch(reduced, (value) => {
    if (value) {
      beginTween()
      return
    }
    tween = null
    width.v = 0
    height.v = 0
    width.retarget(targetWidth)
    height.retarget(targetHeight)
    kick()
  })

  // 元素挂载后立刻写入初始尺寸，避免首帧按 0 宽高绘制
  watch(el, () => applySize(), { immediate: true })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { setTarget }
}
