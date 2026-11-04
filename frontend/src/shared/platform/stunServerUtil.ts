/**
 * STUN 服务器列表：远端拉取、缓存与合并。
 *
 * 列表来自纯文本源（一行一个地址，# 开头为注释）。默认服务器始终排在最前，
 * 远端条目随机排序后去重追加——打散顺序可避免所有客户端集中打到同一台 STUN。
 */
import { DEFAULT_STUN_SERVER, STUN_SERVER_URL, USER_AGENT } from '@/shared/constants/easytier'
import { fetch } from '@tauri-apps/plugin-http'
import { STUN_CACHE_KEY } from '@/shared/lib/cacheUtil'

const REQUEST_TIMEOUT_MS = 10_000

const shuffle = <T>(items: T[]): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 解析 STUN 文本源：逐行 trim，丢弃空行与注释行 */
export const parseStunServerText = (text: string): string[] => {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** 合并默认与远端列表：默认项置顶保序，远端项随机后去重追加 */
export const mergeStunServers = (
  fetched: readonly string[],
  defaults: readonly string[] = DEFAULT_STUN_SERVER
): string[] => {
  const remoteOnly = fetched.filter((server) => !defaults.includes(server))
  return Array.from(new Set([...defaults, ...shuffle(remoteOnly)]))
}

/** 读取缓存；内容缺失或结构非法时返回空数组（缓存只用于加速，不作为事实来源） */
export const readStunCache = (storage: Storage): string[] => {
  const raw = storage.getItem(STUN_CACHE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export const writeStunCache = (servers: readonly string[], storage: Storage): void => {
  storage.setItem(STUN_CACHE_KEY, JSON.stringify(servers))
}

export const clearStunCache = (storage: Storage): void => {
  storage.removeItem(STUN_CACHE_KEY)
}

/**
 * 请求远端 STUN 列表。
 *
 * 网络失败、超时或响应为空都只返回空数组：STUN 属于增强项，
 * 拿不到时调用方仍可用内置默认服务器建连。
 */
export const requestStunServers = async (): Promise<string[]> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(STUN_SERVER_URL, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
      signal: controller.signal
    })
    if (!response.ok) {
      console.warn(`[stun] 列表请求失败: HTTP ${response.status}`)
      return []
    }
    return parseStunServerText(await response.text())
  } catch (error) {
    console.warn('[stun] 列表请求异常，回退默认服务器', error)
    return []
  } finally {
    clearTimeout(timer)
  }
}
