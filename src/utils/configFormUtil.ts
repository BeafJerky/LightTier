/**
 * 配置表单 ⇄ TOML 互转（EditDialog 结构化表单模式的核心，纯函数便于单测）
 *
 * 规则与 EditDialog 保持一致：
 * - 文本字段空值剔除；network_identity/listeners/peer/routes/exit_nodes/flags 按需落盘
 * - 安全模式敏感字段（SECURITY_FIELD_DEFS 中 secret: true）以掩码回显：
 *   parsed[适配] → secretBackup 备份真实值、secretDisplays 显示 SECRET_MASK；
 *   构建时未改动写回备份原值，改动用新值，清空则删除
 * - 自定义 Flags 与固定高级字段分离，避免同 key 双处编辑
 */
import * as toml from 'smol-toml'
import { ADVANCED_FIELD_KEYS, SECRET_MASK, SECURITY_FIELD_DEFS } from '@/constants/defaultData'

/** 表单模型（与 EditDialog 内各 ref 一一对应，均为可序列化的纯数据） */
export interface ConfigFormModel {
  /** 顶层非密字段（hostname/instance_name/dhcp/rpc_portal/socks5_proxy/flags 及非密安全字段） */
  formData: Record<string, any>
  /** 敏感字段的输入框显示值（掩码 SECRET_MASK / 用户新输入 / 空） */
  secretDisplays: Record<string, string>
  /** 敏感字段真实值备份（掩码未被修改时写回该值） */
  secretBackup: Record<string, string>
  /** stun_servers 逗号分隔文本 */
  stunServers: string
  listeners: string[]
  peers: string[]
  routes: string[]
  exitNodes: string[]
  flagsKeys: string[]
  flagsVals: string[]
  networkName: string
  networkSecret: string
}

/** 空表单模型（字段默认值与 EditDialog 初始状态一致） */
export const emptyFormModel = (): ConfigFormModel => ({
  formData: {
    hostname: '',
    instance_name: '',
    dhcp: true,
    rpc_portal: '',
    flags: {}
  },
  secretDisplays: {},
  secretBackup: {},
  stunServers: '',
  listeners: [],
  peers: [],
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
    const model = emptyFormModel()
    model.formData = {
      hostname: parsed.hostname || '',
      instance_name: parsed.instance_name || '',
      dhcp: parsed.dhcp !== undefined ? parsed.dhcp : true,
      rpc_portal: parsed.rpc_portal || '',
      network_identity: parsed.network_identity || {},
      flags: { ...(parsed.flags || {}) }
    }
    // 安全模式顶层字段（掩码字段备份真实值，显示掩码）
    SECURITY_FIELD_DEFS.forEach((f) => {
      const v = parsed[f.key]
      if (f.secret) {
        if (v !== undefined && v !== null && v !== '') {
          model.secretBackup[f.key] = String(v)
          model.secretDisplays[f.key] = SECRET_MASK
        } else {
          model.secretDisplays[f.key] = ''
        }
      } else if (v !== undefined && v !== null) {
        model.formData[f.key] = v
      }
    })
    // 顶层文本（socks5_proxy / stun_servers 逗号分隔）
    model.formData.socks5_proxy = parsed.socks5_proxy || ''
    model.stunServers = Array.isArray(parsed.stun_servers) ? parsed.stun_servers.join(', ') : ''
    model.networkName = parsed.network_identity?.network_name || ''
    model.networkSecret = parsed.network_identity?.network_secret || ''
    model.listeners = parsed.listeners ? [...parsed.listeners] : []
    model.peers = parsed.peer ? parsed.peer.map((p: any) => p.uri) : []
    model.routes = parsed.routes ? [...parsed.routes] : []
    model.exitNodes = parsed.exit_nodes ? [...parsed.exit_nodes] : []
    // 动态 Flags 编辑器排除固定高级字段（避免同 key 双处编辑）
    const flags = parsed.flags || {}
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
  const data: Record<string, any> = { ...model.formData }
  const secretBackup: Record<string, string> = { ...model.secretBackup }
  // 安全模式顶层字段（掩码字段：未改动写回原值，改动用新值，清空则删除）
  SECURITY_FIELD_DEFS.forEach((f) => {
    if (f.secret) {
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
    } else if (model.formData[f.key] === undefined || model.formData[f.key] === '') {
      delete data[f.key]
    }
  })
  // 顶层文本（stun_servers 逗号分隔 → 数组）
  if (model.stunServers.trim()) {
    data.stun_servers = model.stunServers
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } else {
    delete data.stun_servers
  }
  data.network_identity = {
    network_name: model.networkName || undefined,
    network_secret: model.networkSecret || undefined
  }
  if (model.listeners.length) data.listeners = model.listeners.filter(Boolean)
  else delete data.listeners
  if (model.peers.length) data.peer = model.peers.filter(Boolean).map((uri) => ({ uri }))
  else delete data.peer
  if (model.routes.length) data.routes = model.routes.filter(Boolean)
  else delete data.routes
  if (model.exitNodes.length) data.exit_nodes = model.exitNodes.filter(Boolean)
  else delete data.exit_nodes
  const flags: Record<string, any> = {}
  // 固定高级字段（undefined/空值剔除，避免产生无意义字段）
  Object.entries(model.formData.flags || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    flags[k] = v
  })
  model.flagsKeys.forEach((k, i) => {
    if (!k.trim()) return
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
