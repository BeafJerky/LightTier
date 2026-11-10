/**
 * injectRequired 单测：有提供者时返回原值；缺失时抛出可定位的错误
 */
import { describe, it, expect } from 'vitest'
import { createApp, type InjectionKey } from 'vue'
import { injectRequired } from '@/shared/lib/inject'

const DEMO_KEY: InjectionKey<{ name: string }> = Symbol('demo')

describe('injectRequired', () => {
  it('返回提供者注入的值', () => {
    const app = createApp({})
    app.provide(DEMO_KEY, { name: 'demo' })
    expect(app.runWithContext(() => injectRequired(DEMO_KEY))).toEqual({ name: 'demo' })
  })

  it('缺失时抛出包含键与使用方的错误', () => {
    const app = createApp({})
    expect(() => app.runWithContext(() => injectRequired(DEMO_KEY))).toThrowError(/Symbol\(demo\)/)
    expect(() => app.runWithContext(() => injectRequired(DEMO_KEY, 'DemoSection'))).toThrowError(
      /DemoSection/
    )
  })
})
