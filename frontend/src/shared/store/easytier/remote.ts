/**
 * 远端数据域：管理器发布信息、公共共享节点、STUN 服务器与监控摘要快照。
 * 网络失败只回退缓存/默认值，不阻断页面；本地缓存不参与持久化状态迁移。
 */
import { ref } from 'vue'
import { MANAGER_INFO_API, MONITOR_LIST, USER_AGENT } from '@/shared/constants/easytier'
import { PEER_CACHE_KEY } from '@/shared/lib/cacheUtil'
import {
  clearStunCache,
  mergeStunServers,
  readStunCache,
  requestStunServers,
  writeStunCache
} from '@/shared/platform/stunServerUtil'
import type { ReleaseAsset } from '@/shared/platform/updateUtil'
import { isTauri } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'

export interface MonitorSummary {
  nodeCount: number
  avgLatency: string
}

/** GitHub Releases 列表项中检查更新所需的最小字段 */
export interface ManagerRelease {
  tag_name?: string
  prerelease?: boolean
  draft?: boolean
  assets?: ReleaseAsset[]
}

/** 公共共享节点缓存读取（uptime 接口失败时兜底，不参与业务状态持久化） */
const readPeerCache = (): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PEER_CACHE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function createRemoteDomain() {
  // 监控摘要快照：configName → 节点数/平均延迟（monitor 单写，overview 多读，避免复制轮询）
  const monitorSummaryMap = ref<Record<string, MonitorSummary>>({})
  const publicPeerList = ref<any[]>([])
  const stunServerList = ref<string[]>([])
  // 缓存的节点信息（页面切换时保留，避免重新轮询）
  const cachedNodeInfo = ref<any>({})
  // 缓存的 peer 信息（页面切换时保留，避免重新轮询）
  const cachedPeerInfo = ref<PeerInfo[]>([])

  const setMonitorSummary = (configName: string, summary: MonitorSummary) => {
    monitorSummaryMap.value = { ...monitorSummaryMap.value, [configName]: summary }
  }
  const clearMonitorSummary = (configName: string) => {
    const next = { ...monitorSummaryMap.value }
    delete next[configName]
    monitorSummaryMap.value = next
  }

  // 发布元数据和资产摘要只从官方 API 获取；镜像仅用于下载安装包字节。
  // 10 秒总超时：网络不可用时及时失败，避免“检查中”无限等待。
  const refreshManagerReleaseInfo = async (): Promise<ManagerRelease[]> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const init = {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json'
      },
      signal: controller.signal
    }
    try {
      const response = isTauri()
        ? await fetch(MANAGER_INFO_API, init)
        : await window.fetch(MANAGER_INFO_API, init)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('empty release list')
      }
      return data as ManagerRelease[]
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  // 公共共享节点列表（uptime 监控数据）：成功即更新缓存，失败回退上次成功结果
  const getPublicPeerList = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(MONITOR_LIST, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          accept: 'application/json, text/plain, */*',
          Referer: 'https://uptime.easytier.cn/'
        },
        signal: controller.signal
      })
      const payload = await response.json()
      const items = payload?.success ? payload.data?.items : null
      if (Array.isArray(items)) {
        publicPeerList.value = items
        localStorage.setItem(PEER_CACHE_KEY, JSON.stringify(items))
        return items
      }
    } catch (error) {
      console.warn('[peers] 公共节点拉取失败，使用缓存', error)
    } finally {
      clearTimeout(timer)
    }
    publicPeerList.value = readPeerCache()
    return publicPeerList.value
  }

  // 清除远端临时缓存后同步重置内存副本（下次使用时会自然重新拉取远端数据）
  const resetRemoteCache = () => {
    publicPeerList.value = []
    stunServerList.value = []
    localStorage.removeItem(PEER_CACHE_KEY)
    clearStunCache(localStorage)
  }

  // STUN 列表：缓存命中先返回并后台刷新，未命中则同步拉取；失败只回退默认服务器
  let stunRefreshTask: Promise<string[]> | null = null
  const refreshStunServers = async (): Promise<string[]> => {
    if (stunRefreshTask) return stunRefreshTask
    stunRefreshTask = (async () => {
      const merged = mergeStunServers(await requestStunServers())
      stunServerList.value = merged
      writeStunCache(merged, localStorage)
      return merged
    })().finally(() => {
      stunRefreshTask = null
    })
    return stunRefreshTask
  }
  const getStunServers = async (): Promise<string[]> => {
    const cached = readStunCache(localStorage)
    if (cached.length === 0) return refreshStunServers()
    stunServerList.value = mergeStunServers(cached)
    void refreshStunServers()
    return stunServerList.value
  }

  return {
    monitorSummaryMap,
    setMonitorSummary,
    clearMonitorSummary,
    publicPeerList,
    stunServerList,
    cachedNodeInfo,
    cachedPeerInfo,
    refreshManagerReleaseInfo,
    getPublicPeerList,
    resetRemoteCache,
    getStunServers,
    refreshStunServers
  }
}
