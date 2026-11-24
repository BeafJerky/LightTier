import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigCompatCheck } from '@/shared/composables/useConfigCompatCheck'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import { runTomlTransaction } from '@/shared/platform/webConfigStorage'

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  detectedCoreVersion: 'v2.7.1'
}))

vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    readFileContent: mocks.readFileContent,
    writeFileContent: mocks.writeFileContent
  })
}))
vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => ({ detectedCoreVersion: mocks.detectedCoreVersion })
}))

describe('useConfigCompatCheck TOML 事务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectedCoreVersion = 'v2.7.1'
    mocks.writeFileContent.mockResolvedValue(undefined)
  })

  it('读取、迁移和回写占用同一队列，期间的新内容不会被旧快照覆盖', async () => {
    const path = `${CONFIG_PATH}/demo.toml`
    let stored = 'config_exit_nodes_route = true\nhostname = "old"\n'
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.readFileContent.mockImplementationOnce(async () => {
      await gate
      return stored
    })
    mocks.writeFileContent.mockImplementation(async (_path: string, content: string) => {
      stored = content
    })

    const check = useConfigCompatCheck().getCompatIssues('demo.toml')
    await vi.waitFor(() => expect(mocks.readFileContent).toHaveBeenCalledTimes(1))

    let competitorRan = false
    const newer = 'hostname = "newer"\ndhcp = true\n'
    const save = runTomlTransaction(async () => {
      competitorRan = true
      stored = newer
    })
    await Promise.resolve()
    const competitorRanWhileReadPending = competitorRan
    release()
    await Promise.all([check, save])

    expect(competitorRanWhileReadPending).toBe(false)
    expect(mocks.readFileContent).toHaveBeenCalledWith(path)
    expect(stored).toBe(newer)
    expect(mocks.writeFileContent).toHaveBeenCalledTimes(1)
    expect(mocks.writeFileContent.mock.calls[0][1]).toContain('[lighttier]')
  })

  it('迁移回写失败仍按迁移后的快照返回兼容问题', async () => {
    mocks.readFileContent.mockResolvedValueOnce(
      'config_exit_nodes_route = true\n[flags]\n_future_flag = true\n'
    )
    mocks.writeFileContent.mockRejectedValueOnce(new Error('write failed'))

    const issues = await useConfigCompatCheck().getCompatIssues('demo.toml')

    expect(issues).toEqual([
      {
        level: 'error',
        code: 'flagUnknownStrict',
        params: { flag: '_future_flag', version: 'v2.7.1' }
      }
    ])
  })

  it('读取或解析失败仍返回空问题列表', async () => {
    mocks.readFileContent.mockRejectedValueOnce(new Error('read failed'))
    await expect(useConfigCompatCheck().getCompatIssues('demo.toml')).resolves.toEqual([])

    mocks.readFileContent.mockResolvedValueOnce('hostname = [')
    await expect(useConfigCompatCheck().getCompatIssues('demo.toml')).resolves.toEqual([])
    expect(mocks.writeFileContent).not.toHaveBeenCalled()
  })
})
