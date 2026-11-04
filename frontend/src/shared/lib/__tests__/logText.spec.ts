import { describe, it, expect } from 'vitest'
import { extractAllPublicIPs, readTextTail } from '@/shared/lib/logText'

describe('readTextTail（日志尾部顺序读取）', () => {
  it('返回末尾 N 行并保持旧→新的时间顺序', () => {
    expect(readTextTail('l1\nl2\nl3\nl4', 2)).toBe('l3\nl4')
  })

  it('忽略文件末尾换行产生的空行', () => {
    expect(readTextTail('l1\nl2\nl3\n', 2)).toBe('l2\nl3')
    expect(readTextTail('l1\nl2\r\nl3\r\n', 2)).toBe('l2\nl3')
  })

  it('行数不足时返回全部，空文本返回空串', () => {
    expect(readTextTail('l1\nl2', 10)).toBe('l1\nl2')
    expect(readTextTail('', 10)).toBe('')
    expect(readTextTail('\n\n', 10)).toBe('')
  })

  it('读取 0 行返回空串', () => {
    expect(readTextTail('l1\nl2', 0)).toBe('')
  })

  it('非法参数抛出异常', () => {
    expect(() => readTextTail(123 as unknown as string, 2)).toThrow()
    expect(() => readTextTail('l1', -1)).toThrow()
    expect(() => readTextTail('l1', Number.NaN)).toThrow()
  })
})

describe('extractAllPublicIPs（公网地址推断）', () => {
  it('按来源可信度排序：public_ipv4 优先于 dest_addr 与 IP 列表', () => {
    const log = [
      'got ip list: 198.51.100.9, 203.0.113.7',
      'dest_addr=Some(SocketAddr { ip: Some(Ipv4(198.51.100.9)), port: 11010 })',
      'public_ipv4: Some(203.0.113.7)'
    ].join('\n')

    expect(extractAllPublicIPs(log)).toEqual(['203.0.113.7', '198.51.100.9'])
  })

  it('同一来源内出现次数多的优先', () => {
    const log = [
      'public_ipv4: Some(203.0.113.7)',
      'public_ipv4: Some(198.51.100.9)',
      'public_ipv4: Some(198.51.100.9)'
    ].join('\n')

    expect(extractAllPublicIPs(log)).toEqual(['198.51.100.9', '203.0.113.7'])
  })

  it('过滤私网、回环、全零与链路本地地址', () => {
    const log = [
      'got ip list: 10.1.2.3, 172.16.0.9, 172.31.255.1, 192.168.1.5, 127.0.0.1, 0.0.0.0, 169.254.3.4, 198.51.100.9'
    ].join('\n')

    expect(extractAllPublicIPs(log)).toEqual(['198.51.100.9'])
  })

  it('dest_addr 中与 mapped_addr 相同的地址视为本机映射，不参与候选', () => {
    const log = [
      'mapped_addr=Some(SocketAddr { ip: Some(Ipv4(203.0.113.7)), port: 11010 })',
      'dest_addr=Some(SocketAddr { ip: Some(Ipv4(203.0.113.7)), port: 11010 })',
      'dest_addr=Some(SocketAddr { ip: Some(Ipv4(198.51.100.9)), port: 11010 })'
    ].join('\n')

    expect(extractAllPublicIPs(log)).toEqual(['198.51.100.9'])
  })

  it('无候选地址时返回空数组', () => {
    expect(extractAllPublicIPs('')).toEqual([])
    expect(extractAllPublicIPs('started\n')).toEqual([])
  })
})
