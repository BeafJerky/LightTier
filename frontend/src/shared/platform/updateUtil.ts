/**
 * 应用自身更新（5.11 检查更新的下载环节）——纯数据选取，不依赖 Tauri，便于单测。
 * GitHub Releases 的 assets 命名由打包脚本决定，这里按平台挑出可安装的那一个。
 */

/** 单个 Release 资产中下载所需的最小字段 */
export interface ReleaseAsset {
  name?: string
  size?: number
  browser_download_url?: string
}

/** 已选定的更新安装包：fileName 用于交给 Rust 命令定位 resource/update 下的文件 */
export interface ManagerInstaller {
  fileName: string
  /** GitHub 原始地址（未加加速源前缀） */
  url: string
  /** 官方标注的包体大小，缺失时为 null（下载进度转为不确定态） */
  size: number | null
}

/** Windows 桌面安装包：Tauri NSIS 产物固定命名 LightTier_<ver>_x64-setup.exe */
const WINDOWS_INSTALLER_RE = /^LightTier_.+_x64-setup\.exe$/i

/** Android 安装包：正式版 _arm64-release-signed.apk、nightly _arm64.apk */
const ANDROID_INSTALLER_RE = /^LightTier_.+_arm64.*\.apk$/i

/** 名称与下载地址齐备、可直接发起下载的资产 */
type UsableAsset = ReleaseAsset & { name: string; browser_download_url: string }

const isInstallerAsset = (asset: ReleaseAsset, pattern: RegExp): asset is UsableAsset =>
  typeof asset?.name === 'string' &&
  typeof asset.browser_download_url === 'string' &&
  /^https:\/\//.test(asset.browser_download_url) &&
  pattern.test(asset.name)

/**
 * 从 release assets 中挑出当前平台可用的安装包。
 * Windows 取 NSIS setup.exe，Android 取 arm64 APK；macOS/Linux 未发布资产，返回 null
 * 由调用方保留“前往下载”外链入口。
 */
export const pickManagerInstaller = (
  assets: ReleaseAsset[] | null | undefined,
  platform: 'windows' | 'android' | 'other' = 'windows'
): ManagerInstaller | null => {
  const pattern =
    platform === 'windows'
      ? WINDOWS_INSTALLER_RE
      : platform === 'android'
        ? ANDROID_INSTALLER_RE
        : null
  if (!pattern || !Array.isArray(assets)) return null
  const hit = assets.find((asset) => isInstallerAsset(asset, pattern))
  if (!hit) return null
  return {
    fileName: hit.name,
    url: hit.browser_download_url,
    size: typeof hit.size === 'number' && hit.size > 0 ? hit.size : null
  }
}
