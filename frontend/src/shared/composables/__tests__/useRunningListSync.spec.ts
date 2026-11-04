/**
 * useRunningListSync 单测：运行列表刷新成功、失败保留原状态与自定义错误处理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'

const storeMock = vi.hoisted(() => ({
  configList: [] as { configFileName: string }[],
  setRunningList: vi.fn()
}))

const api = vi.hoisted(() => ({
  getRunningList: vi.fn()
}))

vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => storeMock
}))

vi.mock('@/shared/platform/coreApi', () => api)

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false
}))

describe('useRunningListSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.configList = [{ configFileName: 'a.toml' }, { configFileName: 'b.toml' }]
  })

  it('按当前配置名拉取运行列表并写回 store', async () => {
    const list = [{ configFileName: 'a.toml', pid: 100 }]
    api.getRunningList.mockResolvedValue(list)

    const { updateRunningList } = useRunningListSync()
    await updateRunningList()

    expect(api.getRunningList).toHaveBeenCalledWith(['a.toml', 'b.toml'])
    expect(storeMock.setRunningList).toHaveBeenCalledWith(list)
  })

  it('扫描失败时保留上一份状态，不抛出异常', async () => {
    api.getRunningList.mockRejectedValue(new Error('scan failed'))

    const { updateRunningList } = useRunningListSync()
    await expect(updateRunningList()).resolves.toBeUndefined()

    expect(storeMock.setRunningList).not.toHaveBeenCalled()
  })

  it('自定义错误处理优先于默认静默策略', async () => {
    const error = new Error('scan failed')
    api.getRunningList.mockRejectedValue(error)
    const onError = vi.fn()

    const { updateRunningList } = useRunningListSync({ onError })
    await updateRunningList()

    expect(onError).toHaveBeenCalledWith(error)
    expect(storeMock.setRunningList).not.toHaveBeenCalled()
  })
})
