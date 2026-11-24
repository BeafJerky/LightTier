/**
 * useCoreInstall 单测（M-05 回归）
 *
 * 内核切换顺序：校验安装包 → 停服务/节点 → 备份旧内核 → 解压；
 * 解压失败必须恢复旧内核，备份失败不得继续解压。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCoreInstall } from '@/shared/composables/useCoreInstall'
import zhCN from '@/shared/i18n/locales/zh-CN'
import en from '@/shared/i18n/locales/en'

const state = vi.hoisted(() => ({ order: [] as string[] }))
const i18n = vi.hoisted(() => ({ t: vi.fn((key: string) => key) }))
const trustedPackageSha256 = 'a'.repeat(64)

const storeMock = vi.hoisted(() => ({
  configList: [] as { configFileName: string }[],
  configWebList: [] as { configFileName: string }[],
  loadConfigFiles: vi.fn(async () => {}),
  loadWebConfigFiles: vi.fn(async () => {}),
  setRunningList: vi.fn(),
  setStartQueue: vi.fn(),
  stopLoop: false,
  detectCoreVersion: vi.fn(async (): Promise<string | null> => 'v2.7.1')
}))

const files = vi.hoisted(() => ({
  backupCoreExecutables: vi.fn(async (): Promise<string | null> => 'resource/core-previous-test'),
  restoreCoreExecutables: vi.fn(async () => true),
  discardCoreBackup: vi.fn(async () => {}),
  extractFile: vi.fn(async () => true)
}))

const ops = vi.hoisted(() => ({
  verifyCorePackage: vi.fn(async (): Promise<string> => trustedPackageSha256),
  verifyCoreFiles: vi.fn(async () => {}),
  stopAllNodes: vi.fn(async () => {}),
  checkService: vi.fn(async () => 'stopped'),
  stopService: vi.fn(async () => {}),
  checkWebService: vi.fn(async () => 'notInstalled'),
  stopWebService: vi.fn(async () => {})
}))

vi.mock('vue-i18n', () => ({ useI18n: () => i18n }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/path', () => ({
  join: async (...parts: string[]) => parts.join('/'),
  resourceDir: async () => '/app'
}))
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn() }))
vi.mock('@/shared/store/easytier', () => ({ useEasyTierStore: () => storeMock }))
vi.mock('@/shared/platform/fileUtil', () => files)
vi.mock('@/shared/platform/systemOps', () => ops)
vi.mock('@/shared/platform/shellUtil', () => ({ stopAllNodes: ops.stopAllNodes }))
vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    checkService: ops.checkService,
    stopService: ops.stopService,
    checkWebService: ops.checkWebService,
    stopWebService: ops.stopWebService
  })
}))
vi.mock('@/shared/platform/platformUtil', () => ({ isAndroid: () => false }))
vi.mock('@/shared/platform/sysUtil', () => ({
  getOsType: () => 'windows',
  getArch: () => 'x86_64'
}))

beforeEach(() => {
  vi.resetAllMocks()
  i18n.t.mockImplementation((key: string) => key)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.order = []
  storeMock.configList = []
  storeMock.configWebList = []
  storeMock.detectCoreVersion.mockImplementation(async () => {
    state.order.push('detect')
    return 'v2.7.1'
  })
  ops.verifyCorePackage.mockImplementation(async () => {
    state.order.push('verify')
    return trustedPackageSha256
  })
  ops.verifyCoreFiles.mockImplementation(async () => {
    state.order.push('verifyFiles')
  })
  ops.checkService.mockResolvedValue('stopped')
  ops.checkWebService.mockResolvedValue('notInstalled')
  ops.stopAllNodes.mockImplementation(async () => {
    state.order.push('stopNodes')
  })
  files.backupCoreExecutables.mockImplementation(async () => {
    state.order.push('backup')
    return 'resource/core-previous-test'
  })
  files.extractFile.mockImplementation(async () => {
    state.order.push('extract')
    return true
  })
  files.restoreCoreExecutables.mockImplementation(async () => {
    state.order.push('restore')
    return true
  })
  files.discardCoreBackup.mockImplementation(async () => {
    state.order.push('discard')
  })
})

describe('installCore', () => {
  it('校验安装包先于停服务；文件校验和版本探测成功后才丢弃备份', async () => {
    const { installCore } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(true)

    expect(state.order).toEqual([
      'verify',
      'stopNodes',
      'backup',
      'extract',
      'verifyFiles',
      'detect',
      'discard'
    ])
    expect(files.restoreCoreExecutables).not.toHaveBeenCalled()
    expect(storeMock.detectCoreVersion).toHaveBeenCalledTimes(1)
    // 安装包路径按平台/架构生成（常量拼接，不用模板引擎）
    expect(files.extractFile).toHaveBeenCalledWith(
      'resource/core/easytier-windows-x86_64-v2.7.0.zip',
      'resource/core',
      false,
      expect.any(Function),
      trustedPackageSha256
    )
  })

  it('安装包校验失败时不改变运行状态', async () => {
    ops.verifyCorePackage.mockRejectedValueOnce(new Error('SHA-256 不匹配'))
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(lastInstallError.value).toBe('SHA-256 不匹配')
    expect(storeMock.loadConfigFiles).not.toHaveBeenCalled()
    expect(ops.stopAllNodes).not.toHaveBeenCalled()
    expect(files.backupCoreExecutables).not.toHaveBeenCalled()
    expect(files.extractFile).not.toHaveBeenCalled()
  })

  it('解压失败时恢复旧内核，且不丢弃备份', async () => {
    files.extractFile.mockImplementation(async () => {
      state.order.push('extract')
      return false
    })
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(state.order).toEqual(['verify', 'stopNodes', 'backup', 'extract', 'restore'])
    expect(lastInstallError.value).toBe('newSettings.coreExtractFailed')
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
    expect(storeMock.detectCoreVersion).not.toHaveBeenCalled()
  })

  it('无旧内核时继续首次安装，不恢复也不丢弃备份', async () => {
    files.backupCoreExecutables.mockResolvedValueOnce(null)
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(true)

    expect(lastInstallError.value).toBe('')
    expect(files.extractFile).toHaveBeenCalledTimes(1)
    expect(files.restoreCoreExecutables).not.toHaveBeenCalled()
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('无旧内核且解压失败时不尝试恢复备份', async () => {
    files.backupCoreExecutables.mockResolvedValueOnce(null)
    files.extractFile.mockResolvedValueOnce(false)
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(lastInstallError.value).toBe('newSettings.coreExtractFailed')
    expect(files.restoreCoreExecutables).not.toHaveBeenCalled()
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('备份失败时给出 i18n 错误，不恢复旧会话备份，且不再解压', async () => {
    files.backupCoreExecutables.mockRejectedValueOnce(new Error('backup denied'))
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(lastInstallError.value).toBe('newSettings.coreBackupFailed')
    expect(files.extractFile).not.toHaveBeenCalled()
    expect(files.restoreCoreExecutables).not.toHaveBeenCalled()
  })

  it('备份回滚失败时显示人工恢复路径并停止安装', async () => {
    const backupPath = 'resource/core-previous-test'
    files.backupCoreExecutables.mockRejectedValueOnce(
      Object.assign(new Error('core_backup_rollback_failed'), {
        code: 'core_backup_rollback_failed',
        backupPath
      })
    )
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(i18n.t).toHaveBeenCalledWith('newSettings.coreBackupRollbackFailed', {
      path: backupPath
    })
    expect(lastInstallError.value).toBe('newSettings.coreBackupRollbackFailed')
    expect(files.extractFile).not.toHaveBeenCalled()
    expect(files.restoreCoreExecutables).not.toHaveBeenCalled()
  })

  it('解压抛错时也恢复本次备份', async () => {
    files.extractFile.mockRejectedValueOnce(new Error('disk full'))
    const { installCore } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(files.restoreCoreExecutables).toHaveBeenCalledWith('resource/core-previous-test')
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('解压与恢复都失败时给出含备份路径的回滚失败提示', async () => {
    files.extractFile.mockResolvedValueOnce(false)
    files.restoreCoreExecutables.mockResolvedValueOnce(false)
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(i18n.t).toHaveBeenCalledWith('newSettings.installRollbackFail', {
      path: 'resource/core-previous-test'
    })
    expect(lastInstallError.value).toBe('newSettings.installRollbackFail')
  })

  it('中英文回滚失败文案包含备份路径参数与未恢复目录日志提示', () => {
    // Vue i18n 插件在测试构建中将字符串编译为带 source 的 AST。
    const messages = [zhCN.newSettings.installRollbackFail, en.newSettings.installRollbackFail]
    for (const message of messages) {
      const source = (message as unknown as { loc: { source: string } }).loc.source
      expect(source).toContain('{path}')
      expect(source).toContain('resource/core-unrestored')
    }
  })

  it.each([null, '', '   '])('版本探测返回 %j 时回滚且不丢弃备份', async (detected) => {
    storeMock.detectCoreVersion.mockImplementationOnce(async () => {
      state.order.push('detect')
      return detected
    })
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(state.order).toEqual([
      'verify',
      'stopNodes',
      'backup',
      'extract',
      'verifyFiles',
      'detect',
      'restore'
    ])
    expect(lastInstallError.value).toBe('newSettings.coreDetectFailed')
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('版本探测抛错时回滚且不丢弃备份', async () => {
    storeMock.detectCoreVersion.mockRejectedValueOnce(new Error('probe failed'))
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(files.restoreCoreExecutables).toHaveBeenCalledWith('resource/core-previous-test')
    expect(lastInstallError.value).toBe('newSettings.coreDetectFailed')
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('解压后文件哈希校验失败时回滚且不探测版本', async () => {
    ops.verifyCoreFiles.mockImplementationOnce(async () => {
      state.order.push('verifyFiles')
      throw new Error('tampered executable')
    })
    const { installCore, lastInstallError } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(false)

    expect(state.order).toEqual([
      'verify',
      'stopNodes',
      'backup',
      'extract',
      'verifyFiles',
      'restore'
    ])
    expect(lastInstallError.value).toBe('newSettings.coreVerifyFailed')
    expect(storeMock.detectCoreVersion).not.toHaveBeenCalled()
    expect(files.discardCoreBackup).not.toHaveBeenCalled()
  })

  it('配置列表中运行中的服务在切换前停止', async () => {
    storeMock.configList = [{ configFileName: 'home' }]
    storeMock.configWebList = [{ configFileName: 'web' }]
    ops.checkService.mockResolvedValue('running')
    ops.checkWebService.mockResolvedValue('running')
    const { installCore } = useCoreInstall()

    await expect(installCore('v2.7.0')).resolves.toBe(true)

    expect(ops.stopService).toHaveBeenCalledWith('home')
    expect(ops.stopWebService).toHaveBeenCalledWith('web')
  })
})
