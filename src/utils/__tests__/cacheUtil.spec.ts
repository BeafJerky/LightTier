import { describe, expect, it } from 'vitest'
import { APP_CACHE_KEYS, clearAppCache } from '../cacheUtil'

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
  it('只删除白名单内的缓存键', () => {
    const storage = createStorage({
      stunServerList: '["stun"]',
      publicPeerList: '["peer"]',
      easytier: '{"lockPassword":"hash"}',
      theme: 'cream',
      'settings.onboardingDone': 'true',
      runningList: '[]'
    })

    clearAppCache(storage)

    expect(APP_CACHE_KEYS.every((key) => storage.getItem(key) === null)).toBe(true)
    expect(storage.getItem('easytier')).toBe('{"lockPassword":"hash"}')
    expect(storage.getItem('theme')).toBe('cream')
    expect(storage.getItem('settings.onboardingDone')).toBe('true')
    expect(storage.getItem('runningList')).toBe('[]')
  })

  it('空存储或键不存在时不抛错', () => {
    const storage = createStorage()
    expect(() => clearAppCache(storage)).not.toThrow()
    expect(storage.length).toBe(0)
  })
})
