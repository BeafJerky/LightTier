import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }))
const shell = vi.hoisted(() => ({
  detectServiceInstallMethod: vi.fn(),
  checkServiceOnWindows: vi.fn(),
  checkServiceWithOfficialCli: vi.fn(),
  uninstallServiceOnWindows: vi.fn(),
  uninstallServiceWithOfficialCli: vi.fn()
}))

const files = vi.hoisted(() => ({
  exists: vi.fn(),
  read: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: runtime.isTauri }))
vi.mock('@/shared/platform/shellUtil', () => shell)
vi.mock('@/shared/platform/fileUtil', () => ({
  fileExists: files.exists,
  readFileContent: files.read
}))

import { useMockData } from '@/shared/platform/mockData'

beforeEach(() => {
  vi.clearAllMocks()
  runtime.isTauri.mockReturnValue(true)
  shell.detectServiceInstallMethod.mockResolvedValue('none')
  shell.uninstallServiceOnWindows.mockResolvedValue(true)
  shell.uninstallServiceWithOfficialCli.mockResolvedValue(true)
  files.exists.mockResolvedValue(true)
  files.read.mockResolvedValue('[]')
})

describe('useMockData Web 配置读取', () => {
  it('data.json 不存在时返回空列表且不读取内容', async () => {
    files.exists.mockResolvedValue(false)
    await expect(useMockData().readWebConfigList()).resolves.toEqual([])
    expect(files.read).not.toHaveBeenCalled()
  })

  it('data.json 存在但为空白时抛错，不伪装成空列表', async () => {
    files.read.mockResolvedValue(' \n\t ')
    await expect(useMockData().readWebConfigList()).rejects.toThrow('invalid_web_config_list')
  })

  it('有效 data.json 剔除持久化的运行态', async () => {
    files.read.mockResolvedValue(
      JSON.stringify([{ configFileName: 'home', status: 'running', pid: 10 }])
    )
    await expect(useMockData().readWebConfigList()).resolves.toEqual([{ configFileName: 'home' }])
  })
})

describe('useMockData 服务状态与卸载分发', () => {
  it('普通与 Web 的 NSSM 未知状态都映射为 unknown，而不是未安装', async () => {
    shell.detectServiceInstallMethod.mockResolvedValue('nssm')
    shell.checkServiceOnWindows.mockResolvedValue(null)
    const api = useMockData()

    await expect(api.checkService('home')).resolves.toBe('unknown')
    await expect(api.checkWebService('home')).resolves.toBe('unknown')
  })

  it('正常 NSSM 状态文本与确认不存在保持既有映射', async () => {
    shell.detectServiceInstallMethod.mockResolvedValue('nssm')
    shell.checkServiceOnWindows
      .mockResolvedValueOnce('SERVICE_STOPPED')
      .mockResolvedValueOnce(false)
    const api = useMockData()

    await expect(api.checkService('home')).resolves.toBe('stopped')
    await expect(api.checkWebService('home')).resolves.toBe('notInstalled')
  })

  it('普通服务检测未知或不存在时不再回退 NSSM 卸载', async () => {
    const api = useMockData()

    shell.detectServiceInstallMethod.mockResolvedValueOnce('unknown').mockResolvedValueOnce('none')
    await expect(api.uninstallService('home')).resolves.toBe(false)
    await expect(api.uninstallService('home')).resolves.toBe(false)
    expect(shell.uninstallServiceOnWindows).not.toHaveBeenCalled()
    expect(shell.uninstallServiceWithOfficialCli).not.toHaveBeenCalled()
  })
})
