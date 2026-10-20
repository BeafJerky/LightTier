/**
 * configFormUtil 单测：TOML ⇄ 表单模型互转（含 5.6 敏感字段掩码回显往返）
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
  it('emptyFormModel 返回默认值（dhcp 开、flags 空对象）', () => {
    const m = emptyFormModel()
    expect(m.formData.dhcp).toBe(true)
    expect(m.formData.flags).toEqual({})
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

  it('敏感字段掩码回显：真实值进 secretBackup，显示值为 SECRET_MASK', () => {
    const content = 'local_private_key = "REAL_KEY"\ncredential = "abc"'
    const m = parseConfigFormModel(content)!
    expect(m.secretDisplays.local_private_key).toBe(SECRET_MASK)
    expect(m.secretBackup.local_private_key).toBe('REAL_KEY')
    expect(m.secretDisplays.credential).toBe(SECRET_MASK)
    // 敏感值不进入 formData（避免意外渲染/序列化）
    expect(m.formData.local_private_key).toBeUndefined()
  })

  it('掩码未改动时保存写回原值（表单→代码→落盘不丢密钥）', () => {
    const parsed = roundTrip('local_private_key = "REAL_KEY"')
    expect(parsed.local_private_key).toBe('REAL_KEY')
  })

  it('掩码被替换为新值时保存写入新值', () => {
    const parsed = roundTrip('local_private_key = "REAL_KEY"', (m) => {
      m.secretDisplays.local_private_key = 'NEW_KEY'
    })
    expect(parsed.local_private_key).toBe('NEW_KEY')
  })

  it('掩码被清空时保存移除字段', () => {
    const parsed = roundTrip('local_private_key = "REAL_KEY"\nhostname = "h"', (m) => {
      m.secretDisplays.local_private_key = ''
    })
    expect(parsed.local_private_key).toBeUndefined()
    expect(parsed.hostname).toBe('h')
  })

  it('新输入的敏感值经构建后进入 secretBackup（二次构建不丢）', () => {
    const model = parseConfigFormModel('hostname = "h"')!
    model.secretDisplays.credential = 'fresh-value'
    const first = buildConfigFormModel(model)
    expect(toml.parse(first.toml)).toMatchObject({ credential: 'fresh-value' })
    expect(first.secretBackup.credential).toBe('fresh-value')
    // 二次构建（显示值仍为明文）同样写回
    model.secretBackup = first.secretBackup
    const second = buildConfigFormModel(model)
    expect(toml.parse(second.toml)).toMatchObject({ credential: 'fresh-value' })
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
    // network_identity 的空成员应被剔除
    expect(parsed.network_identity?.network_name).toBeUndefined()
    expect(parsed.network_identity?.network_secret).toBeUndefined()
  })

  it('动态 flags 解析时排除固定高级字段（避免同 key 双处编辑）', () => {
    const content = ['[flags]', 'disable_quic_input = true', 'my_custom_flag = "v"'].join('\n')
    const m = parseConfigFormModel(content)!
    expect(m.flagsKeys).toContain('my_custom_flag')
    expect(m.flagsKeys).not.toContain('disable_quic_input')
    // 固定字段在 formData.flags 中保留
    expect((m.formData.flags as any).disable_quic_input).toBe(true)
  })

  it('完整往返：解析→构建→再解析，关键字段保持一致', () => {
    const content = [
      'hostname = "node-b"',
      'instance_name = "dev"',
      'dhcp = false',
      'socks5_proxy = "socks5://127.0.0.1:1080"',
      'local_public_key = "PUB"',
      'listeners = ["tcp://0.0.0.0:11000"]',
      'routes = ["10.1.0.0/16"]'
    ].join('\n')
    const parsed = roundTrip(content)
    expect(parsed.hostname).toBe('node-b')
    expect(parsed.instance_name).toBe('dev')
    expect(parsed.dhcp).toBe(false)
    expect(parsed.socks5_proxy).toBe('socks5://127.0.0.1:1080')
    expect(parsed.local_public_key).toBe('PUB')
    expect(parsed.listeners).toEqual(['tcp://0.0.0.0:11000'])
    expect(parsed.routes).toEqual(['10.1.0.0/16'])
  })
})
