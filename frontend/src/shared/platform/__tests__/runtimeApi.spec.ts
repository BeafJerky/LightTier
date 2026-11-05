/**
 * runtimeApi 映射单测：后端实例与前端的运行记录互转的字段口径
 */
import { describe, expect, it } from 'vitest'
import {
  toRunningItem,
  toRuntimeInstance,
  type RuntimeInstance
} from '@/shared/platform/runtimeApi'

const instance: RuntimeInstance = {
  configFileName: 'home',
  fileName: 'home.toml',
  pid: 4321,
  rpcPortal: '127.0.0.1:15888',
  instanceId: 'inst-1',
  virtualIp: '10.144.0.10'
}

describe('runtimeApi 映射', () => {
  it('后端实例转运行记录：保留 PID 与端口信息', () => {
    expect(toRunningItem(instance)).toEqual({
      configFileName: 'home',
      fileName: 'home.toml',
      pid: 4321,
      rpcPortal: '127.0.0.1:15888',
      instanceId: 'inst-1',
      virtualIp: '10.144.0.10'
    })
  })

  it('Android 进程内实例 PID 为 0 时视为无 PID', () => {
    const running = toRunningItem({ ...instance, pid: 0, instanceId: 'inst-2' })
    expect(running.pid).toBeUndefined()
    expect(running.instanceId).toBe('inst-2')
  })

  it('缺 fileName 时按配置名补全 .toml，缺 PID 时补 0', () => {
    const sent = toRuntimeInstance({ configFileName: 'office' })
    expect(sent).toEqual({
      configFileName: 'office',
      fileName: 'office.toml',
      pid: 0,
      rpcPortal: undefined,
      instanceId: undefined,
      virtualIp: undefined
    })
  })
})
