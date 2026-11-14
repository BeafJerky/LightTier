import { describe, expect, it } from 'vitest'
import { normalizeMirrorPrefix, orderMirrorCandidates } from '@/shared/lib/mirrorUtil'

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

describe('orderMirrorCandidates（按真实吞吐排序下载源）', () => {
  const sources = [
    { value: 'https://official/', latency: 200 },
    { value: 'https://boki/', latency: 100 },
    { value: 'https://proxy/', latency: 400 },
    { value: 'https://slow/', latency: 900 }
  ]
  const speeds = (entries: Record<string, number>) => new Map(Object.entries(entries))

  it('HEAD 最快但 GET 零字节的源排到最后', () => {
    const ordered = orderMirrorCandidates(
      sources,
      speeds({
        'https://official/': 46_000,
        'https://boki/': 0,
        'https://proxy/': 350_000,
        'https://slow/': 12_000
      }),
      null
    )
    expect(ordered.map((s) => s.value)).toEqual([
      'https://proxy/',
      'https://official/',
      'https://slow/',
      'https://boki/'
    ])
  })

  it('无吞吐数据时退回 HEAD 延迟顺序', () => {
    const ordered = orderMirrorCandidates(sources, speeds({}), null)
    expect(ordered.map((s) => s.value)).toEqual([
      'https://boki/',
      'https://official/',
      'https://proxy/',
      'https://slow/'
    ])
  })

  it('显式选择且吞吐达标时优先，但明显慢于最快源则不优先', () => {
    const preferred = orderMirrorCandidates(
      sources,
      speeds({ 'https://official/': 300_000, 'https://proxy/': 350_000 }),
      'https://official/'
    )
    expect(preferred[0].value).toBe('https://official/')

    const demoted = orderMirrorCandidates(
      sources,
      speeds({ 'https://official/': 5_000, 'https://proxy/': 350_000 }),
      'https://official/'
    )
    expect(demoted[0].value).toBe('https://proxy/')
  })

  it('显式选择为假活源（0 字节）时不再优先', () => {
    const ordered = orderMirrorCandidates(
      sources,
      speeds({
        'https://boki/': 0,
        'https://proxy/': 300_000,
        'https://official/': 40_000,
        'https://slow/': 12_000
      }),
      'https://boki/'
    )
    expect(ordered[0].value).toBe('https://proxy/')
    expect(ordered[ordered.length - 1].value).toBe('https://boki/')
  })
})
