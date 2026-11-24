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
  const state = {
    files,
    tomlFiles,
    storage,
    storeState,
    islandState,
    failWriteSuffix: '',
    failReadPath: '',
    failReadWeb: false,
    failListToml: false,
    listToml: vi.fn(),
    fileWrite: vi.fn(),
    webRead: vi.fn(),
    webWrite: vi.fn(),
    deleteFile: vi.fn()
  }
  return state
})

vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    listTomlFiles: mocks.listToml,
    readFileContent: async (path: string, options?: { throwOnError?: boolean }) => {
      if (path === mocks.failReadPath) {
        if (options?.throwOnError) throw new Error('read failed')
        return ''
      }
      return mocks.files.get(path) ?? ''
    },
    writeFileContent: mocks.fileWrite,
    deleteFileOrDir: mocks.deleteFile,
    readWebConfigList: mocks.webRead,
    writeWebConfigList: mocks.webWrite
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

const makePlan = async (items: RestorePlan['entries']): Promise<RestorePlan> => {
  const { collectLocalBackupValues } = await import('@/features/settings/composables/useAppBackup')
  const { buildBackupManifest } = await import('@/features/settings/lib/backupUtil')
  const { sha256Hex } = await import('@/shared/platform/lockUtil')
  const entries = items.map((entry) => entry.item)
  const manifest = buildBackupManifest({
    mode: 'full',
    categories: [...new Set(entries.map((item) => item.category))],
    items: entries,
    appVersion: 'test'
  })
  const localValues = await collectLocalBackupValues(manifest)
  const plannedEntries = items.map((entry) => {
    const localValue = localValues[entry.item.id] ?? null
    return {
      ...entry,
      localValue,
      localHash: localValue === null ? null : sha256Hex(localValue)
    }
  })
  const counts: RestorePlan['counts'] = { same: 0, new: 0, safe: 0, conflict: 0, invalid: 0 }
  for (const entry of plannedEntries) counts[entry.status] += 1
  mocks.webRead.mockClear()
  return { manifest, entries: plannedEntries, counts }
}

const entry = (item: RestorePlan['entries'][number]['item']) => ({
  item,
  status: 'new' as const,
  localValue: null,
  localHash: null
})

const webValue = (name: string, port = 22020): string =>
  JSON.stringify([
    {
      configFileName: name,
      protocol: 'udp',
      host: '127.0.0.1',
      port,
      userName: 'user'
    }
  ])

describe('useAppBackup（快照与原子恢复）', () => {
  beforeEach(() => {
    mocks.files.clear()
    mocks.tomlFiles.length = 0
    mocks.storage.clear()
    mocks.failWriteSuffix = ''
    mocks.failReadPath = ''
    mocks.failReadWeb = false
    mocks.failListToml = false
    mocks.listToml.mockReset().mockImplementation(async (options?: { throwOnError?: boolean }) => {
      if (mocks.failListToml && options?.throwOnError) throw new Error('list failed')
      return [...mocks.tomlFiles]
    })
    mocks.islandState.settings = {
      enabled: true,
      idle: 'count',
      types: { error: true, update: true, quality: true, feedback: true },
      silent: false,
      motion: 'system',
      face: true
    }
    vi.clearAllMocks()
    mocks.fileWrite.mockReset().mockImplementation(async (path: string, value: string) => {
      if (mocks.failWriteSuffix && path.endsWith(mocks.failWriteSuffix)) {
        throw new Error('write failed')
      }
      mocks.files.set(path, value)
    })
    mocks.webRead.mockReset().mockImplementation(async () => {
      if (mocks.failReadWeb) throw new Error('web read failed')
      const value = mocks.files.get('config/data.json')
      return value ? JSON.parse(value) : []
    })
    mocks.webWrite.mockReset().mockImplementation(async (list: unknown[]) => {
      mocks.files.set('config/data.json', JSON.stringify(list))
    })
    mocks.deleteFile.mockReset().mockImplementation(async (path: string) => {
      mocks.files.delete(path)
    })
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

  it('生成恢复计划等待普通 TOML 事务结束', async () => {
    const { runTomlTransaction } = await import('@/shared/platform/webConfigStorage')
    const { createRestorePlan } = await import('@/features/settings/composables/useAppBackup')
    const { buildBackupManifest, createBackupItem } =
      await import('@/features/settings/lib/backupUtil')
    const item = createBackupItem('configs', 'a.toml', '[network]\ninstance_name = "new"')
    const manifest = buildBackupManifest({
      mode: 'full',
      categories: ['configs'],
      items: [item],
      appVersion: 'test'
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = runTomlTransaction(() => gate)
    const planning = createRestorePlan(manifest)
    await Promise.resolve()
    expect(mocks.listToml).not.toHaveBeenCalled()
    release()
    await Promise.all([transaction, planning])
    expect(mocks.listToml).toHaveBeenCalled()
  })

  it('恢复计划生成后文件变化，应用前检测漂移并中止写入', async () => {
    const { applyRestore, createRestorePlan } =
      await import('@/features/settings/composables/useAppBackup')
    const { buildBackupManifest, createBackupItem } =
      await import('@/features/settings/lib/backupUtil')
    const item = createBackupItem('configs', 'a.toml', '[network]\ninstance_name = "new"')
    const manifest = buildBackupManifest({
      mode: 'full',
      categories: ['configs'],
      items: [item],
      appVersion: 'test'
    })
    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'PLAN')
    const plan = await createRestorePlan(manifest)
    mocks.files.set('config/a.toml', 'CHANGED')

    await expect(applyRestore(plan, { [item.id]: 'backup' })).rejects.toThrow(
      'restore_plan_changed'
    )
    expect(mocks.fileWrite).not.toHaveBeenCalled()
  })

  it('后续条目写入失败时，已写入的配置文件恢复为原内容', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')
    mocks.failWriteSuffix = 'b.toml'

    const plan = await makePlan([
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

    const plan = await makePlan([entry(createBackupItem('configs', 'a.toml', 'NEW'))])
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
    mocks.fileWrite.mockImplementationOnce(async () => {
      throw new Error('write failed')
    })

    const plan = await makePlan([
      entry(createBackupItem('preferences', '', preferences)),
      entry(createBackupItem('configs', 'a.toml', 'NEW'))
    ])
    const result = await applyRestore(plan, { preferences: 'backup', 'config:a.toml': 'backup' })

    expect(result).toEqual({ applied: 0, failed: ['config:a.toml'], rolledBack: true })
    expect(mocks.islandState.$patch).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enabled: true, idle: 'count', motion: 'system' })
    })
  })

  it('偏好回滚精确恢复原始 service-config 全集，包括损坏和空记录', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    const original = new Map([
      ['service-config:valid', '{"installMethod":"official"}'],
      ['service-config:broken', '{not-json'],
      ['service-config:empty', ''],
      ['service-config:../unusual', 'null']
    ])
    for (const [key, value] of original) mocks.storage.set(key, value)
    const preferences = JSON.stringify({
      version: 1,
      store: {},
      local: {},
      serviceConfigs: {}
    })
    mocks.tomlFiles.push('a.toml')
    mocks.fileWrite.mockImplementationOnce(async () => {
      throw new Error('write failed')
    })
    const plan = await makePlan([
      entry(createBackupItem('preferences', '', preferences)),
      entry(createBackupItem('configs', 'a.toml', '[network]\ninstance_name = "new"'))
    ])

    const result = await applyRestore(plan, { preferences: 'backup', 'config:a.toml': 'backup' })

    expect(result.rolledBack).toBe(true)
    expect(Object.fromEntries(mocks.storage)).toEqual(Object.fromEntries(original))
  })

  it('偏好回滚精确恢复原始本地键，包含 legacy autoRun、空串和缺失状态', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    const original = new Map([
      ['settings.minimizeOnStart', ''],
      ['settings.autoRunNetwork', 'false'],
      ['settings.autoRunConfigName', 'legacy-node']
    ])
    for (const [key, value] of original) mocks.storage.set(key, value)
    const preferences = JSON.stringify({
      version: 1,
      store: {},
      local: {
        'settings.minimizeOnStart': 'true',
        'settings.onboardingDone': 'true',
        'settings.autoRunNetwork': 'true',
        'settings.autoRunConfigName': 'backup-node'
      },
      serviceConfigs: {}
    })
    mocks.tomlFiles.push('a.toml')
    mocks.fileWrite.mockImplementationOnce(async () => {
      throw new Error('write failed')
    })
    const plan = await makePlan([
      entry(createBackupItem('preferences', '', preferences)),
      entry(createBackupItem('configs', 'a.toml', '[network]\ninstance_name = "new"'))
    ])

    const result = await applyRestore(plan, { preferences: 'backup', 'config:a.toml': 'backup' })

    expect(result).toEqual({ applied: 0, failed: ['config:a.toml'], rolledBack: true })
    expect(Object.fromEntries(mocks.storage)).toEqual(Object.fromEntries(original))
    expect(mocks.storage.has('settings.onboardingDone')).toBe(false)
  })

  it('偏好正常恢复仍将 legacy autoRun 迁入 store 并清除旧本地键', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    mocks.storage.set('settings.autoRunNetwork', 'false')
    mocks.storage.set('settings.autoRunConfigName', 'legacy-node')
    const preferences = JSON.stringify({
      version: 1,
      store: {},
      local: {
        'settings.autoRunNetwork': 'true',
        'settings.autoRunConfigName': 'backup-node'
      },
      serviceConfigs: {}
    })
    const plan = await makePlan([entry(createBackupItem('preferences', '', preferences))])

    const result = await applyRestore(plan, { preferences: 'backup' })

    expect(result).toEqual({ applied: 1, failed: [], rolledBack: false })
    expect(mocks.storeState.$patch).toHaveBeenCalledWith(
      expect.objectContaining({ autoRunNetworkSetting: true, autoRunConfigName: 'backup-node' })
    )
    expect(mocks.storage.has('settings.autoRunNetwork')).toBe(false)
    expect(mocks.storage.has('settings.autoRunConfigName')).toBe(false)
  })

  it('当前条目部分写入后失败也会恢复原内容', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')
    mocks.fileWrite.mockImplementationOnce(async (path: string, value: string) => {
      mocks.files.set(path, value)
      throw new Error('partial write failed')
    })

    const plan = await makePlan([entry(createBackupItem('configs', 'a.toml', 'NEW'))])
    const result = await applyRestore(plan, { 'config:a.toml': 'backup' })

    expect(result).toEqual({ applied: 0, failed: ['config:a.toml'], rolledBack: true })
    expect(mocks.files.get('config/a.toml')).toBe('OLD')
  })

  it('配置快照读取失败时在任何写入前抛错', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')

    const plan = await makePlan([entry(createBackupItem('configs', 'a.toml', 'NEW'))])
    mocks.failReadPath = 'config/a.toml'
    await expect(applyRestore(plan, { 'config:a.toml': 'backup' })).rejects.toThrow('read failed')
    expect(mocks.fileWrite).not.toHaveBeenCalled()
    expect(mocks.files.get('config/a.toml')).toBe('OLD')
  })

  it('Web 快照读取失败时在任何写入前抛错', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')

    const plan = await makePlan([
      entry(createBackupItem('configs', 'a.toml', 'NEW')),
      entry(createBackupItem('web', '', webValue('restored')))
    ])
    mocks.failReadWeb = true
    await expect(applyRestore(plan, { 'config:a.toml': 'backup', web: 'backup' })).rejects.toThrow(
      'web read failed'
    )
    expect(mocks.fileWrite).not.toHaveBeenCalled()
    expect(mocks.webWrite).not.toHaveBeenCalled()
    expect(mocks.files.get('config/a.toml')).toBe('OLD')
  })

  it('Web 漂移检查与恢复共用队列，检查后抢先的页面修改不会丢失', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    const { mutateWebConfigList } = await import('@/shared/platform/webConfigStorage')

    mocks.files.set('config/data.json', webValue('home'))
    const plan = await makePlan([entry(createBackupItem('web', '', webValue('restored')))])
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.webRead.mockImplementationOnce(async () => {
      await gate
      return JSON.parse(webValue('home'))
    })

    const restore = applyRestore(plan, { web: 'backup' })
    await vi.waitFor(() => expect(mocks.webRead).toHaveBeenCalledTimes(1))
    const update = mutateWebConfigList((list) => {
      list[0].port = 12000
    })
    await Promise.resolve()
    const readsWhileCheckPending = mocks.webRead.mock.calls.length

    release()
    const [result] = await Promise.all([restore, update])

    expect(readsWhileCheckPending).toBe(1)
    expect(result).toEqual({ applied: 1, failed: [], rolledBack: false })
    expect(JSON.parse(mocks.files.get('config/data.json') ?? '[]')).toEqual([
      expect.objectContaining({ configFileName: 'restored', port: 12000 })
    ])
  })

  it('Web 恢复从快照到应用全程占用共享队列，页面修改不丢失', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    const { mutateWebConfigList } = await import('@/shared/platform/webConfigStorage')

    mocks.files.set('config/data.json', webValue('home'))
    const plan = await makePlan([entry(createBackupItem('web', '', webValue('restored')))])
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.webRead.mockImplementationOnce(async () => {
      await gate
      return JSON.parse(webValue('home'))
    })

    const restore = applyRestore(plan, { web: 'backup' })
    await vi.waitFor(() => expect(mocks.webRead).toHaveBeenCalledTimes(1))
    const update = mutateWebConfigList((list) => {
      list[0].port = 12000
    })
    await Promise.resolve()
    const readsWhileSnapshotPending = mocks.webRead.mock.calls.length

    release()
    await Promise.all([restore, update])

    expect(readsWhileSnapshotPending).toBe(1)
    expect(JSON.parse(mocks.files.get('config/data.json') ?? '[]')).toEqual([
      expect.objectContaining({ configFileName: 'restored', port: 12000 })
    ])
  })

  it('Web 回滚全程占用共享队列，页面修改不丢失', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')
    const { mutateWebConfigList } = await import('@/shared/platform/webConfigStorage')

    mocks.files.set('config/data.json', webValue('home'))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.fileWrite.mockImplementationOnce(async () => {
      await gate
      throw new Error('write failed')
    })

    const plan = await makePlan([
      entry(createBackupItem('web', '', webValue('restored'))),
      entry(createBackupItem('configs', 'b.toml', 'B'))
    ])
    const restore = applyRestore(plan, { web: 'backup', 'config:b.toml': 'backup' })
    await vi.waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledTimes(1))
    const update = mutateWebConfigList((list) => {
      list[0].port = 12000
    })
    await Promise.resolve()
    const readsWhileRollbackPending = mocks.webRead.mock.calls.length

    release()
    const [result] = await Promise.all([restore, update])

    expect(readsWhileRollbackPending).toBe(2)
    expect(result).toEqual({ applied: 0, failed: ['config:b.toml'], rolledBack: true })
    expect(JSON.parse(mocks.files.get('config/data.json') ?? '[]')).toEqual([
      expect.objectContaining({ configFileName: 'home', port: 12000 })
    ])
  })

  it('空 Web 表回滚通过队列写回空数组，不直接删除 data.json', async () => {
    const { applyRestore } = await import('@/features/settings/composables/useAppBackup')
    const { createBackupItem } = await import('@/features/settings/lib/backupUtil')

    mocks.files.set('config/data.json', '[]')
    mocks.failWriteSuffix = 'b.toml'
    const plan = await makePlan([
      entry(createBackupItem('web', '', webValue('restored'))),
      entry(createBackupItem('configs', 'b.toml', 'B'))
    ])

    const result = await applyRestore(plan, { web: 'backup', 'config:b.toml': 'backup' })

    expect(result).toEqual({ applied: 0, failed: ['config:b.toml'], rolledBack: true })
    expect(mocks.files.get('config/data.json')).toBe('[]')
    expect(mocks.deleteFile).not.toHaveBeenCalledWith('config/data.json')
    expect(mocks.webWrite).toHaveBeenLastCalledWith([])
  })

  it('备份采集遇到配置目录列举失败时抛错，不生成空快照', async () => {
    const { collectBackupItems } = await import('@/features/settings/composables/useAppBackup')

    mocks.failListToml = true
    await expect(collectBackupItems(['configs'])).rejects.toThrow('list failed')
  })

  it('备份内容计数遇到配置目录列举失败时也抛错', async () => {
    const { getBackupContentCounts } = await import('@/features/settings/composables/useAppBackup')
    mocks.failListToml = true

    await expect(getBackupContentCounts()).rejects.toThrow('list failed')
  })

  it('备份采集的配置读取失败时抛出，不生成空快照', async () => {
    const { collectBackupItems } = await import('@/features/settings/composables/useAppBackup')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')
    mocks.failReadPath = 'config/a.toml'

    await expect(collectBackupItems(['configs'])).rejects.toThrow('read failed')
  })

  it('恢复对照的配置读取失败时抛出，不按不存在处理', async () => {
    const { collectLocalBackupValues } =
      await import('@/features/settings/composables/useAppBackup')
    const { buildBackupManifest } = await import('@/features/settings/lib/backupUtil')

    mocks.tomlFiles.push('a.toml')
    mocks.files.set('config/a.toml', 'OLD')
    mocks.failReadPath = 'config/a.toml'
    const manifest = buildBackupManifest({
      mode: 'full',
      categories: ['configs'],
      items: [],
      appVersion: 'test'
    })

    await expect(collectLocalBackupValues(manifest)).rejects.toThrow('read failed')
  })

  it('备份采集的 Web 读取失败时抛出，不生成空快照', async () => {
    const { collectBackupItems } = await import('@/features/settings/composables/useAppBackup')

    mocks.failReadWeb = true
    await expect(collectBackupItems(['web'])).rejects.toThrow('web read failed')
  })

  it('备份采集的 Web 快照也占用共享队列，避免与页面修改交错', async () => {
    const { collectBackupItems } = await import('@/features/settings/composables/useAppBackup')
    const { mutateWebConfigList } = await import('@/shared/platform/webConfigStorage')

    mocks.files.set('config/data.json', webValue('home'))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.webRead.mockImplementationOnce(async () => {
      await gate
      return JSON.parse(webValue('home'))
    })

    const collection = collectBackupItems(['web'])
    await vi.waitFor(() => expect(mocks.webRead).toHaveBeenCalledTimes(1))
    const update = mutateWebConfigList((list) => {
      list[0].port = 12000
    })
    await Promise.resolve()
    const readsWhileSnapshotPending = mocks.webRead.mock.calls.length

    release()
    const [items] = await Promise.all([collection, update])

    expect(readsWhileSnapshotPending).toBe(1)
    expect(JSON.parse(items[0].value)).toEqual([
      expect.objectContaining({ configFileName: 'home', port: 22020 })
    ])
    expect(JSON.parse(mocks.files.get('config/data.json') ?? '[]')).toEqual([
      expect.objectContaining({ configFileName: 'home', port: 12000 })
    ])
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
    const plan = await makePlan([entry(createBackupItem('preferences', '', preferences))])
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
