import { describe, expect, it } from 'vitest'
import { pickLatestManagerRelease } from '../releaseUtil'

describe('pickLatestManagerRelease', () => {
  // GitHub Releases API 按发布时间倒序返回；实现依赖该顺序取第一条可用项
  const releases = [
    { tag_name: 'v2.4.0-nightly.1', draft: false, prerelease: true },
    { tag_name: 'v2.3.0', draft: false, prerelease: false },
    { tag_name: 'v9.9.9', draft: true, prerelease: false }
  ]

  it('稳定通道跳过草稿与预发布', () => {
    expect(pickLatestManagerRelease(releases, true)?.tag_name).toBe('v2.3.0')
  })

  it('非稳定通道允许预发布，但仍跳过草稿', () => {
    expect(pickLatestManagerRelease(releases, false)?.tag_name).toBe('v2.4.0-nightly.1')
  })

  it('空列表与无候选项返回 null', () => {
    expect(pickLatestManagerRelease([], true)).toBeNull()
    expect(pickLatestManagerRelease([releases[2]], true)).toBeNull()
  })
})
