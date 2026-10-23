/**
 * 出口路由残留分类单测（routeUtil）
 *
 * 回归背景：旧实现只按“目标 + 网关”判断，恢复默认路由 metric 后会报“可疑”，
 * 新增路由被外部改 metric 也被误判；双 0.0.0.0/0 记录（change + add）需要分别归类。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/'))
}))

vi.mock('@/utils/shellUtil', () => ({
  checkRouteOnWindows: vi.fn(),
  executeCmd: vi.fn(),
  replaceLastWithZero: vi.fn(),
  runEasyTierCli: vi.fn()
}))

vi.mock('@/utils/easyTierUtil', () => ({
  extractAllPublicIPs: vi.fn(),
  processPeerData: vi.fn(),
  readTextTail: vi.fn(),
  routeCost: vi.fn()
}))

vi.mock('@/utils/fileUtil', () => ({
  deleteFileOrDir: vi.fn(),
  readFileContent: vi.fn(),
  resolveKernelLogFile: vi.fn(),
  writeFileContent: vi.fn()
}))

vi.mock('@/utils/sysUtil', () => ({ PS_ADAPTER_FILTER_CLAUSE: '' }))

vi.mock('@/utils/platformUtil', () => ({ isAndroid: () => false }))

vi.mock('@/constants/easytier', () => ({ CONFIG_PATH: 'config', RESOURCE_PATH: 'res' }))

vi.mock('@/utils/lighttierConfigUtil', () => ({ isExitRouteEnabled: vi.fn() }))

import { classifyRouteResidue } from '@/utils/routeUtil'

type Records = Parameters<typeof classifyRouteResidue>[0]
type SysRoutes = Parameters<typeof classifyRouteResidue>[1]
type Entry = Records[number]['entries'][number]

const makeRecords = (entries: Entry[]): Records => [
  {
    version: 2,
    configName: '盐城立体库',
    entries,
    createdAt: 0,
    updatedAt: 0
  }
]

const defaultRoute: Entry = {
  target: '0.0.0.0',
  mask: '0.0.0.0',
  gateway: '192.168.1.1',
  metric: 30,
  kind: 'default',
  originalMetric: 25
}

const exitDefault: Entry = {
  target: '0.0.0.0',
  mask: '0.0.0.0',
  gateway: '10.0.0.2',
  metric: 5,
  kind: 'add'
}

const publicIp: Entry = {
  target: '203.0.113.5',
  mask: '255.255.255.255',
  gateway: '192.168.1.1',
  metric: 1,
  kind: 'add'
}

describe('classifyRouteResidue', () => {
  it('系统表精确匹配 → active', () => {
    const sys: SysRoutes = [
      { target: '0.0.0.0', mask: '0.0.0.0', gateway: '192.168.1.1', metric: 30 },
      { target: '0.0.0.0', mask: '0.0.0.0', gateway: '10.0.0.2', metric: 5 },
      { target: '203.0.113.5', mask: '255.255.255.255', gateway: '192.168.1.1', metric: 1 }
    ]
    const result = classifyRouteResidue(makeRecords([defaultRoute, exitDefault, publicIp]), sys)
    expect(result.active).toHaveLength(3)
    expect(result.missing).toHaveLength(0)
    expect(result.suspicious).toHaveLength(0)
  })

  it('默认路由已恢复原 metric → missing（不能因同目标存在就报可疑）', () => {
    const sys: SysRoutes = [
      { target: '0.0.0.0', mask: '0.0.0.0', gateway: '192.168.1.1', metric: 25 }
    ]
    const result = classifyRouteResidue(makeRecords([defaultRoute]), sys)
    expect(result.active).toHaveLength(0)
    expect(result.missing).toEqual([defaultRoute])
    expect(result.suspicious).toHaveLength(0)
  })

  it('默认路由 metric 既非记录值也非原值 → suspicious（被外部改过）', () => {
    const sys: SysRoutes = [
      { target: '0.0.0.0', mask: '0.0.0.0', gateway: '192.168.1.1', metric: 10 }
    ]
    const result = classifyRouteResidue(makeRecords([defaultRoute]), sys)
    expect(result.suspicious).toEqual([defaultRoute])
  })

  it('新增路由同目标网关但 metric 不同 → suspicious', () => {
    const sys: SysRoutes = [{ target: '0.0.0.0', mask: '0.0.0.0', gateway: '10.0.0.2', metric: 15 }]
    const result = classifyRouteResidue(makeRecords([exitDefault]), sys)
    expect(result.suspicious).toEqual([exitDefault])
    expect(result.active).toHaveLength(0)
  })

  it('条目已从系统表消失 → missing', () => {
    const result = classifyRouteResidue(makeRecords([publicIp]), [])
    expect(result.missing).toEqual([publicIp])
  })

  it('双 0.0.0.0/0 记录各自独立分类', () => {
    const sys: SysRoutes = [
      // 原默认路由仍在改写状态（metric 30）
      { target: '0.0.0.0', mask: '0.0.0.0', gateway: '192.168.1.1', metric: 30 },
      // 出口默认路由被外部删除
      { target: '203.0.113.5', mask: '255.255.255.255', gateway: '192.168.1.1', metric: 1 }
    ]
    const result = classifyRouteResidue(makeRecords([defaultRoute, exitDefault, publicIp]), sys)
    expect(result.active).toEqual([defaultRoute, publicIp])
    expect(result.missing).toEqual([exitDefault])
    expect(result.suspicious).toHaveLength(0)
  })
})
