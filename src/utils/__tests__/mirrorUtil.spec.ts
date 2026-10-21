import { describe, expect, it } from 'vitest'
import { normalizeMirrorPrefix } from '@/utils/mirrorUtil'

describe('normalizeMirrorPrefix（自定义加速源归一化）', () => {
  it('省略协议时补全 https，并统一末尾斜杠', () => {
    expect(normalizeMirrorPrefix(' ghproxy.com ')).toBe('https://ghproxy.com/')
    expect(normalizeMirrorPrefix('https://ghproxy.com')).toBe('https://ghproxy.com/')
    expect(normalizeMirrorPrefix('https://ghproxy.com///')).toBe('https://ghproxy.com/')
  })

  it('保留路径前缀并规范化协议与主机名', () => {
    expect(normalizeMirrorPrefix('HTTP://Example.COM/gh/')).toBe('http://example.com/gh/')
  })

  it('允许 http、端口与 IP/本地地址', () => {
    expect(normalizeMirrorPrefix('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    expect(normalizeMirrorPrefix('localhost:3000')).toBe('https://localhost:3000/')
  })

  it('拒绝空值、空白与超长地址', () => {
    expect(normalizeMirrorPrefix('')).toBeNull()
    expect(normalizeMirrorPrefix('   ')).toBeNull()
    expect(normalizeMirrorPrefix(null)).toBeNull()
    expect(normalizeMirrorPrefix(`https://example.com/${'a'.repeat(2048)}`)).toBeNull()
  })

  it('拒绝非 http(s) 协议与非法 URL', () => {
    expect(normalizeMirrorPrefix('ftp://example.com/')).toBeNull()
    expect(normalizeMirrorPrefix('javascript:alert(1)')).toBeNull()
    expect(normalizeMirrorPrefix('not a url')).toBeNull()
  })

  it('拒绝查询串、hash 与账号密码等不适合作为前缀的形式', () => {
    expect(normalizeMirrorPrefix('https://example.com/?a=1')).toBeNull()
    expect(normalizeMirrorPrefix('https://example.com/#x')).toBeNull()
    expect(normalizeMirrorPrefix('https://user:pass@example.com/')).toBeNull()
  })
})
