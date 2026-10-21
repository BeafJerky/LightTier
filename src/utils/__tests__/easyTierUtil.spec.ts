import { describe, it, expect } from 'vitest'
import { normalizeToml, readTextTail } from '@/utils/easyTierUtil'

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

  it('非法参数抛出异常', () => {
    expect(() => readTextTail(123 as unknown as string, 2)).toThrow()
    expect(() => readTextTail('l1', -1)).toThrow()
    expect(() => readTextTail('l1', Number.NaN)).toThrow()
  })
})

describe('normalizeToml（5.7 默认数据合并 + 空值清理）', () => {
  it('剔除空值：空串、空数组、undefined、null 不落盘', () => {
    const out = normalizeToml({
      hostname: 'node-a',
      socks5_proxy: '',
      stun_servers: [],
      ipv4: undefined,
      external_node: null,
      listeners: ['tcp://0.0.0.0:11010']
    })
    expect(out.hostname).toBe('node-a')
    expect('socks5_proxy' in out).toBe(false)
    expect('stun_servers' in out).toBe(false)
    expect('ipv4' in out).toBe(false)
    expect('external_node' in out).toBe(false)
    expect(out.listeners).toEqual(['tcp://0.0.0.0:11010'])
  })

  it('合并标量默认值：缺失字段补 defaultFormData 的标量默认', () => {
    const out = normalizeToml({ hostname: 'node-a' })
    expect(out.dhcp).toBe(true)
    expect(out.rpc_portal).toBe('0.0.0.0:15888')
    // flags 内标量默认同样补全
    expect(out.flags.enable_encryption).toBe(true)
    expect(out.flags.default_protocol).toBe('tcp')
  })

  it('不注入空结构与 undefined 默认：数组/对象/undefined 默认不补（保存语义）', () => {
    const out = normalizeToml({}, { mergeDefaults: false })
    // 数组默认（peer/listeners）与 undefined 默认（socks5_proxy 等）不注入
    expect('peer' in out).toBe(false)
    expect('listeners' in out).toBe(false)
    expect('socks5_proxy' in out).toBe(false)
    expect('local_private_key' in out).toBe(false)
    // file_logger 为对象默认也不注入
    expect('file_logger' in out).toBe(false)
    expect('flags' in out).toBe(false)
  })

  it('嵌套对象（flags）深度清理：空值删除、全空删除整个 flags', () => {
    // 保存语义（mergeDefaults: false）：只剔空值，不注入默认
    const out = normalizeToml(
      {
        hostname: 'node-a',
        flags: {
          lazy_p2p: true,
          need_p2p: undefined,
          disable_upnp: '',
          no_listener: false
        }
      },
      { mergeDefaults: false }
    )
    expect(out.flags).toEqual({ lazy_p2p: true, no_listener: false })

    const empty = normalizeToml(
      { hostname: 'node-a', flags: { lazy_p2p: undefined } },
      { mergeDefaults: false }
    )
    expect('flags' in empty).toBe(false)
  })

  it('保存语义（mergeDefaults: false）：不注入任何默认值，避免配置膨胀', () => {
    const out = normalizeToml({ hostname: 'node-a' }, { mergeDefaults: false })
    expect('dhcp' in out).toBe(false)
    expect('rpc_portal' in out).toBe(false)
    expect('flags' in out).toBe(false)
  })

  it('未知键透传：非默认表中的用户自定义字段保留', () => {
    const out = normalizeToml({ hostname: 'node-a', custom_field: 'keep', empty_field: '' })
    expect(out.custom_field).toBe('keep')
    expect('empty_field' in out).toBe(false)
  })

  it('保留显式空串之外的空数组剔除，非空数组保留', () => {
    const out = normalizeToml({
      hostname: 'node-a',
      routes: [],
      proxy_network: [{ cidr: '10.1.0.0/16' }]
    })
    expect('routes' in out).toBe(false)
    expect(out.proxy_network).toEqual([{ cidr: '10.1.0.0/16' }])
  })
})
