/**
 * EasyTier 输出解析与格式化工具集
 *
 * 三类职责：
 * 1. CLI 文本解析：node / peer 表格文本 → 对象（parseNodeInfo / parsePeerInfo）；
 * 2. 日志提取与读取：从日志文本提取公网 IP（extractAllPublicIPs）、尾部顺序读取
 *    （readTextTail，供日志查看器只读末尾 N 行）；
 * 3. 展示格式化：延迟配色、字节/指标格式化、路由开销与 NAT 类型转可读文本、
 *    peer 数据后处理（processPeerData）与 TOML 配置清洗（normalizeToml，5.7）。
 */
import defaultData from '@/constants/defaultData'
import { t } from '@/utils/i18nUtil'

/** 解析 `easytier-cli node` 表格文本为键值对象（形如 │ key │ value │ 的行） */
export const parseNodeInfo = (content: string) => {
  const regex = /^\s*│\s*([^│]+)\s*│\s*([^│]+)\s*│\s*$/gm
  const result: Record<string, string> = {}
  let match
  while ((match = regex.exec(content)) !== null) {
    const key = match[1].trim()
    result[key] = match[2].trim()
  }
  return result
}
/**
 * 解析 `easytier-cli peer` 表格文本为对象数组
 * 表头取自第 2 行；数据自第 4 行起隔行取值（中间为分隔线）；'-' 与空串归一为 null
 */
export const parsePeerInfo = (content: string) => {
  // 将表格字符串分割成行
  const lines = content.split('\n')

  // 提取表头（keys）
  const headers = lines[1]
    .split('│')
    .slice(1, -1)
    .map((h: string) => h.trim())

  // 初始化结果数组
  const result: any[] = []

  // 遍历数据行
  for (let i = 3; i < lines.length - 1; i += 2) {
    if (lines[i].trim() === '') continue // 跳过空行

    // 分割每一行的数据
    const values = lines[i]
      .split('│')
      .slice(1, -1)
      .map((v: string) => v.trim())

    // 创建对象并添加到结果数组
    const obj: any = {}
    headers.forEach((header: string, index: number) => {
      obj[header] = values[index] === '-' || values[index] === '' ? null : values[index]
    })

    // 每行数据都作为一个新对象添加到结果数组中
    result.push(obj)
  }

  return result
}

/**
 * 从内核日志文本中提取候选公网 IP（用于展示本机公网地址）
 * 三种来源合并：public_ipv4 字段 > dest_addr（排除 mapped_addr）> "got ip list"；
 * 过滤私网/回环/链路本地地址，按来源优先级 → 出现次数 → 出现位置排序
 */
export async function extractAllPublicIPs(logText: string) {
  // 私网IP判断函数
  function isPrivateIP(ip: string) {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    return (
      parts[0] === '10' ||
      (parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31) ||
      (parts[0] === '192' && parts[1] === '168') ||
      parts[0] === '127' || // 本地回环
      (parts[0] === '0' && parts[1] === '0' && parts[2] === '0') || // 全0地址
      ip === '0.0.0.0' ||
      ip.startsWith('169.254.')
    ) // 链路本地地址
  }

  // 按行分割日志
  const lines = logText.split('\n').filter((line: string) => line.trim())

  // 获取 mapped_addr 中的IP（排除用）
  const mappedAddrMatch = logText.match(
    /mapped_addr=Some\(SocketAddr\s*\{[^}]*ip:\s*Some\(Ipv4\(([\d.]+)\)\)/
  )
  const mappedIP = mappedAddrMatch ? mappedAddrMatch[1] : null

  // 收集所有候选IP，记录来源和出现次数
  const ipCandidates = new Map()

  lines.forEach((line: string, lineIndex: number) => {
    // 策略1: 提取 public_ipv4
    const publicMatch = line.match(/public_ipv4:\s*Some\(([\d.]+)\)/)
    if (publicMatch) {
      const ip = publicMatch[1]
      if (!isPrivateIP(ip)) {
        if (!ipCandidates.has(ip)) {
          ipCandidates.set(ip, {
            ip: ip,
            count: 0,
            sources: new Set(),
            lineNumbers: new Set(),
            lines: []
          })
        }
        const candidate = ipCandidates.get(ip)
        candidate.count++
        candidate.sources.add('public_ipv4')
        candidate.lineNumbers.add(lineIndex)
        candidate.lines.push(line.trim())
      }
    }

    // 策略2: 提取 dest_addr 中的IP（排除 mapped_addr）
    const destMatch = line.match(
      /dest_addr=Some\(SocketAddr\s*\{[^}]*ip:\s*Some\(Ipv4\(([\d.]+)\)\)/
    )
    if (destMatch) {
      const ip = destMatch[1]
      if (!isPrivateIP(ip) && ip !== mappedIP) {
        if (!ipCandidates.has(ip)) {
          ipCandidates.set(ip, {
            ip: ip,
            count: 0,
            sources: new Set(),
            lineNumbers: new Set(),
            lines: []
          })
        }
        const candidate = ipCandidates.get(ip)
        candidate.count++
        candidate.sources.add('dest_addr')
        candidate.lineNumbers.add(lineIndex)
        candidate.lines.push(line.trim())
      }
    }
  })

  // 策略3: 从 "got ip list" 中提取非私网IP
  const gotIpListLines = lines.filter((line: string) => line.includes('got ip list'))
  if (gotIpListLines.length > 0) {
    gotIpListLines.forEach((line: string, lineIndex: number) => {
      const allIPs =
        line.match(
          /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g
        ) || []
      allIPs.forEach((ip: string) => {
        if (!isPrivateIP(ip)) {
          if (!ipCandidates.has(ip)) {
            ipCandidates.set(ip, {
              ip: ip,
              count: 0,
              sources: new Set(),
              lineNumbers: new Set(),
              lines: []
            })
          }
          const candidate = ipCandidates.get(ip)
          candidate.count++
          candidate.sources.add('got_ip_list')
          candidate.lineNumbers.add(lineIndex)
          candidate.lines.push(line.trim())
        }
      })
    })
  }

  // 转换为数组并排序
  const result = Array.from(ipCandidates.values()).map((candidate) => ({
    ...candidate,
    sources: Array.from(candidate.sources),
    lineNumbers: Array.from(candidate.lineNumbers)
  }))

  // 排序规则：
  // 1. 优先级高的来源在前（public_ipv4 > dest_addr > got_ip_list）
  // 2. 出现次数多的在前
  // 3. 出现的行数少的在前（更早出现）
  const sourcePriority = { public_ipv4: 3, dest_addr: 2, got_ip_list: 1 }

  result.sort((a, b) => {
    // 计算优先级分数
    const getPriorityScore = (sources: string[]) => {
      return Math.max(
        ...sources.map((s: string) => sourcePriority[s as keyof typeof sourcePriority] || 0)
      )
    }

    const priorityCompare = getPriorityScore(b.sources) - getPriorityScore(a.sources)
    if (priorityCompare !== 0) return priorityCompare

    // 出现次数比较
    const countCompare = b.count - a.count
    if (countCompare !== 0) return countCompare

    // 出现行数比较（更早出现的在前）
    return Math.min(...a.lineNumbers) - Math.min(...b.lineNumbers)
  })

  return result.map((r) => r.ip)
}

/**
 * 顺序读取文本末尾的指定行数（保持旧→新的时间顺序）
 *
 * 日志查看器采用“顶部最旧、底部最新”的常规顺序，因此不能再返回倒序结果：
 * 旧实现把最后一行放在开头，界面又自动滚到底部，用户实际看到的是窗口里
 * 最旧的位置，新日志从顶部出现且不在视野内（修复 F-01）。
 *
 * @param text 要读取的文本
 * @param linesToRead 要保留的末尾行数
 * @returns 末尾 N 行，按原始时间顺序用换行符连接
 */
export function readTextTail(text: string, linesToRead: number) {
  if (typeof text !== 'string') {
    throw new Error('第一个参数必须是字符串')
  }
  if (!Number.isFinite(linesToRead) || linesToRead < 0) {
    throw new Error('第二个参数必须是正整数')
  }

  const lines = text.split(/\r?\n/)
  // 文件以换行结尾时会多出空元素，尾部空行不参与行数计算
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''

  const actualLinesToRead = Math.min(Math.floor(linesToRead), lines.length)
  return lines.slice(-actualLinesToRead).join('\n')
}

/**
 * 延迟颜色映射表
 */
export const delayColorMap = [
  { min: 0, max: 10, color: 'green' },
  { min: 10, max: 80, color: '#45b458' },
  { min: 80, max: 150, color: '#71d481' },
  { min: 150, max: 250, color: '#fdc44d' },
  { min: 250, max: 350, color: '#fd884d' },
  { min: 350, max: Infinity, color: 'red' }
]

/**
 * 根据延迟值获取对应的颜色
 */
export const getDelayColor = (delay: string | number): string => {
  const value = parseFloat(String(delay))
  if (isNaN(value)) return 'gray'
  const matched = delayColorMap.find((r) => value >= r.min && value < r.max)
  return matched ? matched.color : 'gray'
}

/**
 * 格式化字节数为可读字符串
 */
export const formatBytes = (bytes: string | number | null | undefined): string => {
  if (bytes === null || bytes === undefined || bytes === '-' || bytes === 'null') return '—'
  let b = Number(bytes)
  if (isNaN(b) && typeof bytes === 'string') {
    // 解析 CLI 返回的人类可读格式，如 "1.26 kB"
    const match = bytes.trim().match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB)?$/i)
    if (match) {
      const num = parseFloat(match[1])
      const unit = (match[2] || 'B').toUpperCase()
      const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024
      }
      b = num * (multipliers[unit] || 1)
    }
  }
  if (isNaN(b) || b < 0) return '—'
  if (b === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + units[Math.min(i, units.length - 1)]
}

/**
 * 带单位后缀的监控指标格式化（延迟 ms、丢包 % 等）
 * 兼容真实数据（本地节点无数据为 "-"，部分字段 CLI 输出已自带单位如 "0.0%"）与 mock（纯数字）
 * @param val 原始值
 * @param unit 单位后缀，如 'ms'、'%'
 */
export const formatMetric = (val: string | number | null | undefined, unit: string): string => {
  if (val === null || val === undefined || val === '' || val === '-' || val === 'null') return '—'
  const s = String(val)
  return s.endsWith(unit) ? s : `${s}${unit}`
}

/**
 * 路由开销类型转可读文本（文案随当前语言；比较时应与调用方使用同一函数保持一致性）
 */
export const routeCost = (cost: string): string => {
  switch (cost) {
    case 'p2p':
      return t('newMonitor.costP2p')
    case 'Local':
      return t('newMonitor.costLocal')
    default:
      return t('newMonitor.costRelay')
  }
}

/**
 * NAT 类型转可读文本（文案随当前语言）
 */
export const getNatType = (natType: any): string => {
  switch (natType) {
    case 3:
    case 'FullCone':
      return t('newMonitor.natFullCone')
    case 4:
    case 'Restricted':
      return t('newMonitor.natRestricted')
    case 5:
    case 'PortRestricted':
      return t('newMonitor.natPortRestricted')
    case 6:
    case 'Symmetric':
      return t('newMonitor.natSymmetric')
    case 0:
    case 'Unknown':
      return t('newMonitor.natUnknown')
    case 1:
    case 'OpenInternet':
      return t('newMonitor.natOpen')
    case 2:
    case 'NoPAT':
      return t('newMonitor.natNoPat')
    case 7:
    case 'SymUdpFirewall':
      return t('newMonitor.natSymUdpFw')
    default:
      return String(natType)
  }
}

/**
 * 统一后处理 peer 数据
 * - IPv4 去掉 CIDR 后缀
 * - 公共服务器清理 hostname
 * - 转换 cost/nat_type/delayColor
 */
export const processPeerData = (peers: PeerInfo[]): PeerInfo[] => {
  return peers.map((p) => {
    let ipv4 = p.ipv4 || ''
    let hostname = p.hostname || ''
    if (ipv4.includes('/')) ipv4 = ipv4.split('/')[0]
    if (hostname.includes('PublicServer_')) {
      hostname = hostname.replace('PublicServer_', '')
      ipv4 = t('newMonitor.serverLabel')
    }
    return {
      ...p,
      ipv4,
      hostname,
      cost: routeCost(p.cost),
      nat_type: getNatType(p.nat_type),
      delayColor: getDelayColor(p.lat_ms)
    }
  })
}

// === 5.7 默认数据合并 + 空值清理 ===
const isEmptyValue = (v: any): boolean => {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

// 仅补标量默认值（字符串非空/布尔/数字），数组与对象默认不注入，避免产生空结构
const isScalarDefault = (v: any): boolean =>
  v !== undefined && v !== null && v !== '' && typeof v !== 'object'

/**
 * 统一 TOML 配置清洗：
 * 1. 空值剔除：空串、空数组、undefined、null 一律不落盘（避免内核启动参数异常）；
 * 2. 默认值合并（mergeDefaults 默认开启）：缺失字段补 defaultFormData 的标量默认（保证展示完整）；
 *    保存场景传 { mergeDefaults: false }，只剔空值不注入默认，避免配置膨胀；
 * 3. flags 深度清理：空值字段删除，全空则删除整个 flags。
 */
export const normalizeToml = (
  cfg: Record<string, any>,
  options: { mergeDefaults?: boolean } = {}
): Record<string, any> => {
  const merge = options.mergeDefaults ?? true
  const def = (defaultData as any).defaultFormData || {}
  const out: Record<string, any> = {}
  Object.keys(def).forEach((k) => {
    const v = cfg[k]
    if (isEmptyValue(v)) {
      if (merge && isScalarDefault(def[k])) out[k] = def[k]
    } else {
      out[k] = v
    }
  })
  // 非默认表中的键（用户自定义/未来字段）透传，同样剔除空值
  Object.keys(cfg).forEach((k) => {
    if (!(k in def) && !isEmptyValue(cfg[k])) out[k] = cfg[k]
  })
  if (merge) {
    // flags 内缺失的标量默认值同样补全（如 enable_encryption、default_protocol）；
    // 无 flags 键时新建（解析/展示语义要求完整）
    const defFlags = def.flags || {}
    const hasDefaults = Object.keys(defFlags).some((k) => isScalarDefault(defFlags[k]))
    if (hasDefaults) {
      if (!out.flags || typeof out.flags !== 'object') out.flags = {}
      Object.keys(defFlags).forEach((k) => {
        if (isEmptyValue(out.flags[k]) && isScalarDefault(defFlags[k])) out.flags[k] = defFlags[k]
      })
    }
  }
  if (out.flags && typeof out.flags === 'object') {
    Object.keys(out.flags).forEach((k) => {
      if (isEmptyValue(out.flags[k])) delete out.flags[k]
    })
    if (Object.keys(out.flags).length === 0) delete out.flags
  }
  return out
}
