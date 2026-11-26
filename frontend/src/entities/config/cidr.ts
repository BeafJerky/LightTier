/**
 * DHCP / DHCPv6 / 子网代理网段轻校验（只做提示，不阻断保存与原值透传）。
 *
 * 规则与 EasyTier v2.7.1 内核一致：
 * - dhcp：IPv4 CIDR，前缀长度 ≤30
 * - dhcpv6：IPv6 CIDR，仅 fc00::/7（ULA）或 2000::/3（全局单播），前缀 ≤126
 * - proxy_network：IPv4 CIDR，可写 `<cidr>-><mapped_cidr>` 做网段映射
 */
export type CidrIssue = 'format' | 'prefix' | 'range'

const IPV4_OCTET = /^\d{1,3}$/

const parseIpv4 = (address: string): number[] | null => {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null
    // 拒绝 01 这类前导零写法，避免与内核解析口径不一致
    if (part.length > 1 && part.startsWith('0')) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

const parseIpv6 = (address: string): number[] | null => {
  if (!address || !/^[0-9a-fA-F:]+$/.test(address)) return null
  const doubleColon = address.indexOf('::')
  if (doubleColon !== -1 && doubleColon !== address.lastIndexOf('::')) return null

  let head: string[]
  let tail: string[]
  if (doubleColon === -1) {
    head = address.split(':')
    tail = []
  } else {
    const left = address.slice(0, doubleColon)
    const right = address.slice(doubleColon + 2)
    head = left ? left.split(':') : []
    tail = right ? right.split(':') : []
  }

  const groups = [...head, ...tail]
  if (groups.some((group) => !group || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group))) {
    return null
  }

  const missing = 8 - head.length - tail.length
  if (doubleColon === -1) {
    if (missing !== 0) return null
  } else if (missing < 1) {
    return null
  }

  const expanded = [...head, ...Array<string>(Math.max(0, missing)).fill('0'), ...tail]
  return expanded.map((group) => Number.parseInt(group, 16))
}

const splitCidr = (value: string): { address: string; prefix: number } | 'format' => {
  const trimmed = value.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash !== trimmed.lastIndexOf('/')) return 'format'
  const address = trimmed.slice(0, slash)
  const rawPrefix = trimmed.slice(slash + 1)
  if (!/^\d{1,3}$/.test(rawPrefix)) return 'format'
  return { address, prefix: Number(rawPrefix) }
}

/** 空值表示使用内核默认地址池，返回 null */
export const validateDhcpCidr = (value: string): CidrIssue | null => {
  if (!value.trim()) return null
  const parsed = splitCidr(value)
  if (parsed === 'format') return 'format'
  if (!parseIpv4(parsed.address)) return 'format'
  if (parsed.prefix > 30) return 'prefix'
  return null
}

/** 空值表示使用内核默认地址池，返回 null */
export const validateDhcpv6Cidr = (value: string): CidrIssue | null => {
  if (!value.trim()) return null
  const parsed = splitCidr(value)
  if (parsed === 'format') return 'format'
  const groups = parseIpv6(parsed.address)
  if (!groups) return 'format'
  const first = groups[0]
  const isUla = (first & 0xfe00) === 0xfc00
  const isGlobalUnicast = (first & 0xe000) === 0x2000
  if (!isUla && !isGlobalUnicast) return 'range'
  if (parsed.prefix > 126) return 'prefix'
  return null
}

const validateIpv4CidrPart = (value: string): CidrIssue | null => {
  const parsed = splitCidr(value)
  if (parsed === 'format') return 'format'
  if (!parseIpv4(parsed.address)) return 'format'
  if (parsed.prefix > 32) return 'prefix'
  return null
}

/** 子网代理：空值返回 null；支持 `192.168.1.0/24` 与 `192.168.1.0/24->10.0.0.0/24` */
export const validateProxyCidr = (value: string): CidrIssue | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parts = trimmed.split('->')
  if (parts.length > 2) return 'format'
  const real = validateIpv4CidrPart(parts[0])
  if (real) return real
  if (parts.length === 2) {
    const mapped = validateIpv4CidrPart(parts[1])
    if (mapped) return mapped
  }
  return null
}
