import { describe, it, expect, vi } from 'vitest'

vi.mock('@/shared/i18n/t', () => ({ t: (key: string) => key }))

import {
  formatBytes,
  formatMetric,
  getDelayColor,
  getNatType,
  processPeerData,
  routeCost
} from '@/shared/lib/monitorFormat'

describe('getDelayColor（延迟配色）', () => {
  it('按毫秒区间取色', () => {
    expect(getDelayColor(0)).toBe('green')
    expect(getDelayColor('9.9')).toBe('green')
    expect(getDelayColor(10)).toBe('#45b458')
    expect(getDelayColor(80)).toBe('#71d481')
    expect(getDelayColor(150)).toBe('#fdc44d')
    expect(getDelayColor(250)).toBe('#fd884d')
    expect(getDelayColor(350)).toBe('red')
  })

  it('非数值返回 gray', () => {
    expect(getDelayColor('—')).toBe('gray')
    expect(getDelayColor('null')).toBe('gray')
  })
})

describe('formatBytes（字节格式化）', () => {
  it('按 1024 进制换算并保留一位小数', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1099511627776)).toBe('1.0 TB')
  })

  it('解析 CLI 返回的可读单位', () => {
    expect(formatBytes('1.26 kB')).toBe('1.3 KB')
    expect(formatBytes('2 MB')).toBe('2.0 MB')
  })

  it('空值与非法值返回占位符', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes('-')).toBe('—')
    expect(formatBytes('null')).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes('abc')).toBe('—')
  })
})

describe('formatMetric（带单位指标）', () => {
  it('补单位后缀，已带单位则原样返回', () => {
    expect(formatMetric(12, 'ms')).toBe('12ms')
    expect(formatMetric('0.0%', '%')).toBe('0.0%')
    expect(formatMetric(0, 'ms')).toBe('0ms')
  })

  it('空值返回占位符', () => {
    expect(formatMetric('-', 'ms')).toBe('—')
    expect(formatMetric('', 'ms')).toBe('—')
    expect(formatMetric(null, '%')).toBe('—')
  })
})

describe('routeCost / getNatType（本地化文案）', () => {
  it('路由开销类型映射到 i18n key', () => {
    expect(routeCost('p2p')).toBe('newMonitor.costP2p')
    expect(routeCost('Local')).toBe('newMonitor.costLocal')
    expect(routeCost('relay')).toBe('newMonitor.costRelay')
  })

  it('NAT 类型同时支持数值与字符串枚举，未知值原样返回', () => {
    expect(getNatType(3)).toBe('newMonitor.natFullCone')
    expect(getNatType('FullCone')).toBe('newMonitor.natFullCone')
    expect(getNatType(6)).toBe('newMonitor.natSymmetric')
    expect(getNatType('OpenInternet')).toBe('newMonitor.natOpen')
    expect(getNatType(99)).toBe('99')
  })
})

describe('processPeerData（peer 行归一化）', () => {
  it('去掉 IPv4 掩码并转换成本/NAT/延迟配色', () => {
    const [peer] = processPeerData([
      {
        ipv4: '10.1.0.2/24',
        hostname: 'node-a',
        cost: 'p2p',
        nat_type: 3,
        lat_ms: '12.5'
      } as unknown as PeerInfo
    ])

    expect(peer.ipv4).toBe('10.1.0.2')
    expect(peer.hostname).toBe('node-a')
    expect(peer.cost).toBe('newMonitor.costP2p')
    expect(peer.nat_type).toBe('newMonitor.natFullCone')
    expect(peer.delayColor).toBe('#45b458')
  })

  it('公共服务器清理名称前缀并以占位符替换 IP', () => {
    const [peer] = processPeerData([
      {
        ipv4: '203.0.113.7:11010',
        hostname: 'PublicServer_cn-hk',
        cost: 'relay',
        nat_type: 'Unknown',
        lat_ms: '-'
      } as unknown as PeerInfo
    ])

    expect(peer.hostname).toBe('cn-hk')
    expect(peer.ipv4).toBe('newMonitor.serverLabel')
    expect(peer.cost).toBe('newMonitor.costRelay')
    expect(peer.nat_type).toBe('newMonitor.natUnknown')
    expect(peer.delayColor).toBe('gray')
  })

  it('空字段不抛错', () => {
    const [peer] = processPeerData([{ cost: 'Local' } as unknown as PeerInfo])
    expect(peer.ipv4).toBe('')
    expect(peer.hostname).toBe('')
  })
})
