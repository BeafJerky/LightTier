/**
 * kernel 域单测：内核版本探测的来源随运行模式切换。
 *
 * - agent：版本取内核包清单的 active（服务端已安装的内核），不发 CLI 调用；
 * - native / mock：仍走 coreApi.getCoreVersion()，行为与改动前一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getCoreVersion: vi.fn()
}))

// 门面只在这几个符号上被 kernel.ts 使用；其余导出按空实现占位，避免真实装配
const mockBackend = (mode: 'agent' | 'native') => {
  vi.doMock('@/shared/platform/backend', () => ({
    backendMode: () => mode,
    backendPackages: () => ({ list: mocks.list }),
    isApiError: () => false,
    request: vi.fn(),
    initBackend: vi.fn()
  }))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('detectCoreVersion（agent 模式）', () => {
  it('取内核包清单的 active 作为版本', async () => {
    mockBackend('agent')
    mocks.list.mockResolvedValue({ active: 'v2.7.1' })
    const { createKernelDomain } = await import('../kernel')

    const store = createKernelDomain()
    await expect(store.detectCoreVersion()).resolves.toBe('v2.7.1')
    expect(store.detectedCoreVersion.value).toBe('v2.7.1')
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.getCoreVersion).not.toHaveBeenCalled()
  })

  it('尚未安装内核（active 为 null）时返回 null', async () => {
    mockBackend('agent')
    mocks.list.mockResolvedValue({ active: null })
    const { createKernelDomain } = await import('../kernel')

    const store = createKernelDomain()
    await expect(store.detectCoreVersion()).resolves.toBeNull()
    expect(store.detectedCoreVersion.value).toBeNull()
  })

  it('清单读取失败时降级为 null 且不抛出', async () => {
    mockBackend('agent')
    mocks.list.mockRejectedValue(new Error('network down'))
    const { createKernelDomain } = await import('../kernel')

    const store = createKernelDomain()
    await expect(store.detectCoreVersion()).resolves.toBeNull()
    expect(store.detectedCoreVersion.value).toBeNull()
  })
})

describe('detectCoreVersion（native 模式）', () => {
  it('仍从 coreApi 读 CLI 版本输出', async () => {
    mockBackend('native')
    vi.doMock('@/shared/platform/coreApi', () => ({ getCoreVersion: mocks.getCoreVersion }))
    mocks.getCoreVersion.mockResolvedValue('easytier-cli 2.6.4')
    const { createKernelDomain } = await import('../kernel')

    const store = createKernelDomain()
    await expect(store.detectCoreVersion()).resolves.toBe('v2.6.4')
    expect(store.detectedCoreVersion.value).toBe('v2.6.4')
    expect(store.coreVersionRaw.value).toBe('easytier-cli 2.6.4')
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
