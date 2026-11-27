import { describe, expect, it } from 'vitest'
import { joinTunnelUri, splitTunnelUri } from '@/features/configs/lib/tunnelUri'

describe('tunnelUri / 拆分与重组', () => {
  it('拆分标准 URI，协议小写', () => {
    expect(splitTunnelUri('TCP://0.0.0.0:11010')).toEqual({
      proto: 'tcp',
      rest: '0.0.0.0:11010',
      hasScheme: true
    })
    expect(splitTunnelUri('wg://0.0.0.0:11011')).toEqual({
      proto: 'wg',
      rest: '0.0.0.0:11011',
      hasScheme: true
    })
  })

  it('无 scheme 的值按 tcp 显示并保留原文', () => {
    expect(splitTunnelUri('example.com:11010')).toEqual({
      proto: 'tcp',
      rest: 'example.com:11010',
      hasScheme: false
    })
  })

  it('重组时去掉首尾空白，空地址返回空串', () => {
    expect(joinTunnelUri('udp', ' 1.2.3.4:11010 ')).toBe('udp://1.2.3.4:11010')
    expect(joinTunnelUri('tcp', '   ')).toBe('')
  })

  it('未知协议原样保留（动态补选项）', () => {
    expect(splitTunnelUri('quic://host:11012').proto).toBe('quic')
    expect(joinTunnelUri('quic', 'host:11012')).toBe('quic://host:11012')
  })
})
