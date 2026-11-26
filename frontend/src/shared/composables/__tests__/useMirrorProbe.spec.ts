/**
 * useMirrorProbe 的 agent 分支单测（Batch C）。
 *
 * 锁定：
 * - agent 下 selectSource 写服务端 settings.coreMirror（官方源映射为空串），
 *   成功后才落 localStorage，失败回滚 UI 并提示；
 * - 首屏以服务端 coreMirror 为准（未知源并入自定义列表；空串清除显式选择标记）；
 * - mirrorLocked=true 时选择、增删、测速全部禁用；
 * - probeAll 走 packages.probeMirrors（忽略文件名），延迟回写并保留
 *   “未显式选择自动选最快”的规则；超过 10 源分批请求；
 * - native 模式行为不变：同步写 localStorage，不触碰门面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_EASYTIER, GITHUB_MIRROR_URL } from '@/shared/constants/easytier'
import {
  MIRROR_CUSTOM_KEY,
  MIRROR_SOURCE_KEY,
  useMirrorProbe
} from '@/shared/composables/useMirrorProbe'

const backendMock = vi.hoisted(() => ({
  mode: 'agent' as 'agent' | 'native',
  get: vi.fn(),
  put: vi.fn(),
  list: vi.fn(),
  probeMirrors: vi.fn()
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn()
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/ui/useCreamToast', () => ({ useCreamToast: () => toastMock }))
vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => backendMock.mode,
  backendSettings: () => ({ get: backendMock.get, put: backendMock.put }),
  backendPackages: () => ({ list: backendMock.list, probeMirrors: backendMock.probeMirrors })
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@/shared/platform/fileUtil', () => ({ measureDownloadSpeed: vi.fn() }))

const storage = new Map<string, string>()

/** 冲掉初始化 / put 的 microtask 队列 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const settingsPayload = (coreMirror: string) => ({
  autoStartLastRunning: false,
  noTun: false,
  logLevel: 'info',
  coreMirror
})

const packagesPayload = (mirrorLocked: boolean) => ({
  installed: [],
  available: [],
  active: null,
  installAllowed: true,
  mirrorLocked
})

describe('useMirrorProbe（agent 分支）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key)
    })
    backendMock.mode = 'agent'
    backendMock.get.mockResolvedValue(settingsPayload(''))
    backendMock.list.mockResolvedValue(packagesPayload(false))
    backendMock.put.mockResolvedValue(undefined)
    backendMock.probeMirrors.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('selectSource：乐观更新，put 成功后才写 localStorage', async () => {
    const mirror = useMirrorProbe()
    await flush()

    mirror.selectSource('https://ghfast.top/')
    expect(mirror.selected.value).toBe('https://ghfast.top/')
    expect(backendMock.put).toHaveBeenCalledWith({ coreMirror: 'https://ghfast.top/' })
    expect(storage.get(MIRROR_SOURCE_KEY)).toBeUndefined()

    await flush()
    expect(storage.get(MIRROR_SOURCE_KEY)).toBe('https://ghfast.top/')
  })

  it('selectSource：官方源映射为空串（服务端语义 = 官方直连）', async () => {
    backendMock.get.mockResolvedValue(settingsPayload('https://ghfast.top/'))
    const mirror = useMirrorProbe()
    await flush()

    mirror.selectSource(GITHUB_EASYTIER)
    expect(backendMock.put).toHaveBeenCalledWith({ coreMirror: '' })
    await flush()
    expect(storage.get(MIRROR_SOURCE_KEY)).toBe(GITHUB_EASYTIER)
  })

  it('selectSource：保存失败回滚 UI 并提示，不落 localStorage', async () => {
    const mirror = useMirrorProbe()
    await flush()
    backendMock.put.mockRejectedValueOnce(new Error('offline'))

    mirror.selectSource('https://ghfast.top/')
    await flush()

    expect(mirror.selected.value).toBe(GITHUB_EASYTIER)
    expect(toastMock.error).toHaveBeenCalledWith('newSettings.mirrorSaveFail')
    expect(storage.get(MIRROR_SOURCE_KEY)).toBeUndefined()
  })

  it('首屏：服务端 coreMirror 为准，未知源并入自定义列表', async () => {
    backendMock.get.mockResolvedValue(settingsPayload('https://custom.example/'))
    const mirror = useMirrorProbe()
    await flush()

    expect(mirror.selected.value).toBe('https://custom.example/')
    expect(mirror.sources.value.some((s) => s.value === 'https://custom.example/')).toBe(true)
    expect(storage.get(MIRROR_SOURCE_KEY)).toBe('https://custom.example/')
    expect(JSON.parse(storage.get(MIRROR_CUSTOM_KEY) ?? '[]')).toContain('https://custom.example/')
  })

  it('首屏：coreMirror 为空时清除本地显式选择标记（保留自动测速语义）', async () => {
    storage.set(MIRROR_SOURCE_KEY, GITHUB_MIRROR_URL[0].value)
    const mirror = useMirrorProbe()
    await flush()

    expect(mirror.selected.value).toBe(GITHUB_EASYTIER)
    expect(storage.get(MIRROR_SOURCE_KEY)).toBeUndefined()
  })

  it('mirrorLocked=true：选择、增删、测速全部禁用', async () => {
    backendMock.list.mockResolvedValue(packagesPayload(true))
    const mirror = useMirrorProbe()
    await flush()
    expect(mirror.mirrorLocked.value).toBe(true)

    mirror.selectSource('https://ghfast.top/')
    expect(backendMock.put).not.toHaveBeenCalled()
    expect(mirror.selected.value).toBe(GITHUB_EASYTIER)

    expect(mirror.addSource('https://new.example/')).toEqual({ ok: false, reason: 'invalid' })
    expect(mirror.removeSource(GITHUB_MIRROR_URL[0].value)).toBe(false)

    await mirror.probeAll('v2.6.4', '')
    expect(backendMock.probeMirrors).not.toHaveBeenCalled()
  })

  it('probeAll：走服务端测速（忽略文件名），回写延迟并自动选最快持久化', async () => {
    const fastest = GITHUB_MIRROR_URL[0].value
    backendMock.probeMirrors.mockImplementation(async (sources: string[]) =>
      sources.map((source) => ({
        source,
        latencyMs: source === fastest ? 20 : source === GITHUB_EASYTIER ? 300 : null,
        speedBytesPerSec: null,
        ok: source === fastest || source === GITHUB_EASYTIER
      }))
    )
    const mirror = useMirrorProbe()
    await flush()

    await mirror.probeAll('v2.6.4', '')

    expect(backendMock.probeMirrors).toHaveBeenCalledTimes(1)
    const [sources, version] = backendMock.probeMirrors.mock.calls[0]
    expect(version).toBe('v2.6.4')
    expect(sources).toContain(GITHUB_EASYTIER)
    expect(sources.length).toBe(mirror.sources.value.length)
    expect(mirror.sources.value.find((s) => s.value === fastest)?.latency).toBe(20)
    expect(mirror.selected.value).toBe(fastest)
    expect(backendMock.put).toHaveBeenCalledWith({ coreMirror: fastest })
    await flush()
    expect(storage.get(MIRROR_SOURCE_KEY)).toBe(fastest)
  })

  it('probeAll：已显式选择且当前源可达时不切走', async () => {
    const chosen = GITHUB_MIRROR_URL[0].value
    const other = GITHUB_MIRROR_URL[1].value
    backendMock.get.mockResolvedValue(settingsPayload(chosen))
    backendMock.probeMirrors.mockImplementation(async (sources: string[]) =>
      sources.map((source) => ({
        source,
        latencyMs: source === other ? 10 : source === chosen ? 100 : null,
        speedBytesPerSec: null,
        ok: source === other || source === chosen
      }))
    )
    const mirror = useMirrorProbe()
    await flush()

    await mirror.probeAll('v2.6.4', '')

    expect(mirror.selected.value).toBe(chosen)
    expect(backendMock.put).not.toHaveBeenCalled()
  })

  it('probeAll：超过 10 源分批请求（服务端单次上限）', async () => {
    const mirror = useMirrorProbe()
    await flush()
    expect(mirror.addSource('https://c1.example/')).toMatchObject({ ok: true })
    expect(mirror.addSource('https://c2.example/')).toMatchObject({ ok: true })
    await flush()
    backendMock.put.mockClear()
    storage.delete(MIRROR_SOURCE_KEY)

    await mirror.probeAll('v2.6.4', '')

    expect(backendMock.probeMirrors).toHaveBeenCalledTimes(2)
    expect(backendMock.probeMirrors.mock.calls[0][0]).toHaveLength(10)
    expect(backendMock.probeMirrors.mock.calls[1][0]).toHaveLength(1)
  })

  it('probeSource：agent 下无需文件名，按回显源取延迟', async () => {
    backendMock.probeMirrors.mockResolvedValue([
      { source: 'https://ghfast.top/', latencyMs: 77, speedBytesPerSec: null, ok: true }
    ])
    const mirror = useMirrorProbe()
    await flush()

    await expect(mirror.probeSource('https://ghfast.top/', 'v2.6.4', '')).resolves.toBe(77)
    expect(backendMock.probeMirrors).toHaveBeenCalledWith(['https://ghfast.top/'], 'v2.6.4')
  })

  it('native 模式：selectSource 同步写 localStorage，不触碰门面', async () => {
    backendMock.mode = 'native'
    const mirror = useMirrorProbe()
    await flush()

    mirror.selectSource('https://ghfast.top/')
    expect(mirror.selected.value).toBe('https://ghfast.top/')
    expect(storage.get(MIRROR_SOURCE_KEY)).toBe('https://ghfast.top/')
    expect(backendMock.get).not.toHaveBeenCalled()
    expect(backendMock.list).not.toHaveBeenCalled()
    expect(backendMock.put).not.toHaveBeenCalled()
    expect(mirror.mirrorLocked.value).toBe(false)
  })
})
