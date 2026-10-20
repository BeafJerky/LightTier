import { describe, expect, it } from 'vitest'
import { GITHUB_EASYTIER, getCoreDownloadUrl, getMirrorUrl } from '@/constants/easytier'

const VERSION = 'v2.6.4'
const FILENAME = 'easytier-windows-x86_64-v2.6.4.zip'
const GITHUB_URL = `${GITHUB_EASYTIER}/releases/download/${VERSION}/${FILENAME}`

describe('getCoreDownloadUrl', () => {
  it('官方源返回 GitHub 直链（含尾部斜杠也归一化）', () => {
    expect(getCoreDownloadUrl(GITHUB_EASYTIER, VERSION, FILENAME)).toBe(GITHUB_URL)
    expect(getCoreDownloadUrl(`${GITHUB_EASYTIER}/`, VERSION, FILENAME)).toBe(GITHUB_URL)
  })

  it('镜像源必须拼接完整 GitHub URL，而不是只接 releases 路径', () => {
    expect(getCoreDownloadUrl('https://ghfast.top/', VERSION, FILENAME)).toBe(
      `https://ghfast.top/${GITHUB_URL}`
    )
    expect(getCoreDownloadUrl('https://ghfast.top', VERSION, FILENAME)).toBe(
      `https://ghfast.top/${GITHUB_URL}`
    )
  })

  it('空源回退官方直链', () => {
    expect(getCoreDownloadUrl('', VERSION, FILENAME)).toBe(GITHUB_URL)
  })
})

describe('getMirrorUrl', () => {
  it('仅官方源保持原样，其余源以前缀方式包裹 GitHub URL', () => {
    expect(getMirrorUrl(GITHUB_EASYTIER, GITHUB_URL)).toBe(GITHUB_URL)
    expect(getMirrorUrl('https://gh-proxy.com/', GITHUB_URL)).toBe(
      `https://gh-proxy.com/${GITHUB_URL}`
    )
  })
})
