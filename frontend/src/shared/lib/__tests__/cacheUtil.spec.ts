import { describe, expect, it } from 'vitest'
import { APP_CACHE_KEYS, PEER_CACHE_KEY, STUN_CACHE_KEY, clearAppCache } from '../cacheUtil'

const createStorage = (initial: Record<string, string> = {}): Storage => {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
    setItem: (key: string, value: string) => {
      data.set(key, value)
    }
  }
}

describe('cacheUtil', () => {
  it('只删除白名单内的缓存键与早期缓存键', () => {
    const storage = createStorage({
      [STUN_CACHE_KEY]: '["stun"]',
      [PEER_CACHE_KEY]: '["peer"]',
      stunServerList: '["old-stun"]',
      publicPeerList: '["old-peer"]',
      easytier: '{"lockPassword":"hash"}',
      theme: 'cream',
      'settings.onboardingDone': 'true'
    })

    clearAppCache(storage)

    expect(APP_CACHE_KEYS.every((key) => storage.getItem(key) === null)).toBe(true)
    expect(storage.getItem('stunServerList')).toBeNull()
    expect(storage.getItem('publicPeerList')).toBeNull()
    expect(storage.getItem('easytier')).toBe('{"lockPassword":"hash"}')
    expect(storage.getItem('theme')).toBe('cream')
    expect(storage.getItem('settings.onboardingDone')).toBe('true')
  })

  it('空存储或键不存在时不抛错', () => {
    const storage = createStorage()
    expect(() => clearAppCache(storage)).not.toThrow()
    expect(storage.length).toBe(0)
  })
})
