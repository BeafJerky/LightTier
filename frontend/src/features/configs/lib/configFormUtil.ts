/**
 * 配置表单 ⇄ TOML 互转（EditDialog 结构化表单模式的核心，纯函数便于单测）
 *
 * 规则与 EditDialog 保持一致：
 * - 文本字段空值剔除；network_identity/listeners/peer/proxy_network/routes/exit_nodes/flags 按需落盘
 * - 安全模式按 EasyTier Core v2.6.4 规范映射：
 *   [secure_mode] { enabled, local_private_key, local_public_key }，credential_file 为顶层字段；
 *   旧版写在顶层/flags 的密钥在解析时迁移，保存时统一改写为 [secure_mode] 表
 * - 安全模式敏感字段（SECURITY_FIELD_DEFS 中 secret: true）以掩码回显：
 *   真实值进 secretBackup、显示 SECRET_MASK；构建时未改动写回备份原值，
 *   改动用新值，清空则删除。安全模式关闭时不落盘任何安全字段
 * - 自定义 Flags 与固定高级字段分离，避免同 key 双处编辑
 */
import * as toml from 'smol-toml'
import {
  ADVANCED_FIELD_KEYS,
  SECRET_MASK,
  SECURITY_FIELD_DEFS
} from '@/entities/config/defaultData'
import { migrateLightTierConfig } from '@/entities/config/lighttierConfigUtil'

/** 表单模型（与 EditDialog 内各 ref 一一对应，均为可序列化的纯数据） */
export interface ConfigFormModel {
  /** 顶层非密字段（hostname/instance_name/dhcp/rpc_portal/socks5_proxy/flags 等） */
  formData: Record<string, any>
  /** 表单未建模的顶层键/表（vpn_portal_config、[lighttier]、source 等），保存时原样透传 */
  passthrough: Record<string, any>
  /** 敏感字段的输入框显示值（掩码 SECRET_MASK / 用户新输入 / 空） */
  secretDisplays: Record<string, string>
  /** 敏感字段真实值备份（掩码未被修改时写回该值） */
  secretBackup: Record<string, string>
  /** 安全模式开关：仅开启时渲染安全字段并写入 [secure_mode] 表 */
  secureModeEnabled: boolean
  /** stun_servers 逗号分隔文本 */
  stunServers: string
  listeners: string[]
  peers: string[]
  /** 与 peers 索引对齐的额外字段（如 peer_public_key，v2.6.0+），保存时原样保留 */
  peerExtras: Record<string, any>[]
  /** 子网代理：每行为 `<cidr>` 或 `<cidr>-><mapped_cidr>` */
  proxies: string[]
  /** 与 proxies 索引对齐的未建模字段（allow 等），保存时原样保留 */
  proxyExtras: Record<string, any>[]
  /** 监听映射（mapped_listeners，URI 列表） */
  mappedListeners: string[]
  /** 端口转发（port_forward 数组） */
  portForwards: PortForwardForm[]
  routes: string[]
  exitNodes: string[]
  flagsKeys: string[]
  flagsVals: string[]
  networkName: string
  networkSecret: string
  /** DHCP 网段（v2.7.1+，如 10.0.0.0/24）；空串表示使用 dhcp 布尔值 */
  dhcpCidr: string
  /** DHCPv6 开关与网段（v2.7.1+，顶层 dhcpv6 字段） */
  dhcpv6Enabled: boolean
  dhcpv6Cidr: string
  /** Magic DNS（v2.7.1+，顶层 [dns] 表）；zone/record 的 ttl 以文本编辑，落盘转数字 */
  dns: DnsForm
  /** WireGuard 门户（vpn_portal_config；v2.7 新结构 / 旧结构共用） */
  vpnPortal: VpnPortalForm
  /** 访问控制（acl 表；结构与字段跨版本一致） */
  acl: AclForm
  /** 当前内核不支持的 flags：只读展示、保存时原样写回，不进入自定义 Flags 编辑 */
  lockedFlags?: Record<string, any>
  /** 当前内核不支持/已移除的顶层字段：只读展示、保存时原样写回 */
  lockedTopLevel?: Record<string, any>
}

/** Magic DNS 记录（表单形态：ttl 为输入框文本） */
export interface DnsRecordForm {
  name: string
  type: string
  ttl: string
  value: string
}

/** Magic DNS 静态区域（表单形态） */
export interface DnsZoneForm {
  origin: string
  ttl: string
  records: DnsRecordForm[]
}

/** Magic DNS 表单：域名 + 静态区域 */
export interface DnsForm {
  domain: string
  zones: DnsZoneForm[]
}

export const emptyDnsRecord = (): DnsRecordForm => ({ name: '', type: 'A', ttl: '', value: '' })
export const emptyDnsZone = (): DnsZoneForm => ({ origin: '', ttl: '', records: [] })
export const emptyDnsForm = (): DnsForm => ({ domain: '', zones: [] })

/** 端口转发表单行（bind_addr / dst_addr 含端口；其余字段原样保留） */
export interface PortForwardForm {
  proto: string
  bind_addr: string
  dst_addr: string
  [key: string]: unknown
}

/** WireGuard 门户客户端（v2.7.0+；groups 表单以空格/逗号分隔） */
export interface VpnPortalClientForm {
  name: string
  virtual_ip: string
  groups: string
}

/** WireGuard 门户表单：同一模型承载 v2.7 新结构与 ≤v2.6.4 旧结构 */
export interface VpnPortalForm {
  /** 配置存在即为启用；v2.7 显式关闭时写 enabled=false */
  enabled: boolean
  /** 是否旧结构（≤v2.6.4 的 client_cidr） */
  legacy: boolean
  wireguardListen: string
  privateKey: string
  clients: VpnPortalClientForm[]
  legacyClientCidr: string
}

export const emptyVpnPortalForm = (): VpnPortalForm => ({
  enabled: false,
  legacy: false,
  wireguardListen: '',
  privateKey: '',
  clients: [],
  legacyClientCidr: ''
})

/** ACL 规则（数组字段以空格/逗号分隔文本编辑） */
export interface AclRuleForm {
  name: string
  description: string
  priority: string
  enabled: boolean
  protocol: number
  ports: string
  sourceIps: string
  destinationIps: string
  sourcePorts: string
  action: number
  rateLimit: string
  burstLimit: string
  stateful: boolean
  sourceGroups: string
  destinationGroups: string
}

export interface AclChainForm {
  name: string
  chainType: number
  description: string
  enabled: boolean
  defaultAction: number
  rules: AclRuleForm[]
}

export interface AclGroupDeclareForm {
  groupName: string
  groupSecret: string
}

export interface AclForm {
  enabled: boolean
  chains: AclChainForm[]
  declares: AclGroupDeclareForm[]
  members: string
}

export const emptyAclRule = (): AclRuleForm => ({
  name: '',
  description: '',
  priority: '0',
  enabled: true,
  protocol: 5,
  ports: '',
  sourceIps: '',
  destinationIps: '',
  sourcePorts: '',
  action: 1,
  rateLimit: '',
  burstLimit: '',
  stateful: false,
  sourceGroups: '',
  destinationGroups: ''
})

export const emptyAclChain = (): AclChainForm => ({
  name: '',
  chainType: 1,
  description: '',
  enabled: true,
  defaultAction: 1,
  rules: []
})

export const emptyAclForm = (): AclForm => ({
  enabled: false,
  chains: [],
  declares: [],
  members: ''
})

const ACL_PROTOCOL_CODES: Record<string, number> = {
  Unspecified: 0,
  TCP: 1,
  UDP: 2,
  ICMP: 3,
  ICMPv6: 4,
  Any: 5
}
const ACL_ACTION_CODES: Record<string, number> = { Noop: 0, Allow: 1, Drop: 2 }
const ACL_CHAIN_TYPE_CODES: Record<string, number> = {
  UnspecifiedChain: 0,
  Inbound: 1,
  Outbound: 2,
  Forward: 3
}

const aclEnum = (value: unknown, codes: Record<string, number>, fallback: number): number => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string') return codes[value] ?? fallback
  return fallback
}

const splitList = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const parseAclRule = (raw: Record<string, any>): AclRuleForm => ({
  name: typeof raw.name === 'string' ? raw.name : '',
  description: typeof raw.description === 'string' ? raw.description : '',
  priority: raw.priority === undefined ? '0' : String(raw.priority),
  enabled: raw.enabled !== false,
  protocol: aclEnum(raw.protocol, ACL_PROTOCOL_CODES, 5),
  ports: Array.isArray(raw.ports) ? raw.ports.join(' ') : '',
  sourceIps: Array.isArray(raw.source_ips) ? raw.source_ips.join(' ') : '',
  destinationIps: Array.isArray(raw.destination_ips) ? raw.destination_ips.join(' ') : '',
  sourcePorts: Array.isArray(raw.source_ports) ? raw.source_ports.join(' ') : '',
  action: aclEnum(raw.action, ACL_ACTION_CODES, 1),
  rateLimit: raw.rate_limit === undefined ? '' : String(raw.rate_limit),
  burstLimit: raw.burst_limit === undefined ? '' : String(raw.burst_limit),
  stateful: raw.stateful === true,
  sourceGroups: Array.isArray(raw.source_groups) ? raw.source_groups.join(' ') : '',
  destinationGroups: Array.isArray(raw.destination_groups) ? raw.destination_groups.join(' ') : ''
})

const parseAclForm = (raw: unknown): AclForm => {
  if (!isPlainObject(raw)) return emptyAclForm()
  const v1 = isPlainObject(raw.acl_v1) ? raw.acl_v1 : null
  if (!v1) return emptyAclForm()
  const chains = Array.isArray(v1.chains)
    ? v1.chains.filter(isPlainObject).map((chain: Record<string, any>) => ({
        name: typeof chain.name === 'string' ? chain.name : '',
        chainType: aclEnum(chain.chain_type, ACL_CHAIN_TYPE_CODES, 1),
        description: typeof chain.description === 'string' ? chain.description : '',
        enabled: chain.enabled !== false,
        defaultAction: aclEnum(chain.default_action, ACL_ACTION_CODES, 1),
        rules: Array.isArray(chain.rules) ? chain.rules.filter(isPlainObject).map(parseAclRule) : []
      }))
    : []
  const group = isPlainObject(v1.group) ? v1.group : null
  const declares = Array.isArray(group?.declares)
    ? group.declares.filter(isPlainObject).map((item: Record<string, any>) => ({
        groupName: typeof item.group_name === 'string' ? item.group_name : '',
        groupSecret: typeof item.group_secret === 'string' ? item.group_secret : ''
      }))
    : []
  return {
    enabled: true,
    chains,
    declares,
    members: Array.isArray(group?.members) ? group.members.map(String).join(' ') : ''
  }
}

const buildAclRule = (rule: AclRuleForm): Record<string, any> => {
  const numberOrUndefined = (value: string): number | undefined => {
    const text = value.trim()
    return /^\d+$/.test(text) ? Number(text) : undefined
  }
  // v2.4.5/v2.5.0 的 Rule 没有 serde 默认值：description 与各数组字段必须显式写全。
  // 新版本对空数组/0 同样接受，因此统一写全，避免旧内核启动时缺字段。
  return {
    name: rule.name.trim(),
    description: rule.description.trim(),
    priority: numberOrUndefined(rule.priority) ?? 0,
    enabled: rule.enabled,
    protocol: rule.protocol,
    ports: splitList(rule.ports),
    source_ips: splitList(rule.sourceIps),
    destination_ips: splitList(rule.destinationIps),
    source_ports: splitList(rule.sourcePorts),
    action: rule.action,
    rate_limit: numberOrUndefined(rule.rateLimit) ?? 0,
    burst_limit: numberOrUndefined(rule.burstLimit) ?? 0,
    stateful: rule.stateful,
    source_groups: splitList(rule.sourceGroups),
    destination_groups: splitList(rule.destinationGroups)
  }
}

const buildAclToml = (form: AclForm): Record<string, any> | undefined => {
  if (!form.enabled) return undefined
  const chains = form.chains.map((chain) => ({
    name: chain.name.trim(),
    chain_type: chain.chainType,
    description: chain.description.trim(),
    enabled: chain.enabled,
    default_action: chain.defaultAction,
    // 旧版 Chain.rules 无默认值，空链也必须写出 rules = []
    rules: chain.rules.map(buildAclRule)
  }))
  const declares = form.declares
    .map((item) => ({
      group_name: item.groupName.trim(),
      group_secret: item.groupSecret.trim()
    }))
    .filter((item) => item.group_name && item.group_secret)
  const members = splitList(form.members)
  const group = declares.length || members.length ? { declares, members } : undefined
  return {
    acl_v1: {
      chains,
      ...(group ? { group } : {})
    }
  }
}

/** 数值型 flags：表单输入为字符串，落盘前转数字，避免内核按字符串解析失败 */
const NUMERIC_FLAG_KEYS = new Set([
  'mtu',
  'multi_thread_count',
  'foreign_relay_bps_limit',
  'instance_recv_bps_limit'
])

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** TTL 文本 → 非负整数；空值/非法值返回 undefined（不落盘） */
const parseTtlText = (raw: unknown): number | undefined => {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  if (!text) return undefined
  const value = Number(text)
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

/** 已解析的 [dns] 表 → 表单形态；非法/缺失结构回退空表单 */
const parseDnsForm = (raw: unknown): DnsForm => {
  if (!isPlainObject(raw)) return emptyDnsForm()
  const zones: DnsZoneForm[] = Array.isArray(raw.zone)
    ? raw.zone.filter(isPlainObject).map((zone) => ({
        origin: typeof zone.origin === 'string' ? zone.origin : '',
        ttl: typeof zone.ttl === 'number' || typeof zone.ttl === 'string' ? String(zone.ttl) : '',
        records: Array.isArray(zone.records)
          ? zone.records.filter(isPlainObject).map((record) => ({
              name: typeof record.name === 'string' ? record.name : '',
              type: typeof record.type === 'string' ? record.type : 'A',
              ttl:
                typeof record.ttl === 'number' || typeof record.ttl === 'string'
                  ? String(record.ttl)
                  : '',
              value:
                typeof record.value === 'string'
                  ? record.value
                  : record.value === undefined
                    ? ''
                    : String(record.value)
            }))
          : []
      }))
    : []
  return { domain: typeof raw.domain === 'string' ? raw.domain : '', zones }
}

/** 已解析的 vpn_portal_config → 表单形态；新旧结构共用，按 client_cidr 是否存在区分 */
const parseVpnPortalForm = (raw: unknown): VpnPortalForm => {
  if (!isPlainObject(raw)) return emptyVpnPortalForm()
  const clients = Array.isArray(raw.clients)
    ? raw.clients.filter(isPlainObject).map((client) => ({
        name: typeof client.name === 'string' ? client.name : '',
        virtual_ip: typeof client.virtual_ip === 'string' ? client.virtual_ip : '',
        groups: Array.isArray(client.groups) ? client.groups.map(String).join(' ') : ''
      }))
    : []
  const legacy = 'client_cidr' in raw
  return {
    enabled: legacy ? true : raw.enabled !== false,
    legacy,
    wireguardListen: typeof raw.wireguard_listen === 'string' ? raw.wireguard_listen : '',
    privateKey: typeof raw.wireguard_private_key === 'string' ? raw.wireguard_private_key : '',
    clients,
    legacyClientCidr: typeof raw.client_cidr === 'string' ? raw.client_cidr : ''
  }
}

/** 表单形态 → TOML vpn_portal_config；旧结构（有 client_cidr）优先，空表单不落盘 */
const buildVpnPortalToml = (form: VpnPortalForm): Record<string, any> | undefined => {
  const listen = form.wireguardListen.trim()
  if (form.legacy) {
    if (!form.enabled) return undefined
    return { client_cidr: form.legacyClientCidr.trim(), wireguard_listen: listen }
  }
  const clients = form.clients
    .map((client) => ({
      name: client.name.trim(),
      virtual_ip: client.virtual_ip.trim(),
      groups: client.groups
        .split(/[\s,]+/)
        .map((group) => group.trim())
        .filter(Boolean)
    }))
    .filter((client) => client.name && client.virtual_ip)
  const privateKey = form.privateKey.trim()
  if (!form.enabled && !listen && !privateKey && !clients.length) return undefined
  return {
    enabled: form.enabled,
    wireguard_listen: listen,
    ...(privateKey ? { wireguard_private_key: privateKey } : {}),
    ...(clients.length ? { clients } : {})
  }
}

/** 表单形态 → TOML [dns] 表；无域名且无有效区域时返回 undefined（不落盘空表） */
const buildDnsToml = (form: DnsForm | undefined): Record<string, any> | undefined => {
  const domain = typeof form?.domain === 'string' ? form.domain.trim() : ''
  const zones = (Array.isArray(form?.zones) ? form!.zones : [])
    .map((zone) => {
      const origin = typeof zone.origin === 'string' ? zone.origin.trim() : ''
      // origin 为内核必填：未填写时整段跳过，避免写出会被拒绝的空区域
      if (!origin) return null
      const output: Record<string, any> = { origin }
      const ttl = parseTtlText(zone.ttl)
      if (ttl !== undefined) output.ttl = ttl
      const records = (Array.isArray(zone.records) ? zone.records : [])
        .map((record) => {
          const name = typeof record.name === 'string' ? record.name.trim() : ''
          const type = typeof record.type === 'string' ? record.type.trim() : ''
          const value = typeof record.value === 'string' ? record.value : ''
          // name / type / value 均为内核必填（RDATA 缺失会拒绝启动）：未填完整时跳过该行
          if (!name || !type || !value.trim()) return null
          const item: Record<string, any> = { name, type, value }
          const recordTtl = parseTtlText(record.ttl)
          if (recordTtl !== undefined) item.ttl = recordTtl
          return item
        })
        .filter((record): record is Record<string, any> => record !== null)
      if (records.length) output.records = records
      return output
    })
    .filter((zone): zone is Record<string, any> => zone !== null)
  if (!domain && zones.length === 0) return undefined
  return { ...(domain ? { domain } : {}), ...(zones.length ? { zone: zones } : {}) }
}

/**
 * 由本模块显式建模的顶层键；其余键进入 passthrough 原样保留。
 * 新增表单字段时必须同步此清单，否则会出现「表单一处、透传一处」的双写。
 */
const MODELED_TOP_LEVEL_KEYS = new Set([
  'hostname',
  'instance_name',
  'dhcp',
  'rpc_portal',
  'network_identity',
  'flags',
  'secure_mode',
  'local_private_key',
  'local_public_key',
  'credential_file',
  'socks5_proxy',
  'stun_servers',
  'listeners',
  'peer',
  'proxy_network',
  'routes',
  'exit_nodes',
  'ipv4',
  'mapped_listeners',
  'port_forward',
  'ipv6_public_addr_provider',
  'ipv6_public_addr_auto',
  'ipv6_public_addr_prefix',
  // v2.7.1：Magic DNS 与 DHCPv6（编辑形态分别为 dns / dhcpv6Enabled + dhcpv6Cidr）
  'dns',
  'dhcpv6',
  'vpn_portal_config',
  'acl'
])

/** 空表单模型（字段默认值与 EditDialog 初始状态一致） */
export const emptyFormModel = (): ConfigFormModel => ({
  formData: {
    hostname: '',
    instance_name: '',
    ipv4: '',
    dhcp: true,
    rpc_portal: '',
    ipv6_public_addr_provider: false,
    ipv6_public_addr_auto: false,
    ipv6_public_addr_prefix: '',
    flags: {}
  },
  passthrough: {},
  secretDisplays: {},
  secretBackup: {},
  secureModeEnabled: false,
  stunServers: '',
  listeners: [],
  peers: [],
  peerExtras: [],
  proxies: [],
  proxyExtras: [],
  mappedListeners: [],
  portForwards: [],
  routes: [],
  exitNodes: [],
  flagsKeys: [],
  flagsVals: [],
  networkName: '',
  networkSecret: '',
  dhcpCidr: '',
  dhcpv6Enabled: false,
  dhcpv6Cidr: '',
  dns: emptyDnsForm(),
  vpnPortal: emptyVpnPortalForm(),
  acl: emptyAclForm(),
  lockedFlags: {},
  lockedTopLevel: {}
})

/**
 * TOML 原文 → 表单模型
 * @returns 解析成功返回模型；解析失败返回 null（调用方应保留代码区原样，禁止反向回写）
 */
export const parseConfigFormModel = (content: string): ConfigFormModel | null => {
  try {
    const parsed = toml.parse(content) as any
    // 旧版 LightTier 私有标记迁移到 [lighttier]，避免暴露为可编辑的自定义 Flag
    migrateLightTierConfig(parsed)
    const model = emptyFormModel()
    // v2.7.1 起 dhcp 可为布尔或 IPv4 CIDR 字符串：字符串视为“已启用 + 指定网段”
    const dhcpRaw = parsed.dhcp
    model.formData = {
      hostname: parsed.hostname || '',
      instance_name: parsed.instance_name || '',
      ipv4: typeof parsed.ipv4 === 'string' ? parsed.ipv4 : '',
      dhcp: typeof dhcpRaw === 'boolean' ? dhcpRaw : true,
      rpc_portal: parsed.rpc_portal || '',
      network_identity: parsed.network_identity || {},
      flags: { ...(parsed.flags || {}) },
      ipv6_public_addr_provider: parsed.ipv6_public_addr_provider === true,
      ipv6_public_addr_auto: parsed.ipv6_public_addr_auto === true,
      ipv6_public_addr_prefix: parsed.ipv6_public_addr_prefix || ''
    }
    model.dhcpCidr = typeof dhcpRaw === 'string' ? dhcpRaw : ''
    // v2.7.1 顶层 dhcpv6：布尔或 IPv6 CIDR 字符串
    const dhcpv6Raw = parsed.dhcpv6
    model.dhcpv6Enabled = dhcpv6Raw === true || typeof dhcpv6Raw === 'string'
    model.dhcpv6Cidr = typeof dhcpv6Raw === 'string' ? dhcpv6Raw : ''
    model.dns = parseDnsForm(parsed.dns)
    model.vpnPortal = parseVpnPortalForm(parsed.vpn_portal_config)
    model.acl = parseAclForm(parsed.acl)
    // 未建模的顶层键与表原样透传：[lighttier]、vpn_portal_config、
    // port_forward、source、managed_credentials 等，避免表单保存时丢数据
    Object.entries(parsed).forEach(([key, value]) => {
      if (!MODELED_TOP_LEVEL_KEYS.has(key)) model.passthrough[key] = value
    })
    // 安全模式：[secure_mode] 表为准；兼容旧版顶层密钥 + flags.secure_mode 开关
    const secureTable =
      parsed.secure_mode &&
      typeof parsed.secure_mode === 'object' &&
      !Array.isArray(parsed.secure_mode)
        ? parsed.secure_mode
        : undefined
    const flags = model.formData.flags as Record<string, any>
    const legacyEnabled = flags.secure_mode === true
    delete flags.secure_mode
    model.secureModeEnabled = secureTable ? secureTable.enabled === true : legacyEnabled
    const privateKey = secureTable?.local_private_key ?? parsed.local_private_key
    const publicKey = secureTable?.local_public_key ?? parsed.local_public_key
    if (privateKey !== undefined && privateKey !== null && privateKey !== '') {
      model.secretBackup.local_private_key = String(privateKey)
      model.secretDisplays.local_private_key = SECRET_MASK
    } else {
      model.secretDisplays.local_private_key = ''
    }
    if (publicKey !== undefined && publicKey !== null) {
      model.formData.local_public_key = publicKey
    }
    if (parsed.credential_file !== undefined && parsed.credential_file !== null) {
      model.formData.credential_file = parsed.credential_file
    }
    // 顶层文本（socks5_proxy / stun_servers 逗号分隔）
    model.formData.socks5_proxy = parsed.socks5_proxy || ''
    model.stunServers = Array.isArray(parsed.stun_servers) ? parsed.stun_servers.join(', ') : ''
    model.networkName = parsed.network_identity?.network_name || ''
    model.networkSecret = parsed.network_identity?.network_secret || ''
    model.listeners = parsed.listeners ? [...parsed.listeners] : []
    model.peers = parsed.peer ? parsed.peer.map((p: any) => p.uri) : []
    // 保留 peer 条目中表单未建模的字段（peer_public_key 等），避免表单保存丢数据
    model.peerExtras = parsed.peer
      ? parsed.peer.map((p: any) => {
          const { uri: _uri, ...rest } = p
          return rest
        })
      : []
    const parsedProxies: any[] = Array.isArray(parsed.proxy_network) ? parsed.proxy_network : []
    model.proxies = parsedProxies.map((n: any) =>
      n?.mapped_cidr ? `${n.cidr}->${n.mapped_cidr}` : String(n?.cidr ?? '')
    )
    // 保留 allow 等表单未建模字段，避免表单保存丢数据
    model.proxyExtras = parsedProxies.map((n: any) => {
      const { cidr: _cidr, mapped_cidr: _mapped, ...rest } = n || {}
      return rest
    })
    const mappedListeners = Array.isArray(parsed.mapped_listeners) ? parsed.mapped_listeners : []
    model.mappedListeners = mappedListeners.map((uri: unknown) => String(uri ?? ''))
    const portForwards = Array.isArray(parsed.port_forward) ? parsed.port_forward : []
    model.portForwards = portForwards.filter(isPlainObject).map((row: any) => ({
      ...row,
      proto: typeof row.proto === 'string' && row.proto ? row.proto : 'tcp',
      bind_addr: typeof row.bind_addr === 'string' ? row.bind_addr : '',
      dst_addr: typeof row.dst_addr === 'string' ? row.dst_addr : ''
    }))
    model.routes = parsed.routes ? [...parsed.routes] : []
    model.exitNodes = parsed.exit_nodes ? [...parsed.exit_nodes] : []
    // 动态 Flags 编辑器排除固定高级字段与已迁移的 secure_mode（避免同 key 双处编辑）
    const dynamicKeys = Object.keys(flags).filter((k) => !ADVANCED_FIELD_KEYS.includes(k))
    model.flagsKeys = dynamicKeys
    model.flagsVals = dynamicKeys.map((k) => String(flags[k]))
    return model
  } catch {
    return null
  }
}

/**
 * 表单模型 → TOML 文本
 * 空值剔除、安全字段按掩码规则写回、flags 类型推断（bool/number/string）
 * @returns toml 文本 + 构建过程中更新过的 secretBackup（调用方需同步回写状态）
 */
export const buildConfigFormModel = (
  model: ConfigFormModel
): { toml: string; secretBackup: Record<string, string> } => {
  // 未建模字段先铺底，再由表单建模字段覆盖；保证表单保存不丢 [lighttier]/vpn_portal_config 等
  const data: Record<string, any> = { ...model.passthrough, ...model.formData }
  const secretBackup: Record<string, string> = { ...model.secretBackup }
  // 清理旧版平铺安全字段与已废弃的 credential（CLI-only，TOML 中会被内核丢弃）
  delete data.local_private_key
  delete data.local_public_key
  delete data.credential
  delete data.credential_file
  delete data.secure_mode
  // 敏感字段（掩码字段：未改动写回原值，改动用新值，清空则删除）
  SECURITY_FIELD_DEFS.forEach((f) => {
    if (!f.secret) return
    const display = model.secretDisplays[f.key] || ''
    if (display === SECRET_MASK) {
      const real = secretBackup[f.key]
      if (real) data[f.key] = real
      else delete data[f.key]
    } else if (display.trim()) {
      data[f.key] = display.trim()
      secretBackup[f.key] = display.trim()
    } else {
      delete data[f.key]
      delete secretBackup[f.key]
    }
  })
  const privateKey = typeof data.local_private_key === 'string' ? data.local_private_key : ''
  delete data.local_private_key
  const publicKey =
    typeof model.formData.local_public_key === 'string'
      ? model.formData.local_public_key.trim()
      : ''
  const credentialFile =
    typeof model.formData.credential_file === 'string' ? model.formData.credential_file.trim() : ''
  // 安全模式仅在开启时落盘；关闭时不写 [secure_mode] 表与 credential_file
  if (model.secureModeEnabled) {
    data.secure_mode = {
      enabled: true,
      ...(privateKey ? { local_private_key: privateKey } : {}),
      ...(publicKey ? { local_public_key: publicKey } : {})
    }
    if (credentialFile) data.credential_file = credentialFile
  } else {
    delete secretBackup.local_private_key
  }
  // 顶层文本（stun_servers 逗号分隔 → 数组）
  if (model.stunServers.trim()) {
    data.stun_servers = model.stunServers
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } else {
    delete data.stun_servers
  }
  // 公网 IPv6（v2.6.2+ 顶层字段；false/空值不落盘，保持配置简洁）
  if (model.formData.ipv6_public_addr_provider === true) {
    data.ipv6_public_addr_provider = true
  } else {
    delete data.ipv6_public_addr_provider
  }
  if (model.formData.ipv6_public_addr_auto === true) {
    data.ipv6_public_addr_auto = true
  } else {
    delete data.ipv6_public_addr_auto
  }
  const ipv6Prefix =
    typeof model.formData.ipv6_public_addr_prefix === 'string'
      ? model.formData.ipv6_public_addr_prefix.trim()
      : ''
  if (ipv6Prefix) data.ipv6_public_addr_prefix = ipv6Prefix
  else delete data.ipv6_public_addr_prefix
  // DHCP（v2.7.1+ 支持网段写法）：有关闭开关时写 false；填写网段时写 CIDR 字符串；
  // 否则沿用布尔 true（现有行为：默认写出 dhcp = true）
  const dhcpCidr = typeof model.dhcpCidr === 'string' ? model.dhcpCidr.trim() : ''
  if (model.formData.dhcp === false) data.dhcp = false
  else data.dhcp = dhcpCidr || true
  // DHCPv6（v2.7.1+ 顶层字段）：开启时写 true 或 IPv6 网段；关闭时不落盘
  if (model.dhcpv6Enabled === true) {
    const dhcpv6Cidr = typeof model.dhcpv6Cidr === 'string' ? model.dhcpv6Cidr.trim() : ''
    data.dhcpv6 = dhcpv6Cidr || true
  } else {
    delete data.dhcpv6
  }
  // Magic DNS（v2.7.1+ 顶层 [dns] 表）：无域名且无有效区域时不落盘
  const dnsToml = buildDnsToml(model.dns)
  if (dnsToml) data.dns = dnsToml
  else delete data.dns
  const vpnPortal = buildVpnPortalToml(model.vpnPortal)
  if (vpnPortal) data.vpn_portal_config = vpnPortal
  else delete data.vpn_portal_config
  const acl = buildAclToml(model.acl)
  if (acl) data.acl = acl
  else delete data.acl
  const ipv4 = typeof model.formData.ipv4 === 'string' ? model.formData.ipv4.trim() : ''
  if (ipv4) data.ipv4 = ipv4
  else delete data.ipv4
  // rpc_portal：空值不落盘。该字段自 v2.5.0 起已从配置移除（改走 CLI），
  // 新增配置默认不展示它，不能因表单空值写出一个被内核忽略的字段
  const rpcPortal = typeof data.rpc_portal === 'string' ? data.rpc_portal.trim() : ''
  if (rpcPortal) data.rpc_portal = rpcPortal
  else delete data.rpc_portal
  // network_name 为内核必填：为空时不写空表（否则 [network_identity] 缺字段导致解析失败）
  if (model.networkName.trim()) {
    data.network_identity = {
      network_name: model.networkName,
      ...(model.networkSecret ? { network_secret: model.networkSecret } : {})
    }
  } else {
    delete data.network_identity
  }
  if (model.listeners.length) data.listeners = model.listeners.filter(Boolean)
  else delete data.listeners
  if (model.peers.length) {
    data.peer = model.peers
      .map((uri, i) => ({ ...(model.peerExtras[i] || {}), uri }))
      .filter((p) => p.uri)
  } else {
    delete data.peer
  }
  if (model.routes.length) data.routes = model.routes.filter(Boolean)
  else delete data.routes
  const proxies = model.proxies
    .map((row, i) => {
      const [cidr = '', mapped] = row.split('->').map((part) => part.trim())
      const entry: Record<string, any> = { ...(model.proxyExtras[i] || {}), cidr }
      if (mapped) entry.mapped_cidr = mapped
      else delete entry.mapped_cidr
      return entry
    })
    .filter((entry) => entry.cidr)
  if (proxies.length) data.proxy_network = proxies
  else delete data.proxy_network
  if (model.exitNodes.length) data.exit_nodes = model.exitNodes.filter(Boolean)
  else delete data.exit_nodes
  const mappedListeners = model.mappedListeners.map((uri) => uri.trim()).filter(Boolean)
  if (mappedListeners.length) data.mapped_listeners = mappedListeners
  else delete data.mapped_listeners
  const portForwards = model.portForwards
    .map((row) => ({
      ...row,
      proto: String(row.proto || 'tcp').trim() || 'tcp',
      bind_addr: String(row.bind_addr || '').trim(),
      dst_addr: String(row.dst_addr || '').trim()
    }))
    .filter((row) => row.bind_addr && row.dst_addr)
  if (portForwards.length) data.port_forward = portForwards
  else delete data.port_forward
  const flags: Record<string, any> = {}
  // 固定高级字段（undefined/空值剔除，避免产生无意义字段）
  Object.entries(model.formData.flags || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (k === 'secure_mode') return // 旧版写法：内核会静默丢弃，统一改写为 [secure_mode] 表
    if (NUMERIC_FLAG_KEYS.has(k) && typeof v === 'string' && /^\d+$/.test(v.trim())) {
      flags[k] = Number(v.trim())
      return
    }
    flags[k] = v
  })
  model.flagsKeys.forEach((k, i) => {
    if (!k.trim() || k === 'secure_mode') return
    // 固定高级字段由开关/输入框单一来源写入，避免自定义行重复覆盖
    if (ADVANCED_FIELD_KEYS.includes(k)) return
    const raw = model.flagsVals[i]
    if (raw === '' || raw === undefined || raw === null) flags[k] = true
    else if (raw === 'true') flags[k] = true
    else if (raw === 'false') flags[k] = false
    else if (/^-?\d+(\.\d+)?$/.test(raw)) flags[k] = Number(raw)
    else flags[k] = raw
  })
  // 当前内核不支持的 flags：最后写入，保证表单编辑不会修改其值
  Object.assign(flags, model.lockedFlags || {})
  if (Object.keys(flags).length) data.flags = flags
  else delete data.flags
  // 当前内核不支持的顶层字段：最后覆盖，保持配置文件原值（含显式 false/空结构）
  Object.assign(data, model.lockedTopLevel || {})
  return { toml: toml.stringify(data), secretBackup }
}
