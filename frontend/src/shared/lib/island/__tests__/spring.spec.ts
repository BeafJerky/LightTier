import { describe, expect, it } from 'vitest'
import { ISLAND_SPRINGS, Spring, type SpringConfig } from '../spring'

interface Metrics {
  peak: number
  peakMs: number
  settleMs: number
}

function simulate(config: SpringConfig, target = 1, durationMs = 1_200): Metrics {
  const spring = new Spring(0, config)
  spring.retarget(target)
  let peak = 0
  let peakMs = 0
  let settleMs = 0
  for (let ms = 0; ms <= durationMs; ms += 1) {
    if (ms > 0) spring.step(0.001)
    if (spring.x > peak) {
      peak = spring.x
      peakMs = ms
    }
    if (Math.abs(spring.x - target) > 0.001) settleMs = ms
  }
  return { peak, peakMs, settleMs }
}

describe('Spring', () => {
  it('宽度弹簧约 8.4% 过冲，约 221ms 首次到达峰值', () => {
    const { peak, peakMs, settleMs } = simulate(ISLAND_SPRINGS.width)
    expect(peak).toBeCloseTo(1.084, 2)
    expect(peakMs).toBeGreaterThanOrEqual(200)
    expect(peakMs).toBeLessThanOrEqual(245)
    expect(settleMs).toBeGreaterThanOrEqual(530)
    expect(settleMs).toBeLessThanOrEqual(600)
  })

  it('高度弹簧约 5.5% 过冲，比宽度更克制', () => {
    const { peak, peakMs, settleMs } = simulate(ISLAND_SPRINGS.height)
    expect(peak).toBeCloseTo(1.055, 2)
    expect(peakMs).toBeGreaterThanOrEqual(220)
    expect(peakMs).toBeLessThanOrEqual(265)
    expect(settleMs).toBeGreaterThanOrEqual(545)
    expect(settleMs).toBeLessThanOrEqual(615)
  })

  it('重定向目标保留当前位置与速度，不从头重播', () => {
    const spring = new Spring(0, ISLAND_SPRINGS.width)
    spring.retarget(100)
    for (let i = 0; i < 150; i += 1) spring.step(1 / 480)
    const before = spring.x
    expect(before).toBeGreaterThan(0)
    expect(spring.atRest()).toBe(false)
    spring.retarget(200)
    expect(spring.x).toBe(before)
  })

  it('超大 dt 被钳制，不会产生 NaN', () => {
    const spring = new Spring(0, ISLAND_SPRINGS.width)
    spring.retarget(300)
    spring.step(10)
    expect(Number.isFinite(spring.x)).toBe(true)
    expect(Number.isFinite(spring.v)).toBe(true)
  })

  it('snapTo 立即到位并清零速度', () => {
    const spring = new Spring(0, ISLAND_SPRINGS.width)
    spring.retarget(120)
    spring.step(1 / 60)
    spring.snapTo(120)
    expect(spring.x).toBe(120)
    expect(spring.v).toBe(0)
    expect(spring.atRest()).toBe(true)
  })
})
