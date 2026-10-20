/**
 * kernelCompatUtil 单测：版本解析、能力推导与配置兼容校验
 */
import { describe, it, expect } from 'vitest'
import {
  checkConfigCompat,
  compareCoreVersion,
  isCoreFlagSupported,
  isCoreFeatureSupported,
  parseCoreVersion,
  parseVersionTuple,
  resolveCoreCapabilities
} from '@/utils/kernelCompatUtil'

describe('kernelCompatUtil / 版本解析', () => {
  it('解析 CLI 原始输出与纯版本号', () => {
    expect(parseCoreVersion('easytier-cli 2.6.4')).toBe('v2.6.4')
    expect(parseCoreVersion('2.7.0')).toBe('v2.7.0')
    expect(parseCoreVersion('v2.4.5')).toBe('v2.4.5')
    expect(parseVersionTuple('easytier-cli 2.6.4')).toEqual([2, 6, 4])
  })

  it('无法解析的输入返回 null（含 CLI 调用失败的 403）', () => {
    expect(parseCoreVersion('403')).toBeNull()
    expect(parseCoreVersion('')).toBeNull()
    expect(parseCoreVersion(undefined)).toBeNull()
    expect(resolveCoreCapabilities(null)).toBeNull()
  })

  it('版本比较按数字逐段进行', () => {
    expect(compareCoreVersion('v2.6.4', 'v2.6.3')).toBeGreaterThan(0)
    expect(compareCoreVersion('v2.4.5', 'v2.5.0')).toBeLessThan(0)
    expect(compareCoreVersion('2.7.0', 'v2.7.0')).toBe(0)
  })
})

describe('kernelCompatUtil / 能力推导', () => {
  it('v2.4.5：不含 v2.5.0 新增 flags，安全模式与 IPv6 公网地址不可用', () => {
    const caps = resolveCoreCapabilities('v2.4.5')!
    expect(caps.flags).not.toBeNull()
    expect(caps.flags!.has('latency_first')).toBe(true)
    expect(caps.flags!.has('p2p_only')).toBe(false)
    expect(caps.flags!.has('lazy_p2p')).toBe(false)
    expect(caps.flagsStrict).toBe(false)
    expect(isCoreFeatureSupported('secureMode', caps)).toBe(false)
    expect(isCoreFeatureSupported('ipv6PublicAddr', caps)).toBe(false)
    expect(caps.vpnPortalFormat).toBe('legacy')
    expect(caps.serviceCoreArgs).toBe('positional')
  })

  it('v2.5.0：新增 p2p_only 等 flags，但仍无安全模式', () => {
    const caps = resolveCoreCapabilities('v2.5.0')!
    expect(caps.flags!.has('p2p_only')).toBe(true)
    expect(caps.flags!.has('disable_tcp_hole_punching')).toBe(true)
    expect(caps.flags!.has('lazy_p2p')).toBe(false)
    expect(isCoreFeatureSupported('secureMode', caps)).toBe(false)
    expect(isCoreFeatureSupported('credentialCli', caps)).toBe(false)
  })

  it('v2.6.4：安全模式/IPv6 可用，v2.7.0 新 flags 不可用，旧 vpn portal 结构', () => {
    const caps = resolveCoreCapabilities('v2.6.4')!
    expect(caps.flags!.has('enable_udp_broadcast_relay')).toBe(true)
    expect(caps.flags!.has('prefer_peer_relay')).toBe(false)
    expect(caps.flagsStrict).toBe(false)
    expect(isCoreFeatureSupported('secureMode', caps)).toBe(true)
    expect(isCoreFeatureSupported('ipv6PublicAddr', caps)).toBe(true)
    expect(isCoreFeatureSupported('tcpStunServers', caps)).toBe(false)
    expect(caps.vpnPortalFormat).toBe('legacy')
    expect(caps.serviceCoreArgs).toBe('positional')
  })

  it('v2.7.0：严格 flags、全量白名单、新 vpn portal 与命名 core-args', () => {
    const caps = resolveCoreCapabilities('v2.7.0')!
    expect(caps.flags!.has('prefer_peer_relay')).toBe(true)
    expect(caps.flags!.has('socket_mark')).toBe(true)
    expect(caps.flags!.size).toBe(43)
    expect(caps.flagsStrict).toBe(true)
    expect(isCoreFeatureSupported('vpnPortalClients', caps)).toBe(true)
    expect(caps.vpnPortalFormat).toBe('v2.7')
    expect(caps.serviceCoreArgs).toBe('named')
  })

  it('高于最高已知版本：跳过 flags 白名单校验（避免误报未来新增键）', () => {
    const caps = resolveCoreCapabilities('v2.8.0')!
    expect(caps.known).toBe(false)
    expect(caps.flags).toBeNull()
    expect(caps.flagsStrict).toBe(true)
    expect(isCoreFlagSupported('future_flag', caps)).toBe(true)
  })

  it('未知版本下功能判断宽松放行（显示字段，不隐藏）', () => {
    expect(isCoreFeatureSupported('secureMode', null)).toBe(true)
    expect(isCoreFlagSupported('anything', null)).toBe(true)
  })
})

describe('kernelCompatUtil / 配置兼容校验', () => {
  it('未检测到版本时仅给出警告，不产生 error', () => {
    const issues = checkConfigCompat({ flags: { whatever: true } }, null)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warning', code: 'unknownVersion' })
  })

  it('未知 flags：v2.6.4 警告，v2.7.0 报错', () => {
    const config = { flags: { future_flag: true } }
    const oldIssues = checkConfigCompat(config, 'v2.6.4')
    expect(oldIssues).toEqual([
      {
        level: 'warning',
        code: 'flagUnknownIgnored',
        params: { flag: 'future_flag', version: 'v2.6.4' }
      }
    ])
    const newIssues = checkConfigCompat(config, 'v2.7.0')
    expect(newIssues).toEqual([
      {
        level: 'error',
        code: 'flagUnknownStrict',
        params: { flag: 'future_flag', version: 'v2.7.0' }
      }
    ])
  })

  it('v2.7.0 旧 vpn_portal_config：client_cidr 报错，并提示缺失 wireguard_listen', () => {
    const issues = checkConfigCompat(
      { vpn_portal_config: { client_cidr: '10.144.0.0/16' } },
      'v2.7.0'
    )
    expect(issues.map((i) => i.code)).toEqual([
      'vpnClientCidrRemoved',
      'vpnWireguardListenRequired'
    ])
    expect(issues.every((i) => i.level === 'error')).toBe(true)
  })

  it('v2.7.0 新结构合法配置不产生问题', () => {
    const issues = checkConfigCompat(
      {
        vpn_portal_config: {
          enabled: true,
          wireguard_listen: '0.0.0.0:11010',
          clients: [{ name: 'alice', virtual_ip: '10.144.0.5/16', groups: [] }]
        }
      },
      'v2.7.0'
    )
    expect(issues).toEqual([])
  })

  it('旧内核缺失 client_cidr / wireguard_listen 均报错；新结构字段仅警告', () => {
    const missing = checkConfigCompat(
      { vpn_portal_config: { wireguard_listen: '0.0.0.0:11010' } },
      'v2.6.4'
    )
    expect(missing).toEqual([
      { level: 'error', code: 'vpnClientCidrRequired', params: { version: 'v2.6.4' } }
    ])
    const missingListen = checkConfigCompat(
      { vpn_portal_config: { client_cidr: '10.144.0.0/16' } },
      'v2.6.4'
    )
    expect(missingListen).toEqual([
      { level: 'error', code: 'vpnWireguardListenRequired', params: { version: 'v2.6.4' } }
    ])
    const mixed = checkConfigCompat(
      {
        vpn_portal_config: {
          client_cidr: '10.144.0.0/16',
          wireguard_listen: '0.0.0.0:11010',
          clients: []
        }
      },
      'v2.6.4'
    )
    expect(mixed.every((i) => i.level === 'warning')).toBe(true)
    expect(mixed[0].code).toBe('vpnFieldIgnored')
  })

  it('v2.7.0 客户端缺少 name / virtual_ip 时报错并给出字段路径', () => {
    const issues = checkConfigCompat(
      {
        vpn_portal_config: {
          wireguard_listen: '0.0.0.0:11010',
          clients: [{ groups: [] }, { name: 'bob', virtual_ip: '' }]
        }
      },
      'v2.7.0'
    )
    expect(issues).toEqual([
      {
        level: 'error',
        code: 'vpnFieldRequired',
        params: { field: 'vpn_portal_config.clients[0].name', version: 'v2.7.0' }
      },
      {
        level: 'error',
        code: 'vpnFieldRequired',
        params: { field: 'vpn_portal_config.clients[0].virtual_ip', version: 'v2.7.0' }
      },
      {
        level: 'error',
        code: 'vpnFieldRequired',
        params: { field: 'vpn_portal_config.clients[1].virtual_ip', version: 'v2.7.0' }
      }
    ])
  })

  it('顶层字段早于引入版本：给出 warning（不阻断）', () => {
    const issues = checkConfigCompat(
      {
        secure_mode: { enabled: true },
        ipv6_public_addr_auto: true,
        tcp_stun_servers: ['stun.example.com'],
        peer: [{ uri: 'tcp://a:1', peer_public_key: 'PK' }]
      },
      'v2.4.5'
    )
    const fields = issues.map((i) => i.params?.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'secure_mode',
        'ipv6_public_addr_auto',
        'tcp_stun_servers',
        'peer.peer_public_key'
      ])
    )
    expect(issues.every((i) => i.level === 'warning')).toBe(true)
  })

  it('rpc_portal 自 v2.5.0 起配置文件不再生效：提示由 CLI 传入，v2.4.5 不提示', () => {
    const config = { rpc_portal: '0.0.0.0:15888' }
    expect(checkConfigCompat(config, 'v2.4.5')).toEqual([])
    expect(checkConfigCompat(config, 'v2.5.0')).toEqual([
      {
        level: 'warning',
        code: 'rpcPortalCliOnly',
        params: { since: 'v2.5.0', version: 'v2.5.0' }
      }
    ])
  })

  it('超出已知版本区间：跳过 VPN 结构键级校验，避免误拦未来版本', () => {
    const issues = checkConfigCompat({ vpn_portal_config: { future_field: true } }, 'v2.8.0')
    expect(issues).toEqual([])
  })

  it('错误排在警告之前', () => {
    const issues = checkConfigCompat(
      {
        vpn_portal_config: { client_cidr: '10.0.0.0/8' },
        flags: { unknown_key: true }
      },
      'v2.7.0'
    )
    expect(issues[0].level).toBe('error')
  })
})
