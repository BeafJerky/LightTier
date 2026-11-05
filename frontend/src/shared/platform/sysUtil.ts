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
 * 预发布标识按“.”分段比较（纯数字段按数值），因此同日构建
 * `2.0.3-nightly.20261105.2` 大于 `2.0.3-nightly.20261105`。
 * 第二个“-”之后是发布标签装饰（历史同标签重名规避），不代表二进制版本，直接忽略。
 * @returns 1 表示 a > b，-1 表示 a < b，0 表示相等
 */
export const compareVersions = (a: string, b: string): number => {
  const parse = (v: string) => {
    const s = v.replace(/^v/i, '')
    const dash = s.indexOf('-')
    if (dash === -1) return { core: s, pre: '' }
    return { core: s.slice(0, dash), pre: s.slice(dash + 1).split('-')[0] }
  }
  const va = parse(a)
  const vb = parse(b)
  const na = va.core.split('.').map((n) => parseInt(n, 10) || 0)
  const nb = vb.core.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i++) {
    const x = na[i] || 0
    const y = nb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (!va.pre && vb.pre) return 1
  if (va.pre && !vb.pre) return -1
  if (!va.pre && !vb.pre) return 0
  const pa = va.pre.split('.')
  const pb = vb.pre.split('.')
  const preLen = Math.max(pa.length, pb.length)
  for (let i = 0; i < preLen; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const dx = parseInt(x, 10)
      const dy = parseInt(y, 10)
      if (dx !== dy) return dx > dy ? 1 : -1
    } else if (nx !== ny) {
      // semver：纯数字标识优先级低于字母数字标识
      return nx ? -1 : 1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return 0
}
