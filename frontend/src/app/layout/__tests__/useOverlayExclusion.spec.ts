import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useOverlayExclusion } from '@/app/layout/useOverlayExclusion'

describe('useOverlayExclusion', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    scope = effectScope()
  })

  afterEach(() => scope.stop())

  it('打开灵动岛时关闭悬浮菜单', async () => {
    const islandOpen = ref(false)
    const menuOpen = ref(true)
    scope.run(() => useOverlayExclusion(islandOpen, menuOpen))

    islandOpen.value = true
    await nextTick()

    expect(islandOpen.value).toBe(true)
    expect(menuOpen.value).toBe(false)
  })

  it('打开悬浮菜单时收起灵动岛', async () => {
    const islandOpen = ref(true)
    const menuOpen = ref(false)
    scope.run(() => useOverlayExclusion(islandOpen, menuOpen))

    menuOpen.value = true
    await nextTick()

    expect(islandOpen.value).toBe(false)
    expect(menuOpen.value).toBe(true)
  })

  it('初始化时两者同时打开优先保留灵动岛', async () => {
    const islandOpen = ref(true)
    const menuOpen = ref(true)
    scope.run(() => useOverlayExclusion(islandOpen, menuOpen))
    await nextTick()

    expect(islandOpen.value).toBe(true)
    expect(menuOpen.value).toBe(false)
  })
})
