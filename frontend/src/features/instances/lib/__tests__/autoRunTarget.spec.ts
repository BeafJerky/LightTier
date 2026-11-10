import { describe, expect, it } from 'vitest'
import { pickAutoRunTarget } from '../autoRunTarget'

describe('pickAutoRunTarget', () => {
  it('显式指定的配置优先于会话结束时的运行记录', () => {
    expect(
      pickAutoRunTarget({
        configured: 'A',
        lastSessionRunning: ['B'],
        available: ['A', 'B']
      })
    ).toBe('A')
  })

  it('优先使用会话结束时仍在运行的配置，而不是最后启动的配置', () => {
    // 用户场景：先启动 A，再启动 B，随后停止 B；会话结束时仅 A 在运行
    expect(
      pickAutoRunTarget({
        configured: '',
        lastSessionRunning: ['A'],
        available: ['A', 'B']
      })
    ).toBe('A')
  })

  it('多个配置仍在运行时取最后一个（最近启动）', () => {
    expect(
      pickAutoRunTarget({
        configured: '',
        lastSessionRunning: ['A', 'C', 'B'],
        available: ['A', 'B', 'C']
      })
    ).toBe('B')
  })

  it('跳过已不存在的配置文件', () => {
    expect(
      pickAutoRunTarget({
        configured: '',
        lastSessionRunning: ['A', '已删除'],
        available: ['A']
      })
    ).toBe('A')
  })

  it('没有可用的会话运行记录时返回 undefined，交给上层兜底', () => {
    expect(
      pickAutoRunTarget({ configured: '', lastSessionRunning: [], available: ['A'] })
    ).toBeUndefined()
    expect(
      pickAutoRunTarget({ configured: '', lastSessionRunning: ['已删除'], available: ['A'] })
    ).toBeUndefined()
  })
})
