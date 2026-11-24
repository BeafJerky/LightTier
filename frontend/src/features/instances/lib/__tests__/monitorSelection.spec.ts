import { describe, expect, it } from 'vitest'
import { resolveMonitorTarget } from '../monitorSelection'

const home = { configFileName: 'home', fileName: 'home.toml' }
const office = { configFileName: 'office', fileName: 'office.toml' }
const runningOffice = { ...office, pid: 123, rpcPortal: '127.0.0.1:15888' }

describe('resolveMonitorTarget', () => {
  it('显式深链命中已停止配置时展示该配置，并不回退到运行实例', () => {
    expect(resolveMonitorTarget([home, office], [runningOffice], 'home', 'office', true)).toEqual(
      home
    )
  })

  it('显式深链命中运行配置时补齐运行态字段', () => {
    expect(resolveMonitorTarget([home, office], [runningOffice], 'office', '', false)).toEqual(
      runningOffice
    )
  })

  it('宽屏无显式目标时优先上次运行配置，其次首个运行配置', () => {
    expect(resolveMonitorTarget([home, office], [runningOffice], '', 'office', true)).toEqual(
      runningOffice
    )
    expect(resolveMonitorTarget([home, office], [runningOffice], '', 'home', true)).toEqual(
      runningOffice
    )
  })

  it('窄屏无显式目标时保持清单视图', () => {
    expect(
      resolveMonitorTarget([home, office], [runningOffice], '', 'office', false)
    ).toBeUndefined()
  })
})
