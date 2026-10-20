import { arch, hostname, locale, platform, type } from '@tauri-apps/plugin-os'
import { getVersion } from '@tauri-apps/api/app'
import { Command } from '@tauri-apps/plugin-shell'

/**
 * 操作系统平台
 * @returns platform 返回一个描述使用的特定操作系统的字符串。该值在编译时设置。
 * 可能的值有 linux、macos、ios、freebsd、dragonfly、netbsd、openbsd、solaris、android、windows
 */
export const getPlatform = () => {
  return platform()
}

/**
 * 操作系统类型
 * @returns 返回一个描述使用的特定操作系统的字符串。该值在编译时设置。
 * 可能的值有 `'linux'` on Linux, `'macos'` on macOS, `'windows'` on Windows, `'ios'` on iOS and `'android'` on Android.
 */
export const getOsType = () => {
  return type()
}

/**
 * 获取系统架构
 * @returns 返回一个描述系统架构的字符串。该值在编译时设置。
 * 可能的值有 `'x86'`, `'x86_64'`, `'arm'`, `'aarch64'`, `'mips'`, `'mips64'`, `'powerpc'`, `'powerpc64'`, `'riscv64'`, `'s390x'`, `'sparc64'`.
 */
export const getArch = () => {
  return arch()
}
/**
 * 获取系统名
 * @returns 返回当前系统名
 */
export const getHostname = async () => {
  return await hostname()
}
/**
 * 获取当前系统语言（如 zh-CN）
 * @returns 返回当前系统语言
 */
export const getLocale = async () => {
  return await locale()
}

/** 延时指定毫秒（异步等待辅助） */
export const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 上网网卡筛选子句（PowerShell Where-Object 条件，routeUtil / useAutoMetric 共用单一样式）
 *
 * 语义：IPv4 默认网关存在、网卡 Up、排除 EasyTier 虚拟网卡。
 * 注意排除模式必须写 "et_*"（内核 v2.6.4 生成 et_<序号>_<随机4位>，见 easytier virtual_nic.rs）
 * 而非 "et*"——PowerShell -like 大小写不敏感，"et*" 会连默认名为 Ethernet 的物理网卡一起排除。
 */
export const PS_ADAPTER_FILTER_CLAUSE =
  '$_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" -and $_.NetAdapter.Name -notlike "et_*" -and $_.NetAdapter.Name -notlike "easytier*"'

/**
 * 获取当前App的版本
 */
export const getAppVersion = async () => {
  return await getVersion()
}

/**
 * 版本号比较（5.11 检查更新）
 * 处理 v 前缀与 pre 标签（如 v3.4.0-pre）；主版本相等时，带 pre 标签的版本较小
 * @returns 1 表示 a > b，-1 表示 a < b，0 表示相等
 */
export const compareVersions = (a: string, b: string): number => {
  const normalize = (v: string) => v.replace(/^v/i, '')
  const pa = normalize(a).split('-')
  const pb = normalize(b).split('-')
  const na = pa[0].split('.').map((n) => parseInt(n, 10) || 0)
  const nb = pb[0].split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i++) {
    const x = na[i] || 0
    const y = nb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  const preA = pa[1]
  const preB = pb[1]
  if (!preA && preB) return 1
  if (preA && !preB) return -1
  if (preA && preB) {
    if (preA < preB) return -1
    if (preA > preB) return 1
  }
  return 0
}

/**
 * 获取当前用户名
 * @returns 返回当前用户名，如果获取失败返回空字符串
 */
export const getCurrentUsername = async (): Promise<string> => {
  try {
    const osType = getOsType()
    if (osType === 'windows') {
      // Windows 上使用 whoami 命令
      const command = Command.create('cmd', ['/c', 'echo', '%USERNAME%'])
      const output = await command.execute()
      if (output.code === 0 && output.stdout) {
        return output.stdout.trim()
      }
    } else {
      // Unix-like 系统使用 whoami
      const command = Command.create('whoami')
      const output = await command.execute()
      if (output.code === 0 && output.stdout) {
        return output.stdout.trim()
      }
    }
  } catch (error) {
    console.error('获取用户名失败:', error)
  }
  return ''
}
