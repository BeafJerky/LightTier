import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pickManagerInstaller, verifyManagerPackage } from '@/shared/platform/updateUtil'

const BASE = 'https://github.com/BeafJerky/LightTier/releases/download/v1.9.2'
const EXE_SHA = 'a'.repeat(64)
const APK_SHA = 'b'.repeat(64)
const assets = [
  {
    name: 'LightTier_1.9.2_arm64-release-signed.apk',
    size: 31622272,
    digest: `sha256:${APK_SHA}`,
    browser_download_url: `${BASE}/LightTier_1.9.2_arm64-release-signed.apk`
  },
  {
    name: 'LightTier_1.9.2_x64-setup.exe',
    size: 7578354,
    digest: `sha256:${EXE_SHA}`,
    browser_download_url: `${BASE}/LightTier_1.9.2_x64-setup.exe`
  },
  {
    name: 'LightTier_1.9.2_x64_en-US.msi',
    size: 8900608,
    browser_download_url: `${BASE}/LightTier_1.9.2_x64_en-US.msi`
  }
]

describe('pickManagerInstaller', () => {
  it('Windows 只选 NSIS setup.exe，不会误取 APK 或 MSI', () => {
    expect(pickManagerInstaller(assets)).toEqual({
      fileName: 'LightTier_1.9.2_x64-setup.exe',
      url: `${BASE}/LightTier_1.9.2_x64-setup.exe`,
      size: 7578354,
      sha256: EXE_SHA
    })
  })

  it('nightly 资产名同样命中', () => {
    expect(
      pickManagerInstaller([
        {
          name: 'LightTier_1.9.2-nightly.20261025_x64-setup.exe',
          size: 7.6e6,
          digest: `sha256:${EXE_SHA}`,
          browser_download_url: 'https://github.com/x/y/releases/download/t/a.exe'
        }
      ])?.fileName
    ).toBe('LightTier_1.9.2-nightly.20261025_x64-setup.exe')
  })

  it('Android 只选 arm64 APK，不会误取 exe / msi', () => {
    expect(pickManagerInstaller(assets, 'android')).toEqual({
      fileName: 'LightTier_1.9.2_arm64-release-signed.apk',
      url: `${BASE}/LightTier_1.9.2_arm64-release-signed.apk`,
      size: 31622272,
      sha256: APK_SHA
    })
  })

  it('digest 缺失或格式非法时拒绝应用内安装', () => {
    const pick = (digest?: string) =>
      pickManagerInstaller([
        {
          name: 'LightTier_1.9.2_x64-setup.exe',
          size: 1,
          digest,
          browser_download_url: 'https://github.com/x/y/releases/download/t/a.exe'
        }
      ])
    expect(pick(undefined)).toBeNull()
    expect(pick('')).toBeNull()
    expect(pick('md5:abc')).toBeNull()
    expect(pick('sha256:1234')).toBeNull()
    expect(pick(`sha256:${EXE_SHA.toUpperCase()}`)?.sha256).toBe(EXE_SHA)
  })

  it('Android nightly 的 _arm64.apk 同样命中', () => {
    expect(
      pickManagerInstaller(
        [
          {
            name: 'LightTier_2.1.2-nightly.20261114_arm64.apk',
            size: 33e6,
            digest: `sha256:${APK_SHA}`,
            browser_download_url: 'https://github.com/x/y/releases/download/t/a.apk'
          }
        ],
        'android'
      )?.fileName
    ).toBe('LightTier_2.1.2-nightly.20261114_arm64.apk')
  })

  it('非 Windows 平台与缺失资产返回 null，由调用方回退外链下载', () => {
    expect(pickManagerInstaller(assets, 'other')).toBeNull()
    expect(
      pickManagerInstaller([{ name: 'notes.txt', browser_download_url: 'https://x/y.txt' }])
    ).toBeNull()
    expect(pickManagerInstaller(undefined)).toBeNull()
  })

  it('缺少 download 地址或 size 的资产分别拒绝与降级为不确定进度', () => {
    expect(pickManagerInstaller([{ name: 'LightTier_1.9.2_x64-setup.exe' }])).toBeNull()
    expect(
      pickManagerInstaller([
        {
          name: 'LightTier_1.9.2_x64-setup.exe',
          digest: `sha256:${EXE_SHA}`,
          browser_download_url: 'https://github.com/x/y/releases/download/t/a.exe'
        }
      ])?.size
    ).toBeNull()
  })

  it('安装包摘要必须与完整字节内容匹配', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 1, 2, 3])
    const expected = createHash('sha256').update(bytes).digest('hex')
    expect(verifyManagerPackage(bytes, expected)).toBe(true)
    expect(verifyManagerPackage(bytes.buffer, expected.toUpperCase())).toBe(true)
    expect(verifyManagerPackage(bytes, EXE_SHA)).toBe(false)
    expect(verifyManagerPackage(bytes, '')).toBe(false)
    expect(verifyManagerPackage(bytes, 'sha256:1234')).toBe(false)
  })
})
