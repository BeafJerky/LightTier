import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useIslandStore } from '@/shared/store/island'
import { createDefaultIslandSettings } from '@/shared/lib/island/settings'
import type { QualitySample } from '@/shared/lib/island/quality'

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    length: 0,
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    key: vi.fn(() => null)
  })
})

vi.mock('@/shared/i18n/t', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

const poor: QualitySample = { avgLatencyMs: 180, lossRate: 0, peerCount: 2 }

const reportPoorTwice = (store: ReturnType<typeof useIslandStore>, name = 'home') => {
  store.reportQuality(name, poor)
  store.reportQuality(name, poor)
}

describe('island quality lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('实例停止时清除质量通知，重新启动后重新累计两次劣化', () => {
    const store = useIslandStore()
    store.markBaseline(['home'])
    reportPoorTwice(store)
    expect(store.current?.type).toBe('quality')

    store.applyRunningNames([])
    expect(store.current?.sourceKey).toBe('health:down:home')
    expect(store.queueState.queue.some((notice) => notice.type === 'quality')).toBe(false)

    store.applyRunningNames(['home'])
    reportPoorTwice(store)
    expect(store.current?.type).toBe('quality')
  })

  it('手动忽略质量通知会结束当前事件，后续劣化需重新累计', () => {
    const store = useIslandStore()
    reportPoorTwice(store)
    const id = store.current?.id
    expect(id).toBeTruthy()

    store.dismiss(id)
    reportPoorTwice(store)

    expect(store.current?.type).toBe('quality')
  })

  it('关闭质量类型会结束当前事件，重新开启后重新累计', () => {
    const store = useIslandStore()
    reportPoorTwice(store)

    store.setTypeEnabled('quality', false)
    expect(store.current).toBeNull()
    store.setTypeEnabled('quality', true)
    reportPoorTwice(store)

    expect(store.current?.type).toBe('quality')
  })

  it('停用灵动岛会结束当前事件，重新启用后重新累计', () => {
    const store = useIslandStore()
    reportPoorTwice(store)

    store.setEnabled(false)
    expect(store.current).toBeNull()
    store.setEnabled(true)
    reportPoorTwice(store)

    expect(store.current?.type).toBe('quality')
  })

  it('取消预期停止后，运行态消失会重新报告异常', () => {
    const store = useIslandStore()
    store.markBaseline(['home'])
    store.expectStop('home')
    store.cancelExpectedStop('home')

    store.applyRunningNames([])

    expect(store.current?.sourceKey).toBe('health:down:home')
    expect(store.current?.type).toBe('error')
  })

  it('恢复设置会清理旧通知与质量事件', () => {
    const store = useIslandStore()
    reportPoorTwice(store)
    store.setExpanded(true)

    store.restoreSettings({ ...createDefaultIslandSettings(), idle: 'dot' })
    reportPoorTwice(store)

    expect(store.current?.type).toBe('quality')
    expect(store.settings.idle).toBe('dot')
  })
})
