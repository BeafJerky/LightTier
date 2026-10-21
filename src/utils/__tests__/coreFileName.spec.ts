import { describe, expect, it } from 'vitest'
import { getCoreFileName } from '@/constants/easytier'

describe('getCoreFileName', () => {
  it('按平台与版本拼接内核压缩包名，且不带前导斜杠', () => {
    expect(getCoreFileName('windows', 'x86_64', 'v2.7.0')).toBe(
      'easytier-windows-x86_64-v2.7.0.zip'
    )
  })

  it('与内核压缩包下载文件名规则一致', () => {
    expect(getCoreFileName('windows', 'x86_64', 'v2.6.4')).toBe(
      'easytier-windows-x86_64-v2.6.4.zip'
    )
  })
})
