/**
 * useAppBackup 恢复链路单测：文件快照/回滚与灵动岛偏好写回。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RestorePlan } from '@/features/settings/lib/backupUtil'

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>()
  const tomlFiles: string[] = []
  const storage = new Map<string, string>()
  const storeState: Record<string, unknown> = {
    p2pNotifySetting: true,
    refreshInterval: 10,
    selectedColumns: [],
    defaultServiceInstallMethod: 'nssm',
    defaultEnableAutostart: false,
    autoRunNetworkSetting: false,
    autoRunConfigName: '',
    lockPassword: 'old-lock',
    $patch: vi.fn()
  }
  const islandState: Record<string, unknown> = {
    settings: {
      enabled: true,
      idle: 'count',
      types: { error: true, update: true, quality: true, feedback: true },
      silent: false,
      motion: 'system',
      face: true
    },
    $patch: vi.fn()
  }
  const state = { files, tomlFiles, storage, storeState, islandState, failWriteSuffix: '' }
  return state
})

vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    listTomlFiles: async () => [...mocks.tomlFiles],
    readFileContent: async (path: string) => mocks.files.get(path) ?? '',
    writeFileContent: async (path: string, value: string) => {
      if (mocks.failWriteSuffix && path.endsWith(mocks.failWriteSuffix)) {
        throw new Error('write failed')
      }
      mocks.files.set(path, value)
    },
    deleteFileOrDir: async (path: string) => {
      mocks.files.delete(path)
    },
    readWebConfigList: async () => [],
    writeWebConfigList: async () => {}
  })
}))

vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => mocks.storeState
}))

vi.mock('@/shared/store/island', () => ({
  useIslandStore: () => mocks.islandState
}))

vi.mock('@/shared/composables/useExternalThemes', () => ({
  loadThemeCss: vi.fn(async () => 'body{}')
}))

vi.mock('@/shared/composables/useMirrorProbe', () => ({
  MIRROR_SOURCE_KEY: 'mirror.source',
  MIRROR_CUSTOM_KEY: 'mirror.custom',
  MIRROR_HIDDEN_KEY: 'mirror.hidden'
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }))

const makePlan = (items: RestorePlan['entries']): RestorePlan =>
  ({
    manifest: {} as RestorePlan['manifest'],
    entries: items,
    counts: { same: 0, new: items.length, safe: 0, conflict: 0, invalid: 0 }
  }) as RestorePlan

const entry = (item: RestorePlan['entries'][number]['item']) => ({
  item,
  status: 'new' as const,
  localValue: null,
  localHash: null
})

describe('applyRestore（原子化）', () => {
  beforeEach(() => {
    mocks.files.clear()
    mocks.tomlFiles.length = 0
    mocks.storage.clear()
    mocks.failWriteSuffix = ''
    mocks.islandState.settings = {
      enabled: true,
      idle: 'count',
      types: { error: true, update: true, quality: true, feedback: true },
      silent: false,
      motion: 'system',
      face: true
    }
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => mocks.storage.get(key) ?? null,
        setItem: (key: string, value: string) => mocks.storage.set(key, value),
        removeItem: (key: string) => mocks.storage.delete(key),
        key: (index: number) => Array.from(mocks.storage.keys())[index] ?? null,
        get length() {
          return mocks.storage.size
        }
      }
    })
  })

  it('后续条目写入失败时，已写入的配置文件恢复为原内容', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')
    mocks.failWriteSuffix = 'b.toml'

    const plan = makePlan([
      entry(createBackupItem('configs', 'a.toml', 'NEW')),
      entry(createBackupItem('configs', 'b.toml', 'B'))
    ])
    const result = await applyRestore(plan, {
      'config:a.toml': 'backup',
      'config:b.toml': 'backup'
    })

    expect(result).toEqual({ applied: 0, failed: ['config:b.toml'], rolledBack: true })
    expect(mocks.files.get('config/a.toml')).toBe('OLD')
    expect(mocks.files.has('config/b.toml')).toBe(false)
  })

  it('恢复成功时写入备份内容且不触碰其它条目', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')

    const plan = makePlan([entry(createBackupItem('configs', 'a.toml', 'NEW'))])
    const result = await applyRestore(plan, { 'config:a.toml': 'backup' })

    expect(result).toEqual({ applied: 1, failed: [], rolledBack: false })
    expect(mocks.files.get('config/a.toml')).toBe('NEW')
  })

  it('被回滚的偏好不会把灵动岛设置写进 store', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    const preferences = JSON.stringify({
      version: 1,
      store: {
        islandSettings: {
          enabled: false,
          idle: 'dot',
          types: { error: false, update: true, quality: true, feedback: true },
          silent: true,
          motion: 'reduced',
          face: false
        }
      },
      local: {},
      serviceConfigs: {}
    })
    mocks.tomlFiles.push('a.toml')
    mocks.failWriteSuffix = 'a.toml'

    const plan = makePlan([
      entry(createBackupItem('preferences', '', preferences)),
      entry(createBackupItem('configs', 'a.toml', 'NEW'))
    ])
    const result = await applyRestore(plan, { preferences: 'backup', 'config:a.toml': 'backup' })

    expect(result).toEqual({ applied: 0, failed: ['config:a.toml'], rolledBack: true })
    expect(mocks.islandState.$patch).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enabled: true, idle: 'count', motion: 'system' })
    })
  })

  it('恢复灵动岛偏好时写回设置并保留通知类型', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    const preferences = JSON.stringify({
      version: 1,
      store: {
        islandSettings: {
          enabled: false,
          idle: 'dot',
          types: { error: false, update: true, quality: false, feedback: true },
          silent: true,
          motion: 'reduced',
          face: false
        }
      },
      local: {},
      serviceConfigs: {}
    })
    const plan = makePlan([entry(createBackupItem('preferences', '', preferences))])
    const result = await applyRestore(plan, { preferences: 'backup' })

    expect(result).toEqual({ applied: 1, failed: [], rolledBack: false })
    expect(mocks.islandState.$patch).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        enabled: false,
        idle: 'dot',
        silent: true,
        motion: 'reduced',
        face: false,
        types: { error: false, update: true, quality: false, feedback: true }
      })
    })
  })
})
