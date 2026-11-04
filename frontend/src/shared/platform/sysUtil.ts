import { arch, hostname, platform, type } from '@tauri-apps/plugin-os'
import { getVersion } from '@tauri-apps/api/app'

/** 运行平台（linux / macos / windows / android 等，编译期确定） */
export const getPlatform = () => platform()

/** 系统类型，取值同 getPlatform */
export const getOsType = () => type()

/** CPU 架构（x86_64 / aarch64 等，用于拼接内核包文件名） */
export const getArch = () => arch()

/** 本机主机名 */
export const getHostname = async () => hostname()

/** 异步等待指定毫秒 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 上网网卡筛选子句（PowerShell Where-Object 条件，routeUtil / useAutoMetric 共用）
 *
 * 条件：有 IPv4 默认网关、网卡 Up、排除 EasyTier 虚拟网卡。
 * 排除必须写 "et_*"：内核 v2.6.4 的虚拟网卡名为 et_<序号>_<随机4位>，
 * 而 PowerShell -like 不区分大小写，"et*" 会误伤名为 Ethernet 的物理网卡。
 */
export const PS_ADAPTER_FILTER_CLAUSE =
  '$_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" -and $_.NetAdapter.Name -notlike "et_*" -and $_.NetAdapter.Name -notlike "easytier*"'

/** 应用版本号（来自 tauri.conf.json，安装包版本以此为准） */
export const getAppVersion = async () => getVersion()

/**
 * 语义化版本比较：忽略 v 前缀；主版本相同时，带 pre 标签的版本更小。
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
