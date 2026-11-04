/**
 * 监控数据的展示格式化
 *
 * 负责 CLI / RPC 返回的原始数值到界面文案的转换：延迟配色、字节与指标单位、
 * 路由开销与 NAT 类型本地化、peer 行归一化。
 */
import { t } from '@/shared/i18n/t'

/** 延迟（毫秒）配色区间，前端点越小越绿 */
const delayColorMap = [
  { min: 0, max: 10, color: 'green' },
  { min: 10, max: 80, color: '#45b458' },
  { min: 80, max: 150, color: '#71d481' },
  { min: 150, max: 250, color: '#fdc44d' },
  { min: 250, max: 350, color: '#fd884d' },
  { min: 350, max: Infinity, color: 'red' }
]

export const getDelayColor = (delay: string | number): string => {
  const value = parseFloat(String(delay))
  if (Number.isNaN(value)) return 'gray'
  return delayColorMap.find((r) => value >= r.min && value < r.max)?.color ?? 'gray'
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const HUMAN_BYTE_PATTERN = /^([\d.]+)\s*(B|kB|KB|MB|GB|TB)?$/i

const parseByteInput = (input: string | number): number => {
  if (typeof input === 'number') return input
  const parsed = Number(input)
  if (!Number.isNaN(parsed)) return parsed
  const match = input.trim().match(HUMAN_BYTE_PATTERN)
  if (!match) return Number.NaN
  const unit = (match[2] || 'B').toUpperCase()
  const factor = BYTE_UNITS.indexOf(unit)
  return parseFloat(match[1]) * Math.pow(1024, factor < 0 ? 0 : factor)
}

/** 字节数 → 人类可读字符串（无法解析时返回占位符） */
export const formatBytes = (bytes: string | number | null | undefined): string => {
  if (bytes === null || bytes === undefined || bytes === '-' || bytes === 'null') return '—'

  const value = parseByteInput(bytes)
  if (Number.isNaN(value) || value < 0) return '—'
  if (value === 0) return '0 B'

  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), BYTE_UNITS.length - 1)
  return `${(value / Math.pow(1024, unitIndex)).toFixed(1)} ${BYTE_UNITS[unitIndex]}`
}

/** 带单位后缀的监控指标（兼容 CLI 自带单位与纯数字） */
export const formatMetric = (val: string | number | null | undefined, unit: string): string => {
  if (val === null || val === undefined || val === '' || val === '-' || val === 'null') return '—'
  const text = String(val)
  return text.endsWith(unit) ? text : `${text}${unit}`
}

/** 路由开销类型 → 当前语言文案（比较时须使用同一函数） */
export const routeCost = (cost: string): string => {
  if (cost === 'p2p') return t('newMonitor.costP2p')
  if (cost === 'Local') return t('newMonitor.costLocal')
  return t('newMonitor.costRelay')
}

const NAT_TYPE_LABEL_KEYS: Record<string, string> = {
  '3': 'newMonitor.natFullCone',
  FullCone: 'newMonitor.natFullCone',
  '4': 'newMonitor.natRestricted',
  Restricted: 'newMonitor.natRestricted',
  '5': 'newMonitor.natPortRestricted',
  PortRestricted: 'newMonitor.natPortRestricted',
  '6': 'newMonitor.natSymmetric',
  Symmetric: 'newMonitor.natSymmetric',
  '0': 'newMonitor.natUnknown',
  Unknown: 'newMonitor.natUnknown',
  '1': 'newMonitor.natOpen',
  OpenInternet: 'newMonitor.natOpen',
  '2': 'newMonitor.natNoPat',
  NoPAT: 'newMonitor.natNoPat',
  '7': 'newMonitor.natSymUdpFw',
  SymUdpFirewall: 'newMonitor.natSymUdpFw'
}

/** NAT 类型（数值枚举或字符串枚举）→ 当前语言文案；未知值原样返回 */
export const getNatType = (natType: unknown): string => {
  const key = NAT_TYPE_LABEL_KEYS[String(natType)]
  return key ? t(key) : String(natType)
}

/** peer 行归一化：去 IPv4 掩码、清理公共服务器名、翻译成本/NAT 与延迟配色 */
export const processPeerData = (peers: PeerInfo[]): PeerInfo[] =>
  peers.map((peer) => {
    let ipv4 = peer.ipv4 || ''
    let hostname = peer.hostname || ''

    if (ipv4.includes('/')) ipv4 = ipv4.split('/')[0]
    if (hostname.includes('PublicServer_')) {
      hostname = hostname.replace('PublicServer_', '')
      ipv4 = t('newMonitor.serverLabel')
    }

    return {
      ...peer,
      ipv4,
      hostname,
      cost: routeCost(peer.cost),
      nat_type: getNatType(peer.nat_type),
      delayColor: getDelayColor(peer.lat_ms)
    }
  })
