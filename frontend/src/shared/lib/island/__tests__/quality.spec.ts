import { describe, expect, it } from 'vitest'
import { classifyQuality, QualityEpisode } from '../quality'

describe('classifyQuality', () => {
  it('无远端节点视为正常，避免空网络误报', () => {
    expect(classifyQuality({ avgLatencyMs: 999, lossRate: 9, peerCount: 0 })).toBe('good')
  })

  it('延迟或丢包达到阈值即降级', () => {
    expect(classifyQuality({ avgLatencyMs: 160, lossRate: 0, peerCount: 2 })).toBe('poor')
    expect(classifyQuality({ avgLatencyMs: 20, lossRate: 2.1, peerCount: 2 })).toBe('poor')
  })

  it('满足双条件才算恢复良好，中间值保持 fair', () => {
    expect(classifyQuality({ avgLatencyMs: 90, lossRate: 0.2, peerCount: 2 })).toBe('good')
    expect(classifyQuality({ avgLatencyMs: 120, lossRate: 0.2, peerCount: 2 })).toBe('fair')
  })
})

describe('QualityEpisode', () => {
  it('连续两次 poor 才进入异常，只触发一次', () => {
    const episode = new QualityEpisode()
    expect(episode.push('poor')).toBeNull()
    expect(episode.push('poor')).toBe('enter')
    expect(episode.push('poor')).toBeNull()
    expect(episode.active).toBe(true)
  })

  it('中间夹一次 fair 会重置连续计数', () => {
    const episode = new QualityEpisode()
    episode.push('poor')
    episode.push('fair')
    expect(episode.push('poor')).toBeNull()
    expect(episode.active).toBe(false)
  })

  it('连续两次 good 才恢复', () => {
    const episode = new QualityEpisode()
    episode.push('poor')
    episode.push('poor')
    expect(episode.push('good')).toBeNull()
    expect(episode.push('good')).toBe('recover')
    expect(episode.active).toBe(false)
  })

  it('恢复后可以再次进入异常', () => {
    const episode = new QualityEpisode()
    episode.push('poor')
    episode.push('poor')
    episode.push('good')
    episode.push('good')
    episode.push('poor')
    expect(episode.push('poor')).toBe('enter')
  })
})
