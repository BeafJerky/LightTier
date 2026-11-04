/**
 * 可丢弃的远端缓存键与清理入口。
 *
 * 只覆盖能随时重新拉取的数据（STUN 列表、公共节点列表）；
 * 配置、主题、语言、锁屏口令、自动运行与引导状态不属于缓存，禁止在此清理。
 */

export const STUN_CACHE_KEY = 'lighttier.stun.v1'
export const PEER_CACHE_KEY = 'lighttier.publicPeers.v1'

export const APP_CACHE_KEYS = [STUN_CACHE_KEY, PEER_CACHE_KEY] as const

/** 早期版本使用过的缓存键：清理时一并移除，避免同一份数据出现两套副本 */
const RETIRED_CACHE_KEYS = ['stunServerList', 'publicPeerList'] as const

export const clearAppCache = (storage: Storage = window.localStorage): void => {
  for (const key of [...APP_CACHE_KEYS, ...RETIRED_CACHE_KEYS]) {
    storage.removeItem(key)
  }
}
