import { describe, expect, it } from 'vitest'
import {
  collectQualitySamples,
  diffRunningNames,
  ExpectedStops,
  EXPECTED_STOP_TTL_MS
} from '../health'

describe('diffRunningNames', () => {
  it('返回新增与消失的配置名，并稳定排序', () => {
    expect(diffRunningNames(['b', 'a'], ['c', 'a'])).toEqual({
      started: ['c'],
      stopped: ['b']
    })
  })

  it('空集与重复项不会误报', () => {
    expect(diffRunningNames([], [])).toEqual({ started: [], stopped: [] })
    expect(diffRunningNames(['a', 'a'], ['a'])).toEqual({ started: [], stopped: [] })
  })
})

describe('ExpectedStops', () => {
  it('用户主动停止在 TTL 内被消费一次', () => {
    const stops = new ExpectedStops()
    stops.expect('a', 1_000)
    expect(stops.consume('a', 1_500)).toBe(true)
    expect(stops.consume('a', 1_500)).toBe(false)
  })

  it('超过 TTL 不再抑制，按异常处理', () => {
    const stops = new ExpectedStops()
    stops.expect('a', 1_000)
    expect(stops.consume('a', 1_000 + EXPECTED_STOP_TTL_MS + 1)).toBe(false)
  })

  it('未登记的停止不会被抑制', () => {
    expect(new ExpectedStops().consume('missing', 1_000)).toBe(false)
  })

  it('取消预期停止后，真实掉线不再被抑制', () => {
    const stops = new ExpectedStops()
    stops.expect('a', 1_000)
    stops.cancel('a')
    expect(stops.consume('a', 1_500)).toBe(false)
  })

  it('prune 清掉过期项', () => {
    const stops = new ExpectedStops()
    stops.expect('a', 1_000)
    stops.expect('b', 9_000)
    stops.prune(1_000 + EXPECTED_STOP_TTL_MS + 1)
    expect(stops.size).toBe(1)
  })
})

describe('collectQualitySamples', () => {
  it('只保留成功且带延迟的采样，缺省丢包按 0', () => {
    expect(
      collectQualitySamples([
        { configFileName: 'ok', ok: true, avgLatencyMs: 20, peerCount: 3 },
        { configFileName: 'loss', ok: true, avgLatencyMs: 40, lossRate: 1.5, peerCount: 2 },
        { configFileName: 'no-latency', ok: true, peerCount: 1 },
        { configFileName: 'down', ok: false, avgLatencyMs: 10, peerCount: 0 }
      ])
    ).toEqual([
      { name: 'ok', sample: { avgLatencyMs: 20, lossRate: 0, peerCount: 3 } },
      { name: 'loss', sample: { avgLatencyMs: 40, lossRate: 1.5, peerCount: 2 } }
    ])
  })

  it('无 peer 的成功快照可报告恢复，不需要延迟字段', () => {
    expect(collectQualitySamples([{ configFileName: 'alone', ok: true, peerCount: 0 }])).toEqual([
      { name: 'alone', sample: { avgLatencyMs: 0, lossRate: 0, peerCount: 0 } }
    ])
  })

  it('有 peer 但缺少延迟仍跳过，避免把采样缺失误判为恢复', () => {
    expect(collectQualitySamples([{ configFileName: 'unknown', ok: true, peerCount: 1 }])).toEqual(
      []
    )
  })

  it('空快照返回空数组', () => {
    expect(collectQualitySamples([])).toEqual([])
  })
})
