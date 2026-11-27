/**
 * 隧道 URI 的展示形态拆装（proto://rest）。
 * 表单用「协议下拉 + 其余部分」编辑，避免把未知 URL 形态写坏：
 * 无 scheme 的旧值按 tcp 显示，但未编辑时保持原文。
 */
export interface TunnelUriParts {
  proto: string
  rest: string
  hasScheme: boolean
}

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/

export const splitTunnelUri = (uri: string | null | undefined): TunnelUriParts => {
  const text = typeof uri === 'string' ? uri : ''
  const match = SCHEME_PATTERN.exec(text)
  if (!match) return { proto: 'tcp', rest: text, hasScheme: false }
  return { proto: match[1].toLowerCase(), rest: match[2], hasScheme: true }
}

export const joinTunnelUri = (proto: string, rest: string): string => {
  const host = typeof rest === 'string' ? rest.trim() : ''
  if (!host) return ''
  return `${(proto || 'tcp').toLowerCase()}://${host}`
}

/** 常用协议；当前行若使用其他协议，UI 会动态补一项，避免保存时改协议 */
export const TUNNEL_PROTOCOLS = ['tcp', 'udp', 'wg'] as const
