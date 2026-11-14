import { describe, expect, it } from 'vitest'
import { createDefaultIslandSettings, normalizeIslandSettings } from '../settings'

describe('island settings', () => {
  it('默认全开、运行数、跟随系统、表情动画开', () => {
    expect(createDefaultIslandSettings()).toEqual({
      enabled: true,
      idle: 'count',
      types: { error: true, update: true, quality: true, feedback: true },
      silent: false,
      motion: 'system',
      face: true
    })
  })

  it('每次返回新的 types 对象，避免共享引用', () => {
    const a = createDefaultIslandSettings()
    const b = createDefaultIslandSettings()
    a.types.error = false
    expect(b.types.error).toBe(true)
  })

  it('损坏数据回退默认值', () => {
    expect(normalizeIslandSettings(null)).toEqual(createDefaultIslandSettings())
    expect(normalizeIslandSettings('bad')).toEqual(createDefaultIslandSettings())
    expect(normalizeIslandSettings({ types: 'bad' })).toEqual(createDefaultIslandSettings())
  })

  it('保留合法字段，枚举非法值回退', () => {
    const settings = normalizeIslandSettings({
      enabled: false,
      idle: 'dot',
      silent: true,
      motion: 'reduced',
      face: false,
      types: { error: false, update: true, quality: false, feedback: true }
    })
    expect(settings).toEqual({
      enabled: false,
      idle: 'dot',
      types: { error: false, update: true, quality: false, feedback: true },
      silent: true,
      motion: 'reduced',
      face: false
    })
    expect(normalizeIslandSettings({ motion: 'fast' }).motion).toBe('system')
    expect(normalizeIslandSettings({ idle: 'big' }).idle).toBe('count')
  })

  it('types 缺字段时逐项补默认，不整块丢弃', () => {
    const settings = normalizeIslandSettings({ types: { error: false } })
    expect(settings.types).toEqual({
      error: false,
      update: true,
      quality: true,
      feedback: true
    })
  })
})
