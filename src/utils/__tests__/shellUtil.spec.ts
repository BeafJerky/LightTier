/**
 * shellUtil 命令层单测（M-04 / M-10 回归）
 *
 * 覆盖：
 * - executeCmd 返回契约：退出码是唯一成功依据（0 + stderr 告警仍为成功；非 0 返回 {code,msg} 结构；异常原样重抛）
 * - getRunningProcesses 平台解析：Windows 单条 JSON 对象归一化、数组解析与 powershell 过滤、
 *   Unix ps 文本行解析（不再必然 JSON.parse 失败）、grep 无匹配返回空数组
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const create = vi.fn((..._args: any[]) => ({ execute }))
  return { execute, create, platform: { current: 'windows' } }
})

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: mocks.create }
}))

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn(async (..._args: any[]) => 'ok') }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
  isTauri: () => true
}))

vi.mock('@tauri-apps/plugin-log', () => ({
  attachConsole: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@/utils/sysUtil', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/utils/sysUtil')>()
  return { ...mod, getPlatform: vi.fn(async () => mocks.platform.current) }
})

const fileMocks = vi.hoisted(() => ({
  // rpc_portal 用于验证 v2.5.0+ 由 CLI 参数补传
  readFileContent: vi.fn(async () => 'rpc_portal = "0.0.0.0:15888"\n'),
  getResourceDir: vi.fn(async () => 'C:/res'),
  getLogsDir: vi.fn(async () => 'C:/res/logs'),
  getKernelLogsDir: vi.fn(
    async (name: string) => `C:/res/logs/kernel/${name.replace(/\.toml$/i, '')}`
  ),
  getWebKernelLogsDir: vi.fn(async () => 'C:/res/logs/kernel/__web__')
}))

vi.mock('@/utils/fileUtil', () => ({
  readFileContent: fileMocks.readFileContent,
  getResourceDir: fileMocks.getResourceDir,
  getLogsDir: fileMocks.getLogsDir,
  getKernelLogsDir: fileMocks.getKernelLogsDir,
  getWebKernelLogsDir: fileMocks.getWebKernelLogsDir,
  getCliDir: vi.fn(async () => 'C:/res/core'),
  getCoreDir: vi.fn(async () => 'C:/res/core/easytier-core.exe')
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  resourceDir: vi.fn(async () => 'C:/res')
}))

import {
  checkServiceWithOfficialCli,
  executeCmd,
  getRunningProcesses,
  installServiceWithOfficialCli,
  runEasyTierCoreWeb,
  uninstallServiceWithOfficialCli
} from '@/utils/shellUtil'

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.create.mockClear()
  tauriMocks.invoke.mockReset()
  // run_command 成功时 Rust 侧返回子进程 PID
  tauriMocks.invoke.mockResolvedValue('4321')
  mocks.platform.current = 'windows'
})

describe('executeCmd 返回契约（M-04）', () => {
  it('退出码 0 且 stderr 有告警 → 视为成功，返回 stdout 字符串', async () => {
    mocks.execute.mockResolvedValue({
      code: 0,
      stdout: 'SERVICE_RUNNING\n',
      stderr: 'warning: noise'
    })
    await expect(executeCmd('nssm', ['status', 'svc'])).resolves.toBe('SERVICE_RUNNING')
  })

  it('退出码 0 且 stdout 为空 → 返回 { code: 0, stdout, stderr } 结构', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: '', stderr: 'note' })
    await expect(executeCmd('taskkill', ['/F', '/PID', '1'])).resolves.toEqual({
      code: 0,
      stdout: '',
      stderr: 'note'
    })
  })

  it('退出码非 0 → 返回 { code, msg, stdout, stderr }，msg 取 stderr', async () => {
    mocks.execute.mockResolvedValue({
      code: 3,
      stdout: '',
      stderr: 'Can not open service! does not exist'
    })
    const res = await executeCmd('nssm', ['status', 'missing'])
    expect(res.code).toBe(3)
    expect(res.msg).toContain('does not exist')
    expect(res.stderr).toContain('does not exist')
  })

  it('退出码为 null（信号终止）按 0 处理，stdout 正常返回', async () => {
    mocks.execute.mockResolvedValue({ code: null, stdout: 'done', stderr: '' })
    await expect(executeCmd('sh', ['-c', 'true'])).resolves.toBe('done')
  })

  it('执行抛错时原样重抛原始异常对象（而非日志函数）', async () => {
    const origin = new Error('spawn failed')
    mocks.execute.mockRejectedValue(origin)
    await expect(executeCmd('nssm', [])).rejects.toBe(origin)
  })
})

describe('getRunningProcesses 平台解析（M-10）', () => {
  it('Windows 单条结果（ConvertTo-Json 输出对象而非数组）也能识别', async () => {
    mocks.execute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        name: 'easytier-core.exe',
        commandLine: 'easytier-core --config-file a.toml',
        path: 'C:\\x\\easytier-core.exe',
        pid: 123,
        memory: 2048
      }),
      stderr: ''
    })
    const list = await getRunningProcesses('easytier-core')
    expect(list).toHaveLength(1)
    expect(list[0].pid).toBe(123)
    expect(list[0].name).toBe('easytier-core.exe')
  })

  it('Windows 多条结果数组正常解析，powershell 自身被过滤', async () => {
    mocks.execute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        { name: 'powershell.exe', commandLine: 'Get-CimInstance easytier-core', pid: 999 },
        { name: 'easytier-core.exe', commandLine: 'easytier-core --config-file a.toml', pid: 124 }
      ]),
      stderr: ''
    })
    const list = await getRunningProcesses('easytier-core')
    expect(list.map((p) => p.pid)).toEqual([124])
  })

  it('Windows 命令成功但输出为空 → 返回空数组', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await expect(getRunningProcesses('easytier-core')).resolves.toEqual([])
  })

  it('macOS/Linux ps 文本输出按行解析（不再必然 JSON.parse 失败）', async () => {
    mocks.platform.current = 'linux'
    mocks.execute.mockResolvedValue({
      code: 0,
      stdout:
        'easytier-core easytier-core --rpc-portal 15888 --config-file /home/u/a.toml 4321 102400\n',
      stderr: ''
    })
    const list = await getRunningProcesses('easytier-core')
    expect(list).toHaveLength(1)
    expect(list[0].pid).toBe(4321)
    expect(list[0].memory).toBe(102400 * 1024)
    expect(list[0].commandLine).toContain('--config-file /home/u/a.toml')
  })

  it('Unix 下 grep 无匹配（sh 退出码 1）→ 返回空数组', async () => {
    mocks.platform.current = 'macos'
    mocks.execute.mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    await expect(getRunningProcesses('easytier-core')).resolves.toEqual([])
  })
})

describe('官方 CLI 服务安装参数按内核版本适配', () => {
  const install = (version: string, disableAutostart?: boolean) =>
    installServiceWithOfficialCli('easytier-a', 'C:/res/config/a.toml', 'a.toml', {
      coreVersion: version,
      disableAutostart
    })

  it('v2.7.0+：core 参数通过 --core-args 传递且位于末尾，--disable-autostart 显式带 true', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: 'success', stderr: '' })
    await expect(install('v2.7.0', true)).resolves.toBe(true)
    const program = mocks.create.mock.calls[0][0] as string
    const args = mocks.create.mock.calls[0][1] as string[]
    expect(program).toBe('easytier-cli')
    expect(args.slice(0, 4)).toEqual(['service', '-n', 'easytier-a', 'install'])
    expect(args).not.toContain('--')
    expect(args).toContain('--disable-autostart')
    expect(args[args.indexOf('--disable-autostart') + 1]).toBe('true')
    // --core-args 必须是最后一个选项，其后全是 core 参数
    const coreIdx = args.indexOf('--core-args')
    expect(coreIdx).toBeGreaterThan(0)
    expect(args.slice(coreIdx + 1)).toEqual([
      '--file-log-dir',
      'C:/res/logs/kernel/a',
      '--file-log-level',
      'info',
      '--file-log-size',
      '10',
      '--file-log-count',
      '10',
      '--config-file',
      'C:/res/config/a.toml',
      '--rpc-portal',
      '0.0.0.0:15888'
    ])
  })

  it('v2.4.5~v2.6.4：core 参数作为 -- 之后的尾随位置参数', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: 'success', stderr: '' })
    await expect(install('v2.6.4')).resolves.toBe(true)
    const args = mocks.create.mock.calls[0][1] as string[]
    expect(args).not.toContain('--core-args')
    const sep = args.indexOf('--')
    expect(sep).toBeGreaterThan(0)
    expect(args[sep + 1]).toBe('--file-log-dir')
    // 未要求禁用自启时不传该选项
    expect(args).not.toContain('--disable-autostart')
  })

  it('安装失败（非 0 退出码）返回 false', async () => {
    mocks.execute.mockResolvedValue({ code: 5, stdout: '', stderr: 'denied' })
    await expect(install('v2.6.4')).resolves.toBe(false)
  })
})

describe('Web 配置启动参数（F-12）', () => {
  it('补齐文件日志参数并使用 Web 专用隔离目录', async () => {
    await expect(runEasyTierCoreWeb('tcp://example.com:11010')).resolves.toBe(4321)
    expect(tauriMocks.invoke).toHaveBeenCalledWith('run_command', {
      program: 'C:/res/core/easytier-core.exe',
      args: [
        '--config-server',
        'tcp://example.com:11010',
        '--file-log-dir',
        'C:/res/logs/kernel/__web__',
        '--file-log-level',
        'info',
        '--file-log-size',
        '10',
        '--file-log-count',
        '10'
      ]
    })
  })

  it('Web 日志目录获取失败时回落到相对 ./logs', async () => {
    fileMocks.getWebKernelLogsDir.mockRejectedValueOnce(new Error('no fs'))
    await runEasyTierCoreWeb('tcp://example.com:11010')
    const args = tauriMocks.invoke.mock.calls[0][1].args as string[]
    expect(args[args.indexOf('--file-log-dir') + 1]).toBe('./logs')
  })

  it('Rust 侧返回非 PID 内容时抛错（不得把失败当成功）', async () => {
    tauriMocks.invoke.mockResolvedValueOnce('ok')
    await expect(runEasyTierCoreWeb('tcp://example.com:11010')).rejects.toThrow()
  })

  it('Rust 侧拒绝（spawn 失败）时原样向上传播', async () => {
    tauriMocks.invoke.mockRejectedValueOnce('启动进程失败: 文件不存在')
    await expect(runEasyTierCoreWeb('tcp://example.com:11010')).rejects.toBe(
      '启动进程失败: 文件不存在'
    )
  })
})

describe('官方 CLI 服务名（-n）与旧版默认名回退', () => {
  it('status 具名服务不存在时回退 CLI 默认名（兼容旧版安装）', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'Service status: not installed', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Service status: Running', stderr: '' })
    await expect(checkServiceWithOfficialCli('easytier-a')).resolves.toBe('SERVICE_RUNNING')
    expect(mocks.create.mock.calls[0][1]).toEqual(['service', '-n', 'easytier-a', 'status'])
    expect(mocks.create.mock.calls[1][1]).toEqual(['service', 'status'])
  })

  it('卸载旧版默认名服务时回退为不带 -n 的命令', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'not installed', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Service status: stopped', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'uninstall success', stderr: '' })
    await expect(uninstallServiceWithOfficialCli('easytier-a')).resolves.toBe(true)
    const calls = mocks.create.mock.calls
    expect(calls[1][1]).toEqual(['service', 'status'])
    expect(calls[2][1]).toEqual(['service', 'uninstall'])
  })
})
