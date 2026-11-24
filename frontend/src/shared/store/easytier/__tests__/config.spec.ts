import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readWebConfigList: vi.fn() }))
vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({ readWebConfigList: mocks.readWebConfigList })
}))

import { createConfigDomain } from '@/shared/store/easytier/config'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Web 配置加载态', () => {
  it('读取失败保留上一份列表并进入错误态', async () => {
    const store = createConfigDomain()
    store.configWebList.value = [{ configFileName: 'home' } as any]
    mocks.readWebConfigList.mockRejectedValue(new Error('invalid json'))

    await store.loadWebConfigFiles()

    expect(store.configWebList.value.map((item) => item.configFileName)).toEqual(['home'])
    expect(store.webConfigListLoaded.value).toBe(false)
    expect(store.webConfigListError.value).not.toBeNull()
  })

  it('重试成功后清除错误态', async () => {
    const store = createConfigDomain()
    mocks.readWebConfigList.mockRejectedValueOnce(new Error('invalid json'))
    mocks.readWebConfigList.mockResolvedValueOnce([])

    await store.loadWebConfigFiles()
    await store.loadWebConfigFiles()

    expect(store.webConfigListLoaded.value).toBe(true)
    expect(store.webConfigListError.value).toBeNull()
  })
})
