export const EXPECTED_STOP_TTL_MS = 15_000

export function diffRunningNames(
  previous: Iterable<string>,
  next: Iterable<string>
): { started: string[]; stopped: string[] } {
  const before = new Set(previous)
  const after = new Set(next)
  return {
    started: [...after].filter((name) => !before.has(name)).sort(),
    stopped: [...before].filter((name) => !after.has(name)).sort()
  }
}

/**
 * 用户点击停止后，运行态扫描可能晚于 UI 更新才返回。
 * 在这段时间里按配置名登记一次“预期停止”，差集命中时直接吞掉，不报异常。
 */
export class ExpectedStops {
  private readonly expires = new Map<string, number>()

  constructor(private readonly ttlMs = EXPECTED_STOP_TTL_MS) {}

  expect(name: string, now = Date.now()): void {
    this.expires.set(name, now + this.ttlMs)
  }

  consume(name: string, now = Date.now()): boolean {
    const expiresAt = this.expires.get(name)
    if (expiresAt === undefined) return false
    this.expires.delete(name)
    return expiresAt >= now
  }

  prune(now = Date.now()): void {
    for (const [name, expiresAt] of this.expires) {
      if (expiresAt < now) this.expires.delete(name)
    }
  }

  get size(): number {
    return this.expires.size
  }
}
