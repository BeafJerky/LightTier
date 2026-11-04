import { describe, expect, it } from 'vitest'
import { pickManagerInstaller } from '@/shared/platform/updateUtil'

const BASE = 'https://github.com/BeafJerky/LightTier/releases/download/v1.9.2'
const assets = [
  {
    name: 'LightTier_1.9.2_arm64-release-signed.apk',
    size: 31622272,
    browser_download_url: `${BASE}/LightTier_1.9.2_arm64-release-signed.apk`
  },
  {
    name: 'LightTier_1.9.2_x64-setup.exe',
    size: 7578354,
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
      size: 7578354
    })
  })

  it('nightly 资产名同样命中', () => {
    expect(
      pickManagerInstaller([
        {
          name: 'LightTier_1.9.2-nightly.20261025_x64-setup.exe',
          size: 7.6e6,
          browser_download_url: 'https://github.com/x/y/releases/download/t/a.exe'
        }
      ])?.fileName
    ).toBe('LightTier_1.9.2-nightly.20261025_x64-setup.exe')
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
          browser_download_url: 'https://github.com/x/y/releases/download/t/a.exe'
        }
      ])?.size
    ).toBeNull()
  })
})
