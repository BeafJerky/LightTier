/**
 * 日志文本工具
 *
 * - readTextTail：日志查看器只读取文件末尾 N 行，保持「旧→新」顺序（修复 F-01）；
 * - extractAllPublicIPs：从内核日志推断本机公网地址，供出口路由接管前展示。
 */

/** 提取末尾 N 行（旧→新顺序）；末尾空行不计入行数，N 为 0 时返回空串 */
export const readTextTail = (text: string, linesToRead: number): string => {
  if (typeof text !== 'string') throw new Error('第一个参数必须是字符串')
  if (!Number.isFinite(linesToRead) || linesToRead < 0) throw new Error('第二个参数必须是正整数')

  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const take = Math.min(Math.floor(linesToRead), lines.length)
  return take > 0 ? lines.slice(-take).join('\n') : ''
}

type IpSource = 'public_ipv4' | 'dest_addr' | 'got_ip_list'

// 来源可信度：内核显式上报 > 连接目标 > IP 列表
const SOURCE_PRIORITY: Record<IpSource, number> = {
  public_ipv4: 3,
  dest_addr: 2,
  got_ip_list: 1
}

const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g

// 私网、回环、全零与链路本地地址不能代表公网出口
const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const [a, b, c] = parts
  return (
    a === '10' ||
    (a === '172' && Number(b) >= 16 && Number(b) <= 31) ||
    (a === '192' && b === '168') ||
    a === '127' ||
    (a === '0' && b === '0' && c === '0') ||
    ip === '0.0.0.0' ||
    ip.startsWith('169.254.')
  )
}

/**
 * 从内核日志提取候选公网 IP。
 *
 * 候选来源：public_ipv4 字段、dest_addr（排除 mapped_addr）、"got ip list"；
 * 过滤私网地址后按来源可信度 → 出现次数 → 首次出现位置排序。
 */
export const extractAllPublicIPs = (logText: string): string[] => {
  const lines = logText.split('\n').filter((line) => line.trim())
  const mappedIp =
    /mapped_addr=Some\(SocketAddr\s*\{[^}]*ip:\s*Some\(Ipv4\(([\d.]+)\)\)/.exec(logText)?.[1] ??
    null

  const candidates = new Map<string, { count: number; priority: number; first: number }>()
  const collect = (ip: string, source: IpSource, seq: number) => {
    if (isPrivateIpv4(ip)) return
    if (source === 'dest_addr' && ip === mappedIp) return
    const hit = candidates.get(ip)
    if (hit) {
      hit.count++
      hit.priority = Math.max(hit.priority, SOURCE_PRIORITY[source])
      return
    }
    candidates.set(ip, { count: 1, priority: SOURCE_PRIORITY[source], first: seq })
  }

  lines.forEach((line, seq) => {
    const publicIpv4 = /public_ipv4:\s*Some\(([\d.]+)\)/.exec(line)
    if (publicIpv4) collect(publicIpv4[1], 'public_ipv4', seq)

    const destAddr = /dest_addr=Some\(SocketAddr\s*\{[^}]*ip:\s*Some\(Ipv4\(([\d.]+)\)\)/.exec(line)
    if (destAddr) collect(destAddr[1], 'dest_addr', seq)
  })

  lines.forEach((line, seq) => {
    if (!line.includes('got ip list')) return
    for (const ip of line.match(IPV4_PATTERN) ?? []) collect(ip, 'got_ip_list', seq)
  })

  return [...candidates.entries()]
    .sort(([, a], [, b]) => b.priority - a.priority || b.count - a.count || a.first - b.first)
    .map(([ip]) => ip)
}
