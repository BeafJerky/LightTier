/**
 * 冷启动自动运行目标选择
 *
 * 「上次运行的配置」应取会话结束时仍在运行的配置（持久化 runningList），
 * 而不是最后启动的配置：停止某配置后，最后启动者可能已不在运行。
 */
export interface AutoRunTargetInput {
  /** 设置页显式指定的运行配置（autoRunConfigName），非空时优先 */
  configured: string
  /** 会话结束时仍在运行的配置名（持久化顺序，最后一项为最近启动） */
  lastSessionRunning: string[]
  /** 当前存在的配置名 */
  available: string[]
}

export const pickAutoRunTarget = (input: AutoRunTargetInput): string | undefined => {
  if (input.configured) return input.configured
  const available = new Set(input.available)
  for (let i = input.lastSessionRunning.length - 1; i >= 0; i--) {
    const name = input.lastSessionRunning[i]
    if (available.has(name)) return name
  }
  return undefined
}
