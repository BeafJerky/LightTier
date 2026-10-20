/**
 * 配置表单 ⇄ TOML 互转（EditDialog 结构化表单模式的核心，纯函数便于单测）
 *
 * 规则与 EditDialog 保持一致：
 * - 文本字段空值剔除；network_identity/listeners/peer/routes/exit_nodes/flags 按需落盘
 * - 安全模式按 EasyTier Core v2.6.4 规范映射：
 *   [secure_mode] { enabled, local_private_key, local_public_key }，credential_file 为顶层字段；
 *   旧版写在顶层/flags 的密钥在解析时迁移，保存时统一改写为 [secure_mode] 表
 * - 安全模式敏感字段（SECURITY_FIELD_DEFS 中 secret: true）以掩码回显：
 *   真实值进 secretBackup、显示 SECRET_MASK；构建时未改动写回备份原值，
 *   改动用新值，清空则删除。安全模式关闭时不落盘任何安全字段
 * - 自定义 Flags 与固定高级字段分离，避免同 key 双处编辑
 */
import * as toml from 'smol-toml'
import { ADVANCED_FIELD_KEYS, SECRET_MASK, SECURITY_FIELD_DEFS } from '@/constants/defaultData'
import { migrateLightTierConfig } from '@/utils/lighttierConfigUtil'

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
  routes: string[]
  exitNodes: string[]
  flagsKeys: string[]
  flagsVals: string[]
  networkName: string
  networkSecret: string
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
  'routes',
  'exit_nodes',
  'ipv6_public_addr_provider',
  'ipv6_public_addr_auto',
  'ipv6_public_addr_prefix'
])

/** 空表单模型（字段默认值与 EditDialog 初始状态一致） */
export const emptyFormModel = (): ConfigFormModel => ({
  formData: {
    hostname: '',
    instance_name: '',
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
  routes: [],
  exitNodes: [],
  flagsKeys: [],
  flagsVals: [],
  networkName: '',
  networkSecret: ''
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
    model.formData = {
      hostname: parsed.hostname || '',
      instance_name: parsed.instance_name || '',
      dhcp: parsed.dhcp !== undefined ? parsed.dhcp : true,
      rpc_portal: parsed.rpc_portal || '',
      network_identity: parsed.network_identity || {},
      flags: { ...(parsed.flags || {}) },
      ipv6_public_addr_provider: parsed.ipv6_public_addr_provider === true,
      ipv6_public_addr_auto: parsed.ipv6_public_addr_auto === true,
      ipv6_public_addr_prefix: parsed.ipv6_public_addr_prefix || ''
    }
    // 未建模的顶层键与表原样透传：[lighttier]、vpn_portal_config、proxy_network、
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
  if (model.exitNodes.length) data.exit_nodes = model.exitNodes.filter(Boolean)
  else delete data.exit_nodes
  const flags: Record<string, any> = {}
  // 固定高级字段（undefined/空值剔除，避免产生无意义字段）
  Object.entries(model.formData.flags || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (k === 'secure_mode') return // 旧版写法：内核会静默丢弃，统一改写为 [secure_mode] 表
    flags[k] = v
  })
  model.flagsKeys.forEach((k, i) => {
    if (!k.trim() || k === 'secure_mode') return
    const raw = model.flagsVals[i]
    if (raw === '' || raw === undefined || raw === null) flags[k] = true
    else if (raw === 'true') flags[k] = true
    else if (raw === 'false') flags[k] = false
    else if (/^-?\d+(\.\d+)?$/.test(raw)) flags[k] = Number(raw)
    else flags[k] = raw
  })
  if (Object.keys(flags).length) data.flags = flags
  else delete data.flags
  return { toml: toml.stringify(data), secretBackup }
}
