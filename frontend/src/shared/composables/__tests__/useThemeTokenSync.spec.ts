import { effectScope, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/composables/useThemeLoader', async () => {
  const { ref } = await import('vue')
  const currentTheme = ref('cream')
  const themeRevision = ref(0)
  return {
    useThemeLoader: () => ({ currentTheme, themeRevision }),
    __themeState: { currentTheme, themeRevision }
  }
})

import * as themeLoader from '@/shared/composables/useThemeLoader'
import { useThemeTokenSync } from '../useThemeTokenSync'

const state = (
  themeLoader as unknown as {
    __themeState: { currentTheme: { value: string }; themeRevision: { value: number } }
  }
).__themeState

describe('useThemeTokenSync', () => {
  beforeEach(() => {
    state.currentTheme.value = 'cream'
    state.themeRevision.value = 0
  })

  it('主题名或 revision 变化后在 post flush 回调', async () => {
    const sync = vi.fn()
    const scope = effectScope()
    scope.run(() => useThemeTokenSync(sync))

    state.themeRevision.value++
    await nextTick()
    expect(sync).toHaveBeenCalledTimes(1)

    state.currentTheme.value = 'famicom'
    await nextTick()
    expect(sync).toHaveBeenCalledTimes(2)

    scope.stop()
  })

  it('作用域销毁后停止订阅', async () => {
    const sync = vi.fn()
    const scope = effectScope()
    scope.run(() => useThemeTokenSync(sync))
    scope.stop()

    state.themeRevision.value++
    await nextTick()
    expect(sync).not.toHaveBeenCalled()
  })
})
