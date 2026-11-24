import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSettingsUpdate } from '@/features/settings/composables/useSettingsUpdate'
import type { useMirrorProbe } from '@/shared/composables/useMirrorProbe'

const mocks = vi.hoisted(() => ({
  release: null as unknown,
  files: new Map<string, Uint8Array>(),
  downloadFile: vi.fn(),
  readFileContent: vi.fn(),
  listFiles: vi.fn(),
  downloadFromMirrors: vi.fn(),
  invoke: vi.fn(),
  installApk: vi.fn(),
  refreshManagerReleaseInfo: vi.fn(),
  generation: 0,
  island: {
    invalidateManagerUpdate: vi.fn(),
    dismissSource: vi.fn(),
    absorbManagerRelease: vi.fn(),
    notify: vi.fn(),
    beginManagerUpdateCheck: vi.fn(),
    isManagerUpdateCheckCurrent: vi.fn(),
    finishManagerUpdateCheck: vi.fn(),
    markManagerUpdatePresented: vi.fn()
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/ui/useCreamToast', () => ({ useCreamToast: () => mocks.toast }))
vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => ({
    updateStableOnly: true,
    refreshManagerReleaseInfo: mocks.refreshManagerReleaseInfo
  })
}))
vi.mock('@/shared/store/island', () => ({
  useIslandStore: () => mocks.island
}))
vi.mock('@/shared/platform/fileUtil', () => ({
  downloadFile: mocks.downloadFile,
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent
}))
vi.mock('@/shared/platform/sysUtil', () => ({
  getAppVersion: vi.fn(async () => '2.10.4'),
  getOsType: vi.fn(() => 'windows'),
  compareVersions: vi.fn(() => 1)
}))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: mocks.invoke
}))
vi.mock('@tauri-apps/plugin-window-state', () => ({
  saveWindowState: vi.fn(),
  StateFlags: { ALL: 1 }
}))

const PACKAGE = new Uint8Array([0x4d, 0x5a, 1, 2, 3])
const SHA256 = createHash('sha256').update(PACKAGE).digest('hex')
const FILE_NAME = 'LightTier_9.9.9_x64-setup.exe'
const RELEASE = {
  tag_name: 'v9.9.9',
  assets: [
    {
      name: FILE_NAME,
      size: PACKAGE.length,
      digest: `sha256:${SHA256}`,
      browser_download_url: `https://github.com/example/releases/download/v9.9.9/${FILE_NAME}`
    }
  ]
}

const createUpdate = (android = false) => {
  return useSettingsUpdate({
    confirm: vi.fn(async () => true),
    mirror: {
      selected: ref('https://mirror.example/'),
      probing: ref(false),
      downloadFromMirrors: mocks.downloadFromMirrors
    } as unknown as ReturnType<typeof useMirrorProbe>,
    isDesktopRuntime: true,
    isAndroidPlatform: android
  })
}

describe('useSettingsUpdate 安装包完整性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.release = RELEASE
    mocks.generation = 0
    mocks.refreshManagerReleaseInfo.mockImplementation(async () => [mocks.release])
    mocks.island.invalidateManagerUpdate.mockImplementation(() => {
      mocks.generation += 1
    })
    mocks.island.beginManagerUpdateCheck.mockImplementation(() => {
      mocks.generation += 1
      return mocks.generation
    })
    mocks.island.isManagerUpdateCheckCurrent.mockImplementation(
      (generation: number) => generation === mocks.generation
    )
    mocks.island.finishManagerUpdateCheck.mockReturnValue(true)
    mocks.files.clear()
    mocks.listFiles.mockResolvedValue([FILE_NAME])
    mocks.readFileContent.mockImplementation(async (path: string) => mocks.files.get(path))
    mocks.downloadFile.mockResolvedValue(true)
    mocks.downloadFromMirrors.mockImplementation(
      async (
        _mirror: (base: string) => string,
        download: (...args: unknown[]) => Promise<boolean>
      ) => download('https://mirror.example/package', { lastAttempt: true })
    )
    vi.stubGlobal('window', { LTAndroidInstaller: { installApk: mocks.installApk } })
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
  })

  it('灵动岛缓存失效后，设置页旧请求不得回写版本或安装包', async () => {
    let resolve!: (releases: unknown[]) => void
    mocks.refreshManagerReleaseInfo.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const update = createUpdate()
    await update.loadAppVersion()
    const pending = update.handleCheckUpdate()
    await Promise.resolve()
    mocks.island.invalidateManagerUpdate()
    resolve([RELEASE])
    await pending

    expect(mocks.island.absorbManagerRelease).not.toHaveBeenCalled()
    expect(update.latestManagerVersion.value).toBe('')
    expect(update.updateDownloaded.value).toBe(false)
  })

  it('恢复缓存前重新校验完整包体，匹配才允许安装', async () => {
    mocks.files.set(`resource/update/${FILE_NAME}`, PACKAGE)
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()

    await vi.waitFor(() => expect(update.updateDownloaded.value).toBe(true))
    expect(mocks.readFileContent).toHaveBeenCalledWith(
      `resource/update/${FILE_NAME}`,
      expect.objectContaining({ asBinary: true, throwOnError: true })
    )
  })

  it('缓存包被同长度篡改时不得进入可安装状态', async () => {
    mocks.files.set(`resource/update/${FILE_NAME}`, new Uint8Array([0x4d, 0x5a, 9, 8, 7]))
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()

    await vi.waitFor(() => expect(mocks.readFileContent).toHaveBeenCalled())
    expect(update.updateDownloaded.value).toBe(false)
  })

  it('缓存读取失败时保留下载态，不误报安装包可用', async () => {
    mocks.readFileContent.mockRejectedValue(new Error('I/O failed'))
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()

    await vi.waitFor(() => expect(mocks.readFileContent).toHaveBeenCalled())
    expect(update.updateDownloaded.value).toBe(false)
  })

  it('每个镜像候选下载都携带官方摘要，篡改或半包不会落盘', async () => {
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()
    await vi.waitFor(() => expect(update.hasManagerUpdate.value).toBe(true))
    await update.handleDownloadManagerUpdate()

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ expectedSha256: SHA256 })
    )
  })

  it('桌面启动安装器只传文件名，摘要由后端重新获取', async () => {
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()
    await vi.waitFor(() => expect(update.hasManagerUpdate.value).toBe(true))
    update.updateDownloaded.value = true
    await update.handleRunManagerInstaller()

    expect(mocks.invoke).toHaveBeenCalledWith('launch_update_installer', {
      installer: FILE_NAME
    })
    expect(mocks.invoke.mock.calls[0][1]).not.toHaveProperty('expectedSha256')
  })

  it('旧版本下载完成时不得覆盖重新检查后的新版本状态', async () => {
    let finishOldDownload!: (ok: boolean) => void
    mocks.downloadFromMirrors.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishOldDownload = resolve
        })
    )
    const update = createUpdate()
    await update.loadAppVersion()
    await update.handleCheckUpdate()
    const oldDownload = update.handleDownloadManagerUpdate()

    mocks.release = {
      tag_name: 'v10.0.0',
      assets: [{ ...RELEASE.assets[0], name: 'LightTier_10.0.0_x64-setup.exe' }]
    }
    await update.handleCheckUpdate()
    finishOldDownload(true)
    await oldDownload

    expect(update.latestManagerVersion.value).toBe('v10.0.0')
    expect(update.updateDownloaded.value).toBe(false)
    expect(update.updating.value).toBe(false)
    expect(mocks.toast.success).not.toHaveBeenCalledWith(expect.stringContaining('resource/update'))
  })

  it('Android 启动安装器只传文件名，摘要由原生重新获取', async () => {
    const fileName = 'LightTier_9.9.9_arm64-release-signed.apk'
    mocks.release = {
      tag_name: 'v9.9.9',
      assets: [
        {
          ...RELEASE.assets[0],
          name: fileName,
          browser_download_url: `https://example/${fileName}`
        }
      ]
    }
    mocks.installApk.mockReturnValue('started')
    const update = createUpdate(true)
    await update.loadAppVersion()
    await update.handleCheckUpdate()
    await vi.waitFor(() => expect(update.hasManagerUpdate.value).toBe(true))
    update.updateDownloaded.value = true
    await update.handleRunManagerInstaller()

    expect(mocks.installApk).toHaveBeenCalledWith(fileName)
    expect(mocks.installApk.mock.calls[0]).toHaveLength(1)
  })
})
