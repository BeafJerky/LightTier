import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormWebData } from '@/entities/config/formTypes'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn()
}))

vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    readWebConfigList: mocks.read,
    writeWebConfigList: mocks.write
  })
}))

import {
  mutateWebConfigList,
  replaceWebConfigList,
  runTomlTransaction
} from '@/shared/platform/webConfigStorage'

const config = (name: string): FormWebData => ({
  configFileName: name,
  protocol: 'http',
  host: '127.0.0.1',
  port: 11211,
  userName: name,
  webStartMethod: 0,
  webUrl: ''
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.write.mockResolvedValue(undefined)
})

describe('Web 配置整表事务', () => {
  it('并发修改在同一最新快照上串行执行，不丢更新', async () => {
    let stored = [config('home')]
    mocks.read.mockImplementation(async () => stored)
    mocks.write.mockImplementation(async (list: FormWebData[]) => {
      stored = list
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = mutateWebConfigList(async (list) => {
      list.push(config('office'))
      await gate
    })
    const second = mutateWebConfigList((list) => {
      list.push(config('mobile'))
    })
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1))
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.write).not.toHaveBeenCalled()

    release()
    await Promise.all([first, second])
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(stored.map((item) => item.configFileName)).toEqual(['home', 'office', 'mobile'])
  })

  it('读取失败不写空表，后续事务仍可执行', async () => {
    mocks.read.mockRejectedValueOnce(new Error('unreadable'))
    mocks.read.mockResolvedValueOnce([config('home')])

    await expect(mutateWebConfigList(() => {})).rejects.toThrow('unreadable')
    expect(mocks.write).not.toHaveBeenCalled()

    await mutateWebConfigList((list) => {
      list.push(config('office'))
    })
    expect(mocks.write).toHaveBeenCalledWith([config('home'), config('office')])
  })

  it('整表恢复与页面修改共享同一串行队列', async () => {
    let stored = [config('home')]
    mocks.read.mockImplementation(async () => stored)
    mocks.write.mockImplementation(async (list: FormWebData[]) => {
      stored = list
    })

    const restore = replaceWebConfigList([config('restored')])
    const update = mutateWebConfigList((list) => {
      list[0].port = 12000
    })
    await Promise.all([restore, update])

    expect(stored).toEqual([{ ...config('restored'), port: 12000 }])
  })
})

describe('TOML 共享串行边界', () => {
  it('普通写入等待恢复事务完成，失败后边界仍可继续使用', async () => {
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const restore = runTomlTransaction(async () => {
      events.push('restore-start')
      await gate
      events.push('restore-end')
    })
    const save = runTomlTransaction(async () => {
      events.push('save')
    })
    await Promise.resolve()
    expect(events).toEqual(['restore-start'])
    release()
    await Promise.all([restore, save])
    expect(events).toEqual(['restore-start', 'restore-end', 'save'])

    await expect(
      runTomlTransaction(async () => Promise.reject(new Error('failed')))
    ).rejects.toThrow('failed')
    await expect(runTomlTransaction(async () => events.push('after-error'))).resolves.toBe(4)
    expect(events.at(-1)).toBe('after-error')
  })
})
