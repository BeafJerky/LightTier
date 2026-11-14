export interface QualitySample {
  avgLatencyMs: number
  lossRate: number
  peerCount: number
}

export type QualityLevel = 'good' | 'fair' | 'poor'

const POOR_LATENCY_MS = 150
const POOR_LOSS_RATE = 2
const GOOD_LATENCY_MS = 100
const GOOD_LOSS_RATE = 1

export function classifyQuality(sample: QualitySample): QualityLevel {
  if (sample.peerCount <= 0) return 'good'
  if (sample.avgLatencyMs >= POOR_LATENCY_MS || sample.lossRate >= POOR_LOSS_RATE) {
    return 'poor'
  }
  if (sample.avgLatencyMs < GOOD_LATENCY_MS && sample.lossRate < GOOD_LOSS_RATE) {
    return 'good'
  }
  return 'fair'
}

/** 两次连续越界才提示、两次连续恢复才撤销，避免采样抖动反复弹卡。 */
export class QualityEpisode {
  private activeState = false
  private poorCount = 0
  private goodCount = 0

  get active(): boolean {
    return this.activeState
  }

  push(level: QualityLevel): 'enter' | 'recover' | null {
    if (!this.activeState) {
      this.poorCount = level === 'poor' ? this.poorCount + 1 : 0
      if (this.poorCount < 2) return null
      this.activeState = true
      this.poorCount = 0
      this.goodCount = 0
      return 'enter'
    }

    this.goodCount = level === 'good' ? this.goodCount + 1 : 0
    if (this.goodCount < 2) return null
    this.activeState = false
    this.goodCount = 0
    this.poorCount = 0
    return 'recover'
  }
}
