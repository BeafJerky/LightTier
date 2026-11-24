import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBackupManifest, createBackupItem } from '@/features/settings/lib/backupUtil'

const mocks = vi.hoisted(() => ({
  createPlan: vi.fn(),
  applyRestore: vi.fn(),
  warning: vi.fn(),
  error: vi.fn()
}))

vi.mock('@/features/settings/composables/useAppBackup', () => {
  class RestorePlanChangedError extends Error {}
  return {
    RestorePlanChangedError,
    createRestorePlan: mocks.createPlan,
    applyRestore: mocks.applyRestore,
    exportBackup: vi.fn(),
    getBackupContentCounts: vi.fn(),
    pickBackupFile: vi.fn(async () => ({ ok: false, reason: 'unsupported' }))
  }
})

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/ui/useCreamToast', () => ({
  useCreamToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: mocks.warning,
    error: mocks.error
  })
}))

import { useBackupRestore } from '@/features/settings/composables/useBackupRestore'
import { RestorePlanChangedError } from '@/features/settings/composables/useAppBackup'

const manifest = buildBackupManifest({
  mode: 'full',
  categories: ['configs'],
  items: [createBackupItem('configs', 'a.toml', '[network]\ninstance_name = "new"')],
  appVersion: 'test'
})

const makePlan = (localValue: string | null) => ({
  manifest,
  entries: [
    {
      item: manifest.items[0],
      status: localValue === null ? ('new' as const) : ('conflict' as const),
      localValue,
      localHash: localValue === null ? null : `hash-${localValue}`
    }
  ],
  counts: { same: 0, new: 1, safe: 0, conflict: 0, invalid: 0 }
})

describe('useBackupRestore 恢复计划漂移', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应用前发现漂移时自动重新规划并提示用户再次确认', async () => {
    const initialPlan = makePlan(null)
    const freshPlan = makePlan('changed')
    mocks.createPlan.mockResolvedValueOnce(initialPlan).mockResolvedValueOnce(freshPlan)
    mocks.applyRestore.mockRejectedValueOnce(new RestorePlanChangedError())
    const dialog = useBackupRestore()

    await dialog.pickFile('restore')
    await dialog.handleFileInputChange({
      target: {
        files: [{ name: 'backup.json', size: 100, text: async () => JSON.stringify(manifest) }],
        value: ''
      }
    } as unknown as Event)
    dialog.choices.value = { [manifest.items[0].id]: 'backup' }
    await dialog.handleApply()

    expect(mocks.createPlan).toHaveBeenCalledTimes(2)
    expect(dialog.restorePlan.value).toEqual(freshPlan)
    expect(dialog.phase.value).toBe('plan')
    expect(dialog.applying.value).toBe(false)
    expect(mocks.warning).toHaveBeenCalledWith('newBackup.restorePlanChanged')
  })
})
