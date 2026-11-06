import { describe, it, expect, vi } from 'vitest'
import { resolveServiceStatuses, SERVICE_STATUS_TTL_MS } from '@/shared/lib/serviceStatusCache'

describe('resolveServiceStatuses（服务状态缓存）', () => {
  it('命中原有缓存时不调用检测，并立即回传状态', async () => {
    const cache = new Map([['a', { status: 'runningService', at: 1_000 }]])
    const load = vi.fn(async () => 'notInstalled')
    const updates: Array<[string, string]> = []

    await resolveServiceStatuses(
      'test:spec',
      ['a'],
      load,
      (name, status) => updates.push([name, status]),
      {
        cache,
        now: () => 2_000
      }
    )

    expect(load).not.toHaveBeenCalled()
    expect(updates).toEqual([['a', 'runningService']])
  })

  it('缺失项并发检测，成功后写入缓存并在 TTL 内复用', async () => {
    const cache = new Map()
    const load = vi.fn(async (name: string) => (name === 'a' ? 'running' : 'notInstalled'))
    const updates: Array<[string, string]> = []
    const onUpdate = (name: string, status: string) => updates.push([name, status])

    await resolveServiceStatuses('test:spec', ['a', 'b'], load, onUpdate, {
      cache,
      now: () => 1_000
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.get('a')?.status).toBe('running')
    expect(updates).toEqual(
      expect.arrayContaining([
        ['a', 'running'],
        ['b', 'notInstalled']
      ])
    )

    await resolveServiceStatuses('test:spec', ['a', 'b'], load, onUpdate, {
      cache,
      now: () => 1_000 + SERVICE_STATUS_TTL_MS - 1
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('缓存过期或 force 时重新检测', async () => {
    const cache = new Map([['a', { status: 'notInstalled', at: 1_000 }]])
    const load = vi.fn(async () => 'running')
    const updates: Array<[string, string]> = []
    const onUpdate = (name: string, status: string) => updates.push([name, status])

    await resolveServiceStatuses('test:spec', ['a'], load, onUpdate, {
      cache,
      now: () => 1_000 + SERVICE_STATUS_TTL_MS
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(updates).toEqual([['a', 'running']])

    await resolveServiceStatuses('test:spec', ['a'], load, onUpdate, {
      cache,
      now: () => 2_000,
      force: true
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('并发发起所有缺失项检测，不等待前一项完成', async () => {
    const started: string[] = []
    const releases = new Map<string, (status: string) => void>()
    const load = (name: string) =>
      new Promise<string>((resolve) => {
        started.push(name)
        releases.set(name, resolve)
      })

    const task = resolveServiceStatuses('test:spec', ['a', 'b'], load, () => {}, {
      cache: new Map()
    })

    expect(started).toEqual(['a', 'b'])
    releases.get('a')?.('running')
    releases.get('b')?.('notInstalled')
    await task
  })

  it('限制并发检测数量，避免同时拉起过多系统查询', async () => {
    const started: string[] = []
    const releases = new Map<string, (status: string) => void>()
    const load = (name: string) =>
      new Promise<string>((resolve) => {
        started.push(name)
        releases.set(name, resolve)
      })

    const task = resolveServiceStatuses('test:spec', ['a', 'b', 'c', 'd'], load, () => {}, {
      cache: new Map(),
      concurrency: 2
    })
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

    expect(started).toEqual(['a', 'b'])
    releases.get('a')?.('notInstalled')
    await tick()
    expect(started).toEqual(['a', 'b', 'c'])
    releases.get('b')?.('notInstalled')
    releases.get('c')?.('notInstalled')
    await tick()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
    releases.get('d')?.('notInstalled')
    await task
  })

  it('检测失败回传 unknown 且不写缓存，下次仍会重试', async () => {
    const cache = new Map()
    const load = vi.fn(async () => {
      throw new Error('nssm failed')
    })
    const updates: Array<[string, string]> = []

    await resolveServiceStatuses(
      'test:spec',
      ['a'],
      load,
      (name, status) => updates.push([name, status]),
      {
        cache,
        now: () => 1_000
      }
    )

    expect(updates).toEqual([['a', 'unknown']])
    expect(cache.has('a')).toBe(false)

    await resolveServiceStatuses('test:spec', ['a'], load, () => {}, { cache, now: () => 1_001 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('不同 scope 的同名配置互不串用缓存', async () => {
    const updates: Array<[string, string]> = []
    const loadInstance = vi.fn(async () => 'notInstalled')

    await resolveServiceStatuses(
      'test:scope-web',
      ['same'],
      async () => 'running',
      () => {}
    )
    await resolveServiceStatuses('test:scope-instance', ['same'], loadInstance, (name, status) =>
      updates.push([name, status])
    )

    expect(loadInstance).toHaveBeenCalledTimes(1)
    expect(updates).toEqual([['same', 'notInstalled']])
  })
})
