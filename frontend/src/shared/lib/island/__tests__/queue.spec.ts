import { describe, expect, it } from 'vitest'
import {
  createNotice,
  dismissNotice,
  dismissNoticeBySource,
  enqueueNotice,
  noticeDuration,
  pruneNotices
} from '../queue'
import type { IslandQueueState, IslandNoticeType } from '../types'

const empty = (): IslandQueueState => ({ current: null, queue: [] })

function make(
  id: string,
  type: IslandNoticeType,
  extra: Partial<Parameters<typeof createNotice>[0]> = {}
) {
  return createNotice({ type, title: id, ...extra }, 1_000, id)
}

describe('island queue', () => {
  it('第一个通知直接成为当前项', () => {
    const state = enqueueNotice(empty(), make('a', 'feedback'))
    expect(state.current?.id).toBe('a')
    expect(state.queue).toHaveLength(0)
  })

  it('高优先级抢占当前项，旧项进入队列', () => {
    let state = enqueueNotice(empty(), make('a', 'feedback'))
    state = enqueueNotice(state, make('b', 'error'))
    expect(state.current?.id).toBe('b')
    expect(state.queue.map((n) => n.id)).toEqual(['a'])
  })

  it('静默通知保留 quiet 标记', () => {
    const state = enqueueNotice(empty(), make('a', 'error', { quiet: true }))
    expect(state.current?.quiet).toBe(true)
  })

  it('静默当前项不阻塞新的可展示通知', () => {
    let state = enqueueNotice(empty(), make('quiet', 'error', { quiet: true }))
    state = enqueueNotice(state, make('loud', 'quality'))
    expect(state.current?.id).toBe('loud')
    expect(state.current?.quiet).toBe(false)
    expect(state.queue.map((n) => n.id)).toEqual(['quiet'])
  })

  it('可展示当前项不会被静默通知顶掉', () => {
    let state = enqueueNotice(empty(), make('loud', 'error'))
    state = enqueueNotice(state, make('quiet', 'update', { quiet: true }))
    expect(state.current?.id).toBe('loud')
    expect(state.queue.map((n) => n.id)).toEqual(['quiet'])
  })

  it('同级反馈用新消息替换当前项，不排队', () => {
    let state = enqueueNotice(empty(), make('a', 'feedback'))
    state = enqueueNotice(state, make('b', 'feedback'))
    expect(state.current?.id).toBe('b')
    expect(state.queue).toHaveLength(0)
  })

  it('同 sourceKey 合并：保留 id 与 createdAt，repeat 加一', () => {
    const first = createNotice({ type: 'quality', title: '慢', sourceKey: 'q:1' }, 1_000, 'q')
    const next = createNotice({ type: 'quality', title: '更慢', sourceKey: 'q:1' }, 2_000, 'q2')
    const state = enqueueNotice({ current: first, queue: [] }, next)
    expect(state.current?.id).toBe('q')
    expect(state.current?.title).toBe('更慢')
    expect(state.current?.createdAt).toBe(1_000)
    expect(state.current?.updatedAt).toBe(2_000)
    expect(state.current?.repeat).toBe(1)
  })

  it('队列最多保留 8 条，低优先级先被丢弃', () => {
    let state = empty()
    state = enqueueNotice(state, make('cur', 'error'))
    for (let i = 0; i < 12; i += 1) {
      state = enqueueNotice(state, make(`f${i}`, 'feedback'))
    }
    expect(state.queue).toHaveLength(8)
    expect(state.queue.every((n) => n.type === 'feedback')).toBe(true)
  })

  it('关闭当前项后提升队列下一条', () => {
    let state = enqueueNotice(empty(), make('a', 'error'))
    state = enqueueNotice(state, make('b', 'quality'))
    state = dismissNotice(state, 'a')
    expect(state.current?.id).toBe('b')
  })

  it('按 sourceKey 关闭队列项，不影响当前项', () => {
    let state = enqueueNotice(empty(), make('a', 'error'))
    state = enqueueNotice(state, make('b', 'quality', { sourceKey: 'q:1' }))
    state = dismissNoticeBySource(state, 'q:1')
    expect(state.current?.id).toBe('a')
    expect(state.queue).toHaveLength(0)
  })

  it('关闭被禁用的当前项并提升下一条启用项', () => {
    let state = enqueueNotice(empty(), make('a', 'error'))
    state = enqueueNotice(state, make('b', 'quality'))
    state = pruneNotices(state, { error: false, update: true, quality: true, feedback: true })
    expect(state.current?.id).toBe('b')
  })

  it('停留时长按类型固定', () => {
    expect(noticeDuration('error')).toBe(8_000)
    expect(noticeDuration('update')).toBe(8_000)
    expect(noticeDuration('quality')).toBe(6_000)
    expect(noticeDuration('feedback')).toBe(3_600)
  })
})
