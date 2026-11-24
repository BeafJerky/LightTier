/**
 * Web 配置主机校验。
 *
 * host 会拼进 `--config-server <protocol>://<host>:<port>/<user>` 作为内核启动参数，
 * 因此拒绝空白、引号、斜杠及可破坏 URL 的字符；域名之外允许标准 IPv6 字面量。
 */
import type { FormWebData } from '@/entities/config/formTypes'

const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

const isIPv6Literal = (value: string): boolean => {
  try {
    new URL(`http://[${value}]/`)
    return true
  } catch {
    return false
  }
}

export const isValidWebHost = (host: string | undefined | null): boolean => {
  const value = (host ?? '').trim()
  if (!value || value.length > 253 || /\s/.test(value)) return false
  if ([...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return false
  }
  if (value.includes(':')) {
    if (value.startsWith('[')) {
      return value.endsWith(']') && isIPv6Literal(value.slice(1, -1))
    }
    return isIPv6Literal(value)
  }
  return value.split('.').every((label) => label.length <= 63 && HOST_LABEL.test(label))
}

export const formatWebConfigServerUrl = (
  config: Pick<FormWebData, 'protocol' | 'host' | 'port' | 'userName'>
): string => {
  const host = (config.host ?? '').trim()
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${config.protocol}://${authority}:${config.port}/${config.userName}`
}
