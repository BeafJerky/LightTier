/**
 * DHCP / DHCPv6 网段轻校验：只做格式与前缀提示，不阻断原值透传。
 */
import { describe, expect, it } from 'vitest'
import { validateDhcpCidr, validateDhcpv6Cidr, validateProxyCidr } from '@/entities/config/cidr'

describe('validateDhcpCidr（IPv4）', () => {
  it('合法网段与空值通过', () => {
    expect(validateDhcpCidr('')).toBeNull()
    expect(validateDhcpCidr(' 10.0.0.0/24 ')).toBeNull()
    expect(validateDhcpCidr('192.168.1.0/30')).toBeNull()
  })

  it('前缀超过 30 或缺失时提示前缀问题', () => {
    expect(validateDhcpCidr('10.0.0.0/31')).toBe('prefix')
    expect(validateDhcpCidr('10.0.0.0/30/1')).toBe('format')
  })

  it('缺斜杠或地址段非法时提示格式问题', () => {
    expect(validateDhcpCidr('10.0.0.0')).toBe('format')
    expect(validateDhcpCidr('256.0.0.1/24')).toBe('format')
    expect(validateDhcpCidr('10.0.0/24')).toBe('format')
    expect(validateDhcpCidr('10.0.0.0/abc')).toBe('format')
  })
})

describe('validateDhcpv6Cidr（IPv6）', () => {
  it('ULA 与全局单播网段通过', () => {
    expect(validateDhcpv6Cidr('')).toBeNull()
    expect(validateDhcpv6Cidr('fc00::/64')).toBeNull()
    expect(validateDhcpv6Cidr('fd00::1/126')).toBeNull()
    expect(validateDhcpv6Cidr('2000:db8::/48')).toBeNull()
    expect(validateDhcpv6Cidr('fc00:0:0:0:0:0:0:0/64')).toBeNull()
  })

  it('前缀超过 126 时提示前缀问题', () => {
    expect(validateDhcpv6Cidr('fc00::/127')).toBe('prefix')
  })

  it('链路本地、回环等非 DHCPv6 可用范围提示范围问题', () => {
    expect(validateDhcpv6Cidr('fe80::/64')).toBe('range')
    expect(validateDhcpv6Cidr('::1/128')).toBe('range')
  })

  it('格式错误提示格式问题', () => {
    expect(validateDhcpv6Cidr('fc00::')).toBe('format')
    expect(validateDhcpv6Cidr('gggg::/64')).toBe('format')
    expect(validateDhcpv6Cidr('fc00:::/64')).toBe('format')
    expect(validateDhcpv6Cidr('fc00::/abc')).toBe('format')
  })
})

describe('validateProxyCidr（子网代理）', () => {
  it('普通网段、映射网段与空值通过', () => {
    expect(validateProxyCidr('')).toBeNull()
    expect(validateProxyCidr(' 192.168.1.0/24 ')).toBeNull()
    expect(validateProxyCidr('10.0.0.0/8->172.16.0.0/16')).toBeNull()
    expect(validateProxyCidr('10.0.0.0/8 -> 172.16.0.0/16')).toBeNull()
  })

  it('段内任一侧非法都提示格式问题', () => {
    expect(validateProxyCidr('192.168.1.0')).toBe('format')
    expect(validateProxyCidr('192.168.1.0/24->')).toBe('format')
    expect(validateProxyCidr('192.168.1.0/24->172.16.0.0')).toBe('format')
    expect(validateProxyCidr('192.168.1.0/24->172.16.0.0/16->10.0.0.0/8')).toBe('format')
  })

  it('前缀超过 32 时提示前缀问题', () => {
    expect(validateProxyCidr('192.168.1.0/33')).toBe('prefix')
    expect(validateProxyCidr('192.168.1.0/24->172.16.0.0/33')).toBe('prefix')
  })
})
