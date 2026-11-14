import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { ISLAND_SPRINGS, Spring } from '@/shared/lib/island/spring'

const EXIT_MS = 150

/**
 * 只驱动一个外壳的宽高；圆角、透明度交给 CSS。
 * 收起时先让内容退场 150ms，再让壳收缩，避免文字被压扁。
 * 新目标在退场期间到达则立即取消退场，直接续跑弹簧。
 */
export function useIslandMorph(
  el: Ref<HTMLElement | null>,
  reduced: Ref<boolean>,
  initialWidth = 118,
  initialHeight = 40
) {
  const widthValue = ref(initialWidth)
  const heightValue = ref(initialHeight)
  const exiting = ref(false)

  const width = new Spring(initialWidth, ISLAND_SPRINGS.width)
  const height = new Spring(initialHeight, ISLAND_SPRINGS.height)

  let targetWidth = initialWidth
  let targetHeight = initialHeight
  let frame = 0
  let last = 0
  let exitTimer = 0

  const applyNow = () => {
    width.snapTo(targetWidth)
    height.snapTo(targetHeight)
    widthValue.value = targetWidth
    heightValue.value = targetHeight
  }

  const loop = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1_000) : 1 / 60
    last = now
    const movingWidth = width.step(dt)
    const movingHeight = height.step(dt)
    widthValue.value = width.x
    heightValue.value = height.x

    if (movingWidth || movingHeight) {
      frame = requestAnimationFrame(loop)
      return
    }

    frame = 0
    last = 0
    applyNow()
    el.value?.classList.remove('is-morphing')
  }

  const kick = () => {
    if (frame) return
    el.value?.classList.add('is-morphing')
    last = 0
    frame = requestAnimationFrame(loop)
  }

  const setTarget = (nextWidth: number, nextHeight: number) => {
    targetWidth = nextWidth
    targetHeight = nextHeight

    if (reduced.value) {
      window.clearTimeout(exitTimer)
      exiting.value = false
      applyNow()
      return
    }

    const shrinking = nextWidth < width.x - 1 || nextHeight < height.x - 1
    const significant = width.x - nextWidth > 40 || height.x - nextHeight > 40

    if (shrinking && significant) {
      exiting.value = true
      window.clearTimeout(exitTimer)
      exitTimer = window.setTimeout(() => {
        exiting.value = false
        width.retarget(targetWidth)
        height.retarget(targetHeight)
        kick()
      }, EXIT_MS)
      return
    }

    window.clearTimeout(exitTimer)
    exiting.value = false
    width.retarget(nextWidth)
    height.retarget(nextHeight)
    kick()
  }

  watch(reduced, (value) => {
    if (!value) return
    window.clearTimeout(exitTimer)
    exiting.value = false
    applyNow()
  })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    window.clearTimeout(exitTimer)
  })

  return { widthValue, heightValue, exiting, setTarget }
}
