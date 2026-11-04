import { describe, expect, it } from 'vitest'
import { STUN_CACHE_KEY } from '@/shared/lib/cacheUtil'
import {
  mergeStunServers,
  parseStunServerText,
  readStunCache,
  writeStunCache
} from '../stunServerUtil'

const createStorage = (): Storage => {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value)
  }
}

describe('parseStunServerText', () => {
  it('逐行 trim，丢弃空行与注释行', () => {
    const text = '# comment\n\n  stun.a:3478  \r\nstun.b:3478\n   \n#tail'
    expect(parseStunServerText(text)).toEqual(['stun.a:3478', 'stun.b:3478'])
  })

  it('空文本返回空数组', () => {
    expect(parseStunServerText('')).toEqual([])
  })
})

describe('mergeStunServers', () => {
  it('默认项置顶且去重，远端项全部保留', () => {
    const defaults = ['default:3478']
    const merged = mergeStunServers(
      ['remote-1:3478', 'default:3478', 'remote-2:3478', 'remote-1:3478'],
      defaults
    )
    expect(merged[0]).toBe('default:3478')
    expect(merged).toHaveLength(3)
    expect(new Set(merged)).toEqual(new Set(['default:3478', 'remote-1:3478', 'remote-2:3478']))
  })

  it('没有远端项时只返回默认列表', () => {
    expect(mergeStunServers([], ['a:3478', 'b:3478'])).toEqual(['a:3478', 'b:3478'])
  })
})

describe('STUN 缓存', () => {
  it('写入后可原样读回', () => {
    const storage = createStorage()
    writeStunCache(['a:3478', 'b:3478'], storage)
    expect(readStunCache(storage)).toEqual(['a:3478', 'b:3478'])
  })

  it('缓存损坏或结构非法时回退空数组', () => {
    const storage = createStorage()
    storage.setItem(STUN_CACHE_KEY, '{not-json')
    expect(readStunCache(storage)).toEqual([])

    storage.setItem(STUN_CACHE_KEY, JSON.stringify({ servers: [] }))
    expect(readStunCache(storage)).toEqual([])

    storage.setItem(STUN_CACHE_KEY, JSON.stringify(['ok:3478', 42, null]))
    expect(readStunCache(storage)).toEqual(['ok:3478'])
  })

  it('未写入时返回空数组', () => {
    expect(readStunCache(createStorage())).toEqual([])
  })
})
