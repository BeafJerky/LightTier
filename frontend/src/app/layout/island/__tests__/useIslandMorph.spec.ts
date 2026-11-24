import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useIslandMorph } from '../useIslandMorph'

const smoothstep = (value: number) => value * value * (3 - 2 * value)

describe('useIslandMorph 内容与外形协调', () => {
  let now = 0
  let nextFrame = 0
  let frames: Map<number, FrameRequestCallback>
  let scope: ReturnType<typeof effectScope>

  const advance = (time: number) => {
    now = time
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(now)
  }

  const createHost = (content: Record<string, number> = {}) => {
    const bar = {
      style: {} as Record<string, string>,
      querySelector: (selector: string) => {
        const right = content[selector]
        if (right === undefined) return null
        return {
          getClientRects: () => [{}],
          getBoundingClientRect: () => ({ left: right - 10, right })
        }
      }
    }
    const card = { style: {} as Record<string, string> }
    const elements: Record<string, unknown> = {
      '.island-bar': bar,
      '.island-card-wrap': card
    }
    const element = {
      style: {} as Record<string, string>,
      querySelector: (selector: string) => elements[selector] ?? null,
      getBoundingClientRect: () => ({ left: 0, right: 0 })
    } as unknown as HTMLElement
    return { element, bar, card }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    now = 0
    nextFrame = 0
    frames = new Map()
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) =>
        name === '--theme-radius-pill' ? '100px' : name === '--theme-radius-xl' ? '18px' : ''
    }))
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('减弱档展开时，圆角与内容透明度严格跟随同一尺寸进度', () => {
    const { element, bar, card } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(true), 132, 40))!
    morph.setTarget(352, 196)
    advance(80)

    const progress = smoothstep((176.5 - 40) / 156)
    expect(element.style.height).toBe('176.5px')
    expect(element.style.borderRadius).toBe(`${20 - 2 * progress}px`)
    expect(card.style.opacity).toBe(`${progress}`)
    expect(bar.style.opacity).toBe(`${1 - progress}`)
  })

  it('展开途中反向收起时保留卡片，实际回到胶囊高度后才切换内容', () => {
    const { element, bar, card } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(true), 132, 40))!
    morph.setTarget(352, 196)
    advance(80)
    expect(morph.cardVisible.value).toBe(true)

    morph.setTarget(132, 40)
    advance(113.1)
    expect(Number.parseFloat(element.style.height)).toBeLessThan(118)
    expect(Number.parseFloat(element.style.height)).toBeGreaterThan(40)
    expect(morph.cardVisible.value).toBe(true)
    expect(Number(bar.style.opacity) + Number(card.style.opacity)).toBeCloseTo(1, 10)

    advance(240)
    expect(element.style.height).toBe('40px')
    expect(element.style.borderRadius).toBe('20px')
    expect(morph.cardVisible.value).toBe(false)
    expect(bar.style.opacity).toBe('1')
  })

  it('反向目标被再次展开中断时不跳变外形或提前隐藏卡片', () => {
    const { element } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(true), 132, 40))!
    morph.setTarget(352, 196)
    advance(80)
    morph.setTarget(132, 40)
    advance(100)
    const interruptedHeight = Number.parseFloat(element.style.height)
    const interruptedRadius = Number.parseFloat(element.style.borderRadius)

    morph.setTarget(352, 196)
    advance(112)
    expect(Number.parseFloat(element.style.height)).toBeGreaterThan(interruptedHeight)
    expect(Number.parseFloat(element.style.borderRadius)).toBeLessThan(interruptedRadius)
    expect(morph.cardVisible.value).toBe(true)
  })

  it('标准档收起沿同一弹簧越过胶囊下限后再回弹', () => {
    const { element } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
    morph.setTarget(352, 196)
    for (let time = 16; time <= 900; time += 16) advance(time)
    morph.setTarget(132, 40)

    let minimumWidth = Number.POSITIVE_INFINITY
    let minimumHeight = Number.POSITIVE_INFINITY
    for (let time = 916; time <= 2_400; time += 16) {
      advance(time)
      minimumWidth = Math.min(minimumWidth, Number.parseFloat(element.style.width))
      minimumHeight = Math.min(minimumHeight, Number.parseFloat(element.style.height))
    }

    expect(minimumHeight).toBeLessThan(40)
    expect(minimumWidth).toBeLessThan(132)
    expect(Number.parseFloat(element.style.height)).toBeCloseTo(40, 1)
    expect(Number.parseFloat(element.style.width)).toBeCloseTo(132, 1)
  })

  it.each([120, 160, 180, 200, 240, 280])(
    '标准档收起途中 %ims 反向再展开时保持连续',
    (collapseMs) => {
      const { element } = createHost()
      const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
      morph.setTarget(352, 196)
      for (let time = 16; time <= 900; time += 16) advance(time)
      morph.setTarget(132, 40)
      let interruptedHeight = Number.parseFloat(element.style.height)
      let interruptedWidth = Number.parseFloat(element.style.width)
      for (let time = 916; time < 900 + collapseMs; time += 16) {
        advance(time)
        interruptedHeight = Number.parseFloat(element.style.height)
        interruptedWidth = Number.parseFloat(element.style.width)
      }

      morph.setTarget(352, 196)
      let previousHeight = interruptedHeight
      let previousWidth = interruptedWidth
      for (let time = 900 + collapseMs + 16; time <= 2_400; time += 16) {
        advance(time)
        const height = Number.parseFloat(element.style.height)
        const width = Number.parseFloat(element.style.width)
        expect(Math.abs(height - previousHeight)).toBeLessThan(30)
        expect(Math.abs(width - previousWidth)).toBeLessThan(40)
        expect(morph.cardVisible.value).toBe(true)
        previousHeight = height
        previousWidth = width
      }
      expect(previousHeight).toBeCloseTo(196, 1)
      expect(previousWidth).toBeCloseTo(352, 1)
    }
  )

  it('标准档展开读取并保留自定义主题圆角', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) =>
        name === '--theme-radius-pill' ? '100px' : name === '--theme-radius-xl' ? '32px' : ''
    }))
    const { element } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
    morph.setTarget(352, 196)
    for (let time = 16; time <= 900; time += 16) advance(time)

    expect(element.style.borderRadius).toBe('32px')
  })

  it('收起不压到切掉常驻内容，触底后仍回弹越过目标', () => {
    const { element } = createHost({ '.island-face': 60 })
    const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
    morph.setTarget(352, 196)
    for (let time = 16; time <= 900; time += 16) advance(time)
    morph.setTarget(80, 40)

    let minimumWidth = Number.POSITIVE_INFINITY
    let maximumWidth = 0
    for (let time = 916; time <= 2_400; time += 16) {
      advance(time)
      const width = Number.parseFloat(element.style.width)
      minimumWidth = Math.min(minimumWidth, width)
      maximumWidth = Math.max(maximumWidth, width)
    }

    expect(minimumWidth).toBeCloseTo(61, 1)
    expect(maximumWidth).toBeGreaterThan(80.5)
    expect(Number.parseFloat(element.style.width)).toBeCloseTo(80, 1)
  })

  it('常驻内容能放进目标宽度时仍完整越过下限', () => {
    const { element } = createHost({ '.island-face': 30 })
    const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
    morph.setTarget(352, 196)
    for (let time = 16; time <= 900; time += 16) advance(time)
    morph.setTarget(80, 40)

    let minimumWidth = Number.POSITIVE_INFINITY
    for (let time = 916; time <= 2_400; time += 16) {
      advance(time)
      minimumWidth = Math.min(minimumWidth, Number.parseFloat(element.style.width))
    }

    expect(minimumWidth).toBeLessThan(70)
    expect(Number.parseFloat(element.style.width)).toBeCloseTo(80, 1)
  })

  it('标准档反向收起也由实际高度决定内容切换，不依赖目标 class', () => {
    const { element } = createHost()
    const morph = scope.run(() => useIslandMorph(ref(element), ref(false), 132, 40))!
    morph.setTarget(352, 196)
    for (const time of [16, 32, 48, 64, 80, 96, 112, 128, 144, 160]) advance(time)
    expect(morph.cardVisible.value).toBe(true)

    morph.setTarget(132, 40)
    let switched = false
    for (let time = 176; time <= 900 && !switched; time += 16) {
      advance(time)
      switched = !morph.cardVisible.value
      if (!switched) {
        const radius = Number.parseFloat(element.style.borderRadius)
        expect(radius).toBeGreaterThanOrEqual(18)
        expect(radius).toBeLessThanOrEqual(20)
      }
    }
    expect(switched).toBe(true)
  })
})
