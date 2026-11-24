/**
 * systemOps 单测：命令名与参数透传必须与 Rust 侧一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true)
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri
}))

import {
  activeAdapter,
  defaultGateway,
  killProcess,
  listProcesses,
  routeAdd,
  routeDelete,
  routeExists,
  setAdapterMetric,
  verifyCoreFiles,
  verifyCorePackage
} from '@/shared/platform/systemOps'

describe('systemOps', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.isTauri.mockReturnValue(true)
  })

  it('routeAdd 透传参数', async () => {
    mocks.invoke.mockResolvedValueOnce(undefined)
    await routeAdd('10.0.0.0', '255.0.0.0', '192.168.1.1', 5)
    expect(mocks.invoke).toHaveBeenCalledWith('sysops_route_add', {
      target: '10.0.0.0',
      mask: '255.0.0.0',
      gateway: '192.168.1.1',
      metric: 5
    })
  })

  it('routeDelete / routeExists / adapter 命令名正确', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    await routeDelete('10.0.0.0', '255.0.0.0', '192.168.1.1')
    await routeExists('10.0.0.0')
    await activeAdapter()
    await defaultGateway()
    await setAdapterMetric('以太网', false)
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual([
      'sysops_route_delete',
      'sysops_route_exists',
      'sysops_active_adapter',
      'sysops_default_gateway',
      'sysops_set_adapter_metric'
    ])
  })

  it('killProcess 与 listProcesses 返回原值', async () => {
    mocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce([])
    await expect(killProcess(42)).resolves.toBe(true)
    await expect(listProcesses('easytier-core')).resolves.toEqual([])
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'sysops_kill_process', { pid: 42 })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'sysops_list_processes', {
      filter: 'easytier-core'
    })
  })

  it('verifyCorePackage 返回后端内置清单摘要，verifyCoreFiles 调用独立命令', async () => {
    const expectedSha256 = 'b'.repeat(64)
    mocks.invoke.mockResolvedValueOnce(expectedSha256).mockResolvedValueOnce(undefined)

    await expect(verifyCorePackage('v2.7.1', '/app/resource/core/kernel.zip')).resolves.toBe(
      expectedSha256
    )
    await expect(verifyCoreFiles()).resolves.toBeUndefined()

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'sysops_verify_core_package', {
      version: 'v2.7.1',
      path: '/app/resource/core/kernel.zip'
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'sysops_verify_core_files', undefined)
  })

  it('非 Tauri 环境抛错，避免静默降级', async () => {
    mocks.isTauri.mockReturnValue(false)
    await expect(routeAdd('10.0.0.0', '255.0.0.0', '192.168.1.1', 5)).rejects.toThrow()
  })
})
