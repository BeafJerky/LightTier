export interface SpringConfig {
  stiffness: number
  damping: number
  mass?: number
}

/**
 * 与设计稿对齐的两组阻尼：
 * - width  ζ≈0.617，峰值 8.42% @221ms，0.1% 收敛约 566ms；
 * - height ζ≈0.677，峰值 5.48% @240ms，0.1% 收敛约 580ms。
 * 480Hz 子步长；重定向只改 target，保留当前位移与速度。
 */
export const ISLAND_SPRINGS = {
  width: { stiffness: 326.5, damping: 22.3 },
  height: { stiffness: 317, damping: 24.1 }
} satisfies Record<'width' | 'height', SpringConfig>

const SUBSTEP = 1 / 480
const MAX_DT = 0.1
const REST_POSITION = 0.05
const REST_VELOCITY = 0.05

export class Spring {
  x: number
  v = 0
  target: number
  private readonly k: number
  private readonly c: number
  private readonly m: number

  constructor(initial = 0, config: SpringConfig = ISLAND_SPRINGS.width) {
    this.x = initial
    this.target = initial
    this.k = config.stiffness
    this.c = config.damping
    this.m = config.mass ?? 1
  }

  retarget(target: number): void {
    this.target = target
  }

  snapTo(target: number): void {
    this.x = target
    this.v = 0
    this.target = target
  }

  atRest(): boolean {
    return Math.abs(this.x - this.target) < REST_POSITION && Math.abs(this.v) < REST_VELOCITY
  }

  /** 返回是否仍在运动。dt 会被钳制，避免后台标签页恢复时瞬移。 */
  step(dtSeconds: number): boolean {
    let remaining = Math.min(Math.max(dtSeconds, 0), MAX_DT)
    while (remaining > 0) {
      const h = Math.min(SUBSTEP, remaining)
      const acceleration = (-this.k * (this.x - this.target) - this.c * this.v) / this.m
      this.v += acceleration * h
      this.x += this.v * h
      remaining -= h
    }
    return !this.atRest()
  }
}
