/**
 * 引导页纯逻辑单测：平台分支选择、agent 内核就绪判定、功能项按能力位补位。
 */
import { describe, expect, it } from 'vitest'
import {
  resolveAgentCoreView,
  resolveAgentFeatureKinds,
  resolveOnboardingPlatform
} from '@/app/onboarding/onboardingState'
import type { PackagesInfo } from '@/shared/platform/backend'

const packages = (patch: Partial<PackagesInfo>): PackagesInfo => ({
  installed: [],
  available: [],
  active: null,
  installAllowed: true,
  mirrorLocked: false,
  ...patch
})

describe('resolveOnboardingPlatform', () => {
  it('未启用 agent 时按 Android 与否区分桌面与 Android', () => {
    expect(resolveOnboardingPlatform({ android: false, agent: false })).toBe('desktop')
    expect(resolveOnboardingPlatform({ android: true, agent: false })).toBe('android')
  })

  it('agent 优先于 Android', () => {
    expect(resolveOnboardingPlatform({ android: false, agent: true })).toBe('agent')
    expect(resolveOnboardingPlatform({ android: true, agent: true })).toBe('agent')
  })
})

describe('resolveAgentCoreView', () => {
  it('请求未完成 / 失败时降级为 unknown，不误报未安装', () => {
    expect(resolveAgentCoreView(null, false)).toEqual({ status: 'unknown', version: null })
    expect(resolveAgentCoreView(packages({}), false)).toEqual({ status: 'unknown', version: null })
  })

  it('有 active 版本时以 active 为准', () => {
    const view = resolveAgentCoreView(
      packages({
        installed: [
          { version: 'v2.4.5', builtin: false },
          { version: 'v2.5.0', builtin: true }
        ],
        active: 'v2.4.5'
      }),
      true
    )
    expect(view).toEqual({ status: 'ready', version: 'v2.4.5' })
  })

  it('无 active 时回退到第一个已安装版本', () => {
    const view = resolveAgentCoreView(
      packages({ installed: [{ version: 'v2.5.0', builtin: true }] }),
      true
    )
    expect(view).toEqual({ status: 'ready', version: 'v2.5.0' })
  })

  it('已加载但没有已安装版本时为 missing', () => {
    expect(resolveAgentCoreView(packages({}), true)).toEqual({ status: 'missing', version: null })
  })
})

describe('resolveAgentFeatureKinds', () => {
  it('Web 配置可用时展示 Web 配置 + 服务端托管', () => {
    expect(resolveAgentFeatureKinds(true)).toEqual(['web', 'managed'])
  })

  it('Web 配置不可用时用免客户端访问补位，列表不为空', () => {
    expect(resolveAgentFeatureKinds(false)).toEqual(['managed', 'access'])
  })
})
