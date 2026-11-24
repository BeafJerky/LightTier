/**
 * Web 配置主机名校验单测（M-04 参数注入防护）
 *
 * host 最终拼进 `--config-server <protocol>://<host>:<port>/<user>`，
 * 含空格/引号/斜杠等字符会被内核当作额外参数，必须在保存与服务安装前拒绝。
 */
import { describe, expect, it } from 'vitest'
import { formatWebConfigServerUrl, isValidWebHost } from '@/features/web-configs/lib/webConfigHost'

describe('isValidWebHost', () => {
  it('放行 IPv4、localhost 与常规域名', () => {
    expect(isValidWebHost('127.0.0.1')).toBe(true)
    expect(isValidWebHost('10.0.0.10')).toBe(true)
    expect(isValidWebHost('localhost')).toBe(true)
    expect(isValidWebHost('example.com')).toBe(true)
    expect(isValidWebHost('sub-domain.example.com')).toBe(true)
    expect(isValidWebHost('  example.com  ')).toBe(true)
  })

  it('放行 IPv6 字面量，并拒绝不完整或夹带参数的地址', () => {
    expect(isValidWebHost('::1')).toBe(true)
    expect(isValidWebHost('2001:db8::1')).toBe(true)
    expect(isValidWebHost('[::1]')).toBe(true)
    expect(isValidWebHost(':::1')).toBe(false)
    expect(isValidWebHost('[::1')).toBe(false)
    expect(isValidWebHost('::1]')).toBe(false)
    expect(isValidWebHost('::1/path')).toBe(false)
    expect(isValidWebHost('::1 --rpc-portal 127.0.0.1:1')).toBe(false)
  })

  it('生成 config-server URL 时为 IPv6 加方括号且不重复添加', () => {
    expect(
      formatWebConfigServerUrl({
        protocol: 'udp',
        host: '2001:db8::1',
        port: 22020,
        userName: 'alice'
      })
    ).toBe('udp://[2001:db8::1]:22020/alice')
    expect(
      formatWebConfigServerUrl({
        protocol: 'tcp',
        host: '[::1]',
        port: 22020,
        userName: 'alice'
      })
    ).toBe('tcp://[::1]:22020/alice')
  })

  it('拒绝空值与空白主机', () => {
    expect(isValidWebHost('')).toBe(false)
    expect(isValidWebHost('   ')).toBe(false)
  })

  it('拒绝可注入额外参数或破坏 URL 的字符', () => {
    expect(isValidWebHost('example.com --rpc-portal 127.0.0.1:1')).toBe(false)
    expect(isValidWebHost('example.com;rm')).toBe(false)
    expect(isValidWebHost('exa mple.com')).toBe(false)
    expect(isValidWebHost('host"quote')).toBe(false)
    expect(isValidWebHost('host/path')).toBe(false)
    expect(isValidWebHost('host:123')).toBe(false)
    expect(isValidWebHost('user@host')).toBe(false)
    expect(isValidWebHost('host\nname')).toBe(false)
  })

  it('拒绝非法域名结构（空标签、首尾连字符、超长）', () => {
    expect(isValidWebHost('a..b')).toBe(false)
    expect(isValidWebHost('.example.com')).toBe(false)
    expect(isValidWebHost('example.com.')).toBe(false)
    expect(isValidWebHost('-example.com')).toBe(false)
    expect(isValidWebHost('example-.com')).toBe(false)
    expect(isValidWebHost(`${'a'.repeat(64)}.com`)).toBe(false)
  })
})
