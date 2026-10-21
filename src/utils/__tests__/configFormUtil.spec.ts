/**
 * configFormUtil 单测：TOML ⇄ 表单模型互转
 * 覆盖 5.6 敏感字段掩码回显，以及 v2.6.4 [secure_mode] 表映射与旧版平铺字段迁移
 */
import { describe, it, expect } from 'vitest'
import * as toml from 'smol-toml'
import { SECRET_MASK } from '@/constants/defaultData'
import {
  buildConfigFormModel,
  emptyFormModel,
  parseConfigFormModel,
  type ConfigFormModel
} from '@/utils/configFormUtil'

// 解析 → 构建 → 再解析（模拟“表单改完切代码再保存”路径）
const roundTrip = (content: string, mutate?: (m: ConfigFormModel) => void): Record<string, any> => {
  const model = parseConfigFormModel(content)
  expect(model).not.toBeNull()
  if (mutate) mutate(model!)
  const { toml: built } = buildConfigFormModel(model!)
  return toml.parse(built) as Record<string, any>
}

describe('configFormUtil', () => {
  it('emptyFormModel 返回默认值（dhcp 开、安全模式关、flags 空对象）', () => {
    const m = emptyFormModel()
    expect(m.formData.dhcp).toBe(true)
    expect(m.formData.flags).toEqual({})
    expect(m.secureModeEnabled).toBe(false)
    expect(m.listeners).toEqual([])
    expect(m.secretDisplays).toEqual({})
  })

  it('非法 TOML 返回 null（调用方保留代码区原样）', () => {
    expect(parseConfigFormModel('hostname = [unclosed')).toBeNull()
  })

  it('解析基本字段：hostname/instance_name/dhcp/rpc_portal/network_identity', () => {
    const content = [
      'hostname = "node-a"',
      'instance_name = "inst"',
      'dhcp = false',
      'rpc_portal = "0.0.0.0:15888"',
      '[network_identity]',
      'network_name = "net1"',
      'network_secret = "sec1"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.formData.hostname).toBe('node-a')
    expect(m.formData.instance_name).toBe('inst')
    expect(m.formData.dhcp).toBe(false)
    expect(m.formData.rpc_portal).toBe('0.0.0.0:15888')
    expect(m.networkName).toBe('net1')
    expect(m.networkSecret).toBe('sec1')
  })

  it('解析列表字段：listeners / peer / routes / exit_nodes / stun_servers', () => {
    const content = [
      'listeners = ["tcp://0.0.0.0:11000"]',
      'routes = ["10.0.0.0/8"]',
      'exit_nodes = ["10.0.0.1/24"]',
      'stun_servers = ["stun1.example.com", "stun2.example.com"]',
      '[[peer]]',
      'uri = "tcp://host:11010"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.listeners).toEqual(['tcp://0.0.0.0:11000'])
    expect(m.peers).toEqual(['tcp://host:11010'])
    expect(m.routes).toEqual(['10.0.0.0/8'])
    expect(m.exitNodes).toEqual(['10.0.0.1/24'])
    expect(m.stunServers).toBe('stun1.example.com, stun2.example.com')
  })

  it('peer 额外字段（peer_public_key，v2.6.0+）表单往返不丢失', () => {
    const content = [
      '[[peer]]',
      'uri = "tcp://a:11010"',
      'peer_public_key = "PK"',
      '[[peer]]',
      'uri = "tcp://b:11010"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.peerExtras).toEqual([{ peer_public_key: 'PK' }, {}])
    const { toml: built } = buildConfigFormModel(m)
    const parsed = toml.parse(built) as any
    expect(parsed.peer).toEqual([
      { uri: 'tcp://a:11010', peer_public_key: 'PK' },
      { uri: 'tcp://b:11010' }
    ])
  })

  it('解析 [secure_mode] 表：开启开关、私钥掩码回显、公钥/凭据文件进表单', () => {
    const content = [
      'credential_file = "/tmp/cred"',
      '[secure_mode]',
      'enabled = true',
      'local_private_key = "REAL_KEY"',
      'local_public_key = "PUB"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.secureModeEnabled).toBe(true)
    expect(m.secretDisplays.local_private_key).toBe(SECRET_MASK)
    expect(m.secretBackup.local_private_key).toBe('REAL_KEY')
    // 敏感值不进入 formData（避免意外渲染/序列化）
    expect(m.formData.local_private_key).toBeUndefined()
    expect(m.formData.local_public_key).toBe('PUB')
    expect(m.formData.credential_file).toBe('/tmp/cred')
  })

  it('掩码未改动时保存写回原值（表单→代码→落盘不丢密钥）', () => {
    const content = ['[secure_mode]', 'enabled = true', 'local_private_key = "REAL_KEY"'].join('\n')
    const parsed = roundTrip(content)
    expect(parsed.secure_mode).toMatchObject({ enabled: true, local_private_key: 'REAL_KEY' })
  })

  it('掩码被替换为新值时保存写入新值', () => {
    const content = ['[secure_mode]', 'enabled = true', 'local_private_key = "REAL_KEY"'].join('\n')
    const parsed = roundTrip(content, (m) => {
      m.secretDisplays.local_private_key = 'NEW_KEY'
    })
    expect(parsed.secure_mode.local_private_key).toBe('NEW_KEY')
  })

  it('掩码被清空时保存移除私钥但保留安全模式开关', () => {
    const content = [
      'hostname = "h"',
      '[secure_mode]',
      'enabled = true',
      'local_private_key = "REAL_KEY"'
    ].join('\n')
    const parsed = roundTrip(content, (m) => {
      m.secretDisplays.local_private_key = ''
    })
    expect(parsed.secure_mode).toEqual({ enabled: true })
    expect(parsed.hostname).toBe('h')
  })

  it('新输入的敏感值经构建后进入 secretBackup（二次构建不丢）', () => {
    const model = parseConfigFormModel('hostname = "h"')!
    model.secureModeEnabled = true
    model.secretDisplays.local_private_key = 'fresh-value'
    const first = buildConfigFormModel(model)
    expect(toml.parse(first.toml)).toMatchObject({
      secure_mode: { enabled: true, local_private_key: 'fresh-value' }
    })
    expect(first.secretBackup.local_private_key).toBe('fresh-value')
    // 二次构建（显示值仍为明文）同样写回
    model.secretBackup = first.secretBackup
    const second = buildConfigFormModel(model)
    expect(toml.parse(second.toml)).toMatchObject({
      secure_mode: { enabled: true, local_private_key: 'fresh-value' }
    })
  })

  it('旧版平铺字段迁移：[flags].secure_mode + 顶层密钥改写为 [secure_mode] 表', () => {
    const content = [
      'local_private_key = "K"',
      'local_public_key = "P"',
      'credential = "CLI_ONLY"',
      'credential_file = "/tmp/cred"',
      '[flags]',
      'secure_mode = true',
      'latency_first = true'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.secureModeEnabled).toBe(true)
    // secure_mode 已迁移，不再作为自定义 Flag 编辑
    expect(m.flagsKeys).not.toContain('secure_mode')
    // latency_first 已升级为高级开关，不再出现在自定义 Flags 行
    expect(m.flagsKeys).not.toContain('latency_first')
    expect((m.formData.flags as any).latency_first).toBe(true)
    const parsed = roundTrip(content)
    expect(parsed.secure_mode).toMatchObject({
      enabled: true,
      local_private_key: 'K',
      local_public_key: 'P'
    })
    // credential 是 CLI-only，TOML 中不落盘
    expect(parsed.credential).toBeUndefined()
    expect(parsed.flags?.secure_mode).toBeUndefined()
    expect(parsed.credential_file).toBe('/tmp/cred')
  })

  it('仅有旧版顶层密钥而无开关时不启用安全模式，保存时清理无效字段', () => {
    const content = 'local_private_key = "K"\nlocal_public_key = "P"'
    const m = parseConfigFormModel(content)!
    expect(m.secureModeEnabled).toBe(false)
    const { toml: built } = buildConfigFormModel(m)
    const parsed = toml.parse(built) as any
    expect(parsed.secure_mode).toBeUndefined()
    expect(parsed.local_private_key).toBeUndefined()
    expect(parsed.local_public_key).toBeUndefined()
  })

  it('安全模式关闭时不落盘 [secure_mode] 与 credential_file', () => {
    const content = [
      'credential_file = "/tmp/cred"',
      '[secure_mode]',
      'enabled = false',
      'local_private_key = "K"'
    ].join('\n')
    const parsed = roundTrip(content)
    expect(parsed.secure_mode).toBeUndefined()
    expect(parsed.credential_file).toBeUndefined()
  })

  it('[lighttier] 私有段原样保留：表单模式保存不丢失', () => {
    const content = ['hostname = "h"', '[lighttier]', 'exit_route_enabled = true'].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.passthrough.lighttier).toEqual({ exit_route_enabled: true })
    const parsed = roundTrip(content)
    expect(parsed.lighttier).toEqual({ exit_route_enabled: true })
  })

  it('未建模的表/字段透传：vpn_portal_config / proxy_network / managed_credentials', () => {
    const content = [
      'hostname = "h"',
      '[[managed_credentials]]',
      'name = "cred"',
      '[[proxy_network]]',
      'cidr = "10.0.0.0/24"',
      '[vpn_portal_config]',
      'enabled = true',
      'wireguard_listen = "0.0.0.0:11013"',
      '[[vpn_portal_config.clients]]',
      'name = "phone"',
      'virtual_ip = "10.14.14.2"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.passthrough.vpn_portal_config).toMatchObject({
      enabled: true,
      wireguard_listen: '0.0.0.0:11013'
    })
    const parsed = roundTrip(content)
    expect(parsed.vpn_portal_config).toMatchObject({
      enabled: true,
      wireguard_listen: '0.0.0.0:11013',
      clients: [{ name: 'phone', virtual_ip: '10.14.14.2' }]
    })
    expect(parsed.managed_credentials).toEqual([{ name: 'cred' }])
    expect(parsed.proxy_network).toEqual([{ cidr: '10.0.0.0/24' }])
  })

  it('公网 IPv6 顶层字段（v2.6.2+）解析与写回', () => {
    const content = [
      'ipv6_public_addr_provider = true',
      'ipv6_public_addr_auto = true',
      'ipv6_public_addr_prefix = "2001:db8::/48"'
    ].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.formData.ipv6_public_addr_provider).toBe(true)
    expect(m.formData.ipv6_public_addr_auto).toBe(true)
    expect(m.formData.ipv6_public_addr_prefix).toBe('2001:db8::/48')
    const parsed = roundTrip(content)
    expect(parsed.ipv6_public_addr_provider).toBe(true)
    expect(parsed.ipv6_public_addr_auto).toBe(true)
    expect(parsed.ipv6_public_addr_prefix).toBe('2001:db8::/48')
  })

  it('旧版 flags._enable_exit_route 迁移到 [lighttier]，不再作为自定义 Flag 暴露', () => {
    const content = ['[flags]', '_enable_exit_route = true', 'latency_first = true'].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.flagsKeys).not.toContain('_enable_exit_route')
    expect(m.flagsKeys).not.toContain('latency_first')
    expect((m.formData.flags as any).latency_first).toBe(true)
    const parsed = roundTrip(content)
    expect(parsed.lighttier).toEqual({ exit_route_enabled: true })
    expect(parsed.flags?._enable_exit_route).toBeUndefined()
    expect(parsed.flags?.latency_first).toBe(true)
  })

  it('旧版顶层 config_exit_nodes_route 迁移到 [lighttier]', () => {
    const content = ['hostname = "h"', 'config_exit_nodes_route = true'].join('\n')
    const parsed = roundTrip(content)
    expect(parsed.lighttier).toEqual({ exit_route_enabled: true })
    expect('config_exit_nodes_route' in parsed).toBe(false)
    expect(parsed.hostname).toBe('h')
  })

  it('flags 类型推断：true/false/整数/小数/字符串/空值默认 true', () => {
    const model = emptyFormModel()
    model.flagsKeys = [
      'flag_bool',
      'flag_false',
      'flag_int',
      'flag_float',
      'flag_str',
      'flag_empty'
    ]
    model.flagsVals = ['true', 'false', '42', '3.14', 'hello', '']
    const { toml: built } = buildConfigFormModel(model)
    const parsed = toml.parse(built) as any
    expect(parsed.flags).toEqual({
      flag_bool: true,
      flag_false: false,
      flag_int: 42,
      flag_float: 3.14,
      flag_str: 'hello',
      flag_empty: true
    })
  })

  it('空值剔除：空的 listeners/network_identity/stun_servers 不落盘', () => {
    const model = emptyFormModel()
    const { toml: built } = buildConfigFormModel(model)
    const parsed = toml.parse(built) as any
    expect(parsed.listeners).toBeUndefined()
    expect(parsed.stun_servers).toBeUndefined()
    expect(parsed.routes).toBeUndefined()
    // rpc_portal 自 v2.5.0 起移除，表单空值不应写出该字段
    expect(parsed.rpc_portal).toBeUndefined()
    // network_identity 的 network_name 为内核必填：空值应整表剔除，避免写出缺字段的空表
    expect(parsed.network_identity).toBeUndefined()
  })

  it('仅有 network_secret 时不写 [network_identity]（network_name 必填，缺表头字段会被内核拒绝）', () => {
    const model = emptyFormModel()
    model.networkSecret = 'sec-only'
    const { toml: built } = buildConfigFormModel(model)
    const parsed = toml.parse(built) as any
    expect(parsed.network_identity).toBeUndefined()
  })

  it('动态 flags 解析时排除固定高级字段（避免同 key 双处编辑）', () => {
    const content = ['[flags]', 'disable_quic_input = true', 'my_custom_flag = "v"'].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.flagsKeys).toContain('my_custom_flag')
    expect(m.flagsKeys).not.toContain('disable_quic_input')
    // 固定字段在 formData.flags 中保留
    expect((m.formData.flags as any).disable_quic_input).toBe(true)
  })

  it('lockedFlags / lockedTopLevel 最后写入：覆盖同名字段并保留显式 false', () => {
    const model = emptyFormModel()
    // 模拟 EditDialog 将未兼容项从表单剔除后交给构建
    model.formData.flags = { bind_device: false }
    model.lockedFlags = { bind_device: true, prefer_peer_relay: false, future_flag: 'v' }
    model.lockedTopLevel = {
      secure_mode: { enabled: true, local_public_key: 'PUB' },
      tcp_stun_servers: ['stun.example.com'],
      source: ''
    }
    const { toml: built } = buildConfigFormModel(model)
    const parsed = toml.parse(built) as any
    expect(parsed.flags.bind_device).toBe(true)
    expect(parsed.flags.prefer_peer_relay).toBe(false)
    expect(parsed.flags.future_flag).toBe('v')
    expect(parsed.secure_mode).toEqual({ enabled: true, local_public_key: 'PUB' })
    expect(parsed.tcp_stun_servers).toEqual(['stun.example.com'])
    // 原值为空字符串也不因表单清洗被删除
    expect(parsed.source).toBe('')
  })

  it('仅有 lockedFlags 时也能写出 [flags] 表', () => {
    const model = emptyFormModel()
    model.lockedFlags = { future_flag: false }
    const { toml: built } = buildConfigFormModel(model)
    expect((toml.parse(built) as any).flags).toEqual({ future_flag: false })
  })

  it('完整往返：解析→构建→再解析，关键字段保持一致', () => {
    const content = [
      'hostname = "node-b"',
      'instance_name = "dev"',
      'dhcp = false',
      'socks5_proxy = "socks5://127.0.0.1:1080"',
      'credential_file = "C:/cred.dat"',
      'listeners = ["tcp://0.0.0.0:11000"]',
      'routes = ["10.1.0.0/16"]',
      '[secure_mode]',
      'enabled = true',
      'local_private_key = "PRIV"',
      'local_public_key = "PUB"'
    ].join('\n')
    const parsed = roundTrip(content)
    expect(parsed.hostname).toBe('node-b')
    expect(parsed.instance_name).toBe('dev')
    expect(parsed.dhcp).toBe(false)
    expect(parsed.socks5_proxy).toBe('socks5://127.0.0.1:1080')
    expect(parsed.credential_file).toBe('C:/cred.dat')
    expect(parsed.secure_mode).toEqual({
      enabled: true,
      local_private_key: 'PRIV',
      local_public_key: 'PUB'
    })
    expect(parsed.listeners).toEqual(['tcp://0.0.0.0:11000'])
    expect(parsed.routes).toEqual(['10.1.0.0/16'])
  })
})
