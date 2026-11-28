import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { ISLAND_SPRINGS, Spring } from '@/shared/lib/island/spring'

const TWEEN_MS = 160
const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3)
const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress)
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
/** 常驻内容（表情/计数/文案）决定收缩下限；触底后按此比例反弹，避免切字也不停顿 */
const FLOOR_REBOUND = 0.4
const CONTENT_SELECTORS = ['.island-face', '.island-count', '.island-label'] as const

export function useIslandMorph(
  el: Ref<HTMLElement | null>,
  reduced: Ref<boolean>,
  initialWidth = 118,
  initialHeight = 40
) {
  const width = new Spring(initialWidth, ISLAND_SPRINGS.width)
  const height = new Spring(initialHeight, ISLAND_SPRINGS.height)
  const cardVisible = ref(false)

  let targetWidth = initialWidth
  let targetHeight = initialHeight
  let cardHeight = initialHeight
  let pillRadius = initialHeight / 2
  let cardRadius = 18
  let frame = 0
  let last = 0
  let tween: { fromWidth: number; fromHeight: number; startedAt: number } | null = null
  let borderWidth = 1
  let widthFloor = 0
  let floorPending = false

  const readRadii = () => {
    const node = el.value
    if (!node) return
    const style = getComputedStyle(node)
    const themePill = Number.parseFloat(style.getPropertyValue('--theme-radius-pill'))
    const themeCard = Number.parseFloat(style.getPropertyValue('--theme-radius-xl'))
    const border = Number.parseFloat(style.borderRightWidth)
    borderWidth = Number.isFinite(border) ? border : 1
    pillRadius = Math.min(Number.isFinite(themePill) ? themePill : 100, initialHeight / 2)
    cardRadius = Number.isFinite(themeCard) ? themeCard : 18
  }

  /** 以收起后的目标宽度为视口，量出仍在壳内的常驻内容右缘；壳不缩到会切掉它的位置。 */
  const measureWidthFloor = () => {
    const node = el.value
    const bar = node?.querySelector<HTMLElement>('.island-bar')
    if (!node || !bar) {
      widthFloor = 0
      return
    }
    const rootLeft = node.getBoundingClientRect().left
    const innerRight = rootLeft + borderWidth + targetWidth
    let contentRight = Number.NEGATIVE_INFINITY
    for (const selector of CONTENT_SELECTORS) {
      const child = bar.querySelector<HTMLElement>(selector)
      if (!child || child.getClientRects().length === 0) continue
      const rect = child.getBoundingClientRect()
      if (rect.right > innerRight) continue
      contentRight = Math.max(contentRight, rect.right)
    }
    widthFloor = Number.isFinite(contentRight) ? contentRight - rootLeft + 1 : 0
  }

  const applyShape = () => {
    const node = el.value
    if (!node) return
    const heightRange = cardHeight - initialHeight
    const rawProgress =
      cardVisible.value && heightRange > 0 ? clamp01((height.x - initialHeight) / heightRange) : 0
    const progress = smoothstep(rawProgress)
    const radius = pillRadius + (cardRadius - pillRadius) * progress
    const bar = node.querySelector<HTMLElement>('.island-bar')
    const card = node.querySelector<HTMLElement>('.island-card-wrap')

    node.style.width = `${width.x}px`
    node.style.height = `${height.x}px`
    node.style.borderRadius = `${radius}px`
    if (bar) bar.style.opacity = `${1 - progress}`
    if (card) card.style.opacity = `${progress}`
    if (targetHeight <= initialHeight && height.x <= initialHeight) cardVisible.value = false
  }

  const finish = () => {
    width.snapTo(targetWidth)
    height.snapTo(targetHeight)
    cardVisible.value = targetHeight > initialHeight
    applyShape()
  }

  const beginTween = () => {
    tween = {
      fromWidth: width.x,
      fromHeight: height.x,
      startedAt: performance.now()
    }
    width.v = 0
    height.v = 0
    if (!frame) frame = requestAnimationFrame(loop)
  }

  const stepTween = (now: number) => {
    if (!tween) return false
    const progress = clamp01((now - tween.startedAt) / TWEEN_MS)
    const eased = easeOutCubic(progress)
    width.x = tween.fromWidth + (targetWidth - tween.fromWidth) * eased
    height.x = tween.fromHeight + (targetHeight - tween.fromHeight) * eased
    applyShape()
    if (progress < 1) return true

    tween = null
    finish()
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

    if (floorPending) {
      floorPending = false
      measureWidthFloor()
    }

    const dt = last ? Math.min(0.1, (now - last) / 1_000) : 1 / 60
    last = now
    const movingWidth = width.step(dt)
    if (width.x < widthFloor) {
      width.x = widthFloor
      if (width.v < 0) width.v = -width.v * FLOOR_REBOUND
    }
    const movingHeight = height.step(dt)
    applyShape()

    if (movingWidth || movingHeight) {
      frame = requestAnimationFrame(loop)
      return
    }

    frame = 0
    last = 0
    finish()
  }

  const kick = () => {
    if (frame) return
    last = 0
    frame = requestAnimationFrame(loop)
  }

  const setTarget = (nextWidth: number, nextHeight: number) => {
    readRadii()
    if (nextWidth < targetWidth) floorPending = true
    targetWidth = nextWidth
    targetHeight = nextHeight
    if (nextHeight > initialHeight) {
      cardHeight = nextHeight
      cardVisible.value = true
    }

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
      readRadii()
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

  /** 主题切换只改 CSS 变量、不改变目标尺寸：重新读取圆角并立即应用 */
  const refreshTheme = () => {
    readRadii()
    applyShape()
  }

  watch(
    el,
    (node) => {
      if (!node) return
      readRadii()
      applyShape()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return { setTarget, refreshTheme, cardVisible }
}
