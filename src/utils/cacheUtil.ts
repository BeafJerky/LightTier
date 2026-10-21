/**
 * 应用临时缓存清理
 *
 * 只清除可重新获取的远端缓存（STUN 列表、公共节点列表），
 * 不触碰配置、主题、语言、锁屏密码、自动运行与引导状态。
 */
export const APP_CACHE_KEYS = ['stunServerList', 'publicPeerList'] as const

export const clearAppCache = (storage: Storage = window.localStorage): void => {
  for (const key of APP_CACHE_KEYS) storage.removeItem(key)
}
