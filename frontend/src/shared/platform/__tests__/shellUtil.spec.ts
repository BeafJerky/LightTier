/**
 * shellUtil 命令层单测（M-04 / M-10 回归）
 *
 * 覆盖：
 * - 服务与 CLI 经 Rust 受控执行（systemOps），测试只校验参数透传与状态轮询
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

const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@tauri-apps/plugin-log', () => ({
  attachConsole: vi.fn(),
  ...logMocks
}))

vi.mock('@/shared/i18n/t', () => ({
  t: (key: string, params?: { name?: string }) => `${key}:${params?.name ?? ''}`
}))

vi.mock('@/shared/platform/sysUtil', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/shared/platform/sysUtil')>()
  return {
    ...mod,
    getPlatform: vi.fn(async () => mocks.platform.current),
    // 服务状态轮询在测试中不等待真实时间
    sleep: vi.fn(async () => {})
  }
})

const sysopsMocks = vi.hoisted(() => ({
  listProcesses: vi.fn(),
  killProcess: vi.fn()
}))

vi.mock('@/shared/platform/systemOps', () => {
  // 复刻已删除的 executeCmd 返回契约，保持既有服务/CLI 断言有效
  const toResult = async (program: string, args: string[]) => {
    const output = await mocks.create(program, args).execute()
    const code = output?.code ?? 0
    const stdout = output?.stdout || ''
    const stderr = output?.stderr || ''
    if (code !== 0) {
      return {
        code,
        msg: stderr.trim() || stdout.trim() || String(output),
        stdout: stdout.trim(),
        stderr: stderr.trim()
      }
    }
    return stdout.trim() || { code: 0, stdout: '', stderr: stderr.trim() }
  }
  return {
    listProcesses: sysopsMocks.listProcesses,
    killProcess: sysopsMocks.killProcess,
    runNssmCommand: (args: string[]) => toResult('nssm', args),
    runCliCommand: (args: string[]) => toResult('easytier-cli', args)
  }
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

vi.mock('@/shared/platform/fileUtil', () => ({
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
  buildCoreArgsList,
  buildServiceAppParameters,
  checkServiceOnWindows,
  checkServiceWithOfficialCli,
  detectServiceInstallMethod,
  getRunningProcesses,
  killProcess,
  installServiceOnWindows,
  installServiceWithOfficialCli,
  runEasyTierCoreWeb,
  startServiceOnWindows,
  startServiceWithOfficialCli,
  uninstallServiceOnWindows,
  uninstallServiceWithOfficialCli
} from '@/shared/platform/shellUtil'

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.create.mockClear()
  tauriMocks.invoke.mockReset()
  Object.values(logMocks).forEach((fn) => fn.mockClear())
  sysopsMocks.listProcesses.mockReset()
  sysopsMocks.killProcess.mockReset()
  // run_command 成功时 Rust 侧返回子进程 PID
  tauriMocks.invoke.mockResolvedValue('4321')
  mocks.platform.current = 'windows'
})

describe('getRunningProcesses 平台解析（M-10）', () => {
  it('Windows 进程扫描委托 sysops 并补齐 fileName', async () => {
    sysopsMocks.listProcesses.mockResolvedValue([
      {
        name: 'easytier-core.exe',
        commandLine: 'easytier-core --config-file a.toml',
        path: 'C:/x/easytier-core.exe',
        pid: 123,
        memory: 2048
      }
    ])
    const list = await getRunningProcesses('easytier-core')
    expect(sysopsMocks.listProcesses).toHaveBeenCalledWith('easytier-core')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ pid: 123, fileName: 'easytier-core' })
  })

  it('Windows 空列表 → 返回空数组', async () => {
    sysopsMocks.listProcesses.mockResolvedValue([])
    await expect(getRunningProcesses('easytier-core')).resolves.toEqual([])
  })

  it('Windows 进程终止委托 sysops', async () => {
    sysopsMocks.killProcess.mockResolvedValue(true)
    await expect(killProcess(42)).resolves.toBe(true)
    expect(sysopsMocks.killProcess).toHaveBeenCalledWith(42)
  })
})

describe('官方 CLI 服务安装参数按内核版本适配', () => {
  const install = (version: string, disableAutostart?: boolean) =>
    installServiceWithOfficialCli('easytier-a', 'C:/res/config/a.toml', 'a.toml', {
      coreVersion: version,
      disableAutostart
    })

  it('v2.7.0+：core 参数通过 --core-args 传递且位于末尾，未禁用自启时安装后恢复自动启动', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: 'success', stderr: '' })
    await expect(install('v2.7.0')).resolves.toBe(true)
    const program = mocks.create.mock.calls[0][0] as string
    const args = mocks.create.mock.calls[0][1] as string[]
    expect(program).toBe('easytier-cli')
    expect(args.slice(0, 4)).toEqual(['service', '-n', 'easytier-a', 'install'])
    expect(args).not.toContain('--')
    expect(args).toContain('--disable-autostart')
    expect(args[args.indexOf('--disable-autostart') + 1]).toBe('true')
    expect(mocks.create.mock.calls[1]).toEqual([
      'nssm',
      ['set', 'easytier-a', 'Start', 'SERVICE_AUTO_START']
    ])
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

  it('v2.4.5~v2.6.4：core 参数作为 -- 之后的尾随位置参数，安装阶段始终禁用自启', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: 'success', stderr: '' })
    await expect(install('v2.6.4')).resolves.toBe(true)
    const args = mocks.create.mock.calls[0][1] as string[]
    expect(args).not.toContain('--core-args')
    const sep = args.indexOf('--')
    expect(sep).toBeGreaterThan(0)
    expect(args[sep + 1]).toBe('--file-log-dir')
    expect(args[args.indexOf('--disable-autostart') + 1]).toBe('true')
  })

  it('用户禁用自启时保持 CLI 安装后的原样，不写 Start', async () => {
    mocks.execute.mockResolvedValue({ code: 0, stdout: 'success', stderr: '' })
    await expect(install('v2.7.0', true)).resolves.toBe(true)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0]).toBe('easytier-cli')
  })

  it('恢复自启失败时返回 false，不把服务安装当成成功', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'success', stderr: '' })
      .mockResolvedValueOnce({ code: 5, stdout: '', stderr: 'access denied' })
    await expect(install('v2.7.0', false)).resolves.toBe(false)
    expect(mocks.create.mock.calls[1][1]).toEqual([
      'set',
      'easytier-a',
      'Start',
      'SERVICE_AUTO_START'
    ])
  })

  it('恢复自启命令异常时返回 false', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'success', stderr: '' })
      .mockRejectedValueOnce(new Error('nssm unavailable'))
    await expect(install('v2.7.0')).resolves.toBe(false)
  })

  it('安装失败（非 0 退出码）返回 false', async () => {
    mocks.execute.mockResolvedValue({ code: 5, stdout: '', stderr: 'denied' })
    await expect(install('v2.6.4')).resolves.toBe(false)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})

describe('内核日志目录（F-07 回归）', () => {
  it('忽略配置中的绝对 file_logger.dir，日志始终写入按配置隔离目录', async () => {
    fileMocks.readFileContent.mockResolvedValueOnce(
      '[file_logger]\nlevel = "error"\ndir = "D:\\\\logs\\\\easytier"\n'
    )
    const args = await buildCoreArgsList('a.toml', 'C:/res/config/a.toml')
    expect(args[args.indexOf('--file-log-dir') + 1]).toBe('C:/res/logs/kernel/a')
    // TOML 的级别仍按原值翻译，只有目录由管理器决定
    expect(args[args.indexOf('--file-log-level') + 1]).toBe('error')
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

describe('服务启动器参数', () => {
  it('首次配置加隐藏入口，重复配置不叠加', () => {
    expect(buildServiceAppParameters('--config-file "C:/res/a.toml"')).toBe(
      '--lighttier-service-core --config-file "C:/res/a.toml"'
    )
    expect(
      buildServiceAppParameters('--lighttier-service-core --config-file "C:/res/a.toml"')
    ).toBe('--lighttier-service-core --config-file "C:/res/a.toml"')
  })

  it('仅完整入口 token 视为已配置，保留 core 原参数', () => {
    expect(buildServiceAppParameters('--lighttier-service-core-extra --x')).toBe(
      '--lighttier-service-core --lighttier-service-core-extra --x'
    )
    expect(buildServiceAppParameters('')).toBe('--lighttier-service-core')
  })

  it.each([' ', '\t'])('ASCII 分隔符 %j 视为完整入口边界', (separator) => {
    const args = `--lighttier-service-core${separator}--x`
    expect(buildServiceAppParameters(args)).toBe(args)
  })

  it.each(['\u00a0', '\u2003', '\u2028', '\u000b', '\u000c', '\ufeff'])(
    'Unicode 空白 %j 不是入口边界，必须补前缀避免启动 GUI',
    (separator) => {
      const args = `--lighttier-service-core${separator}--config-file a.toml`
      expect(buildServiceAppParameters(args)).toBe(`--lighttier-service-core ${args}`)
    }
  )
})

describe('installServiceOnWindows 重装语义（M-04）', () => {
  const appArgs = '--config-server tcp://example.com:11010'
  const snapshot = {
    Application: ['C:/old/easytier-core.exe'],
    AppParameters: ['--config-file old.toml  '],
    AppDirectory: ['C:/old'],
    AppExit: ['Default', 'Restart'],
    Description: ['old description'],
    DisplayName: ['old name'],
    ObjectName: ['LocalSystem'],
    Start: ['SERVICE_DEMAND_START'],
    Type: ['SERVICE_WIN32_OWN_PROCESS']
  }
  const snapshotResult = () => ({ code: 0, stdout: JSON.stringify(snapshot), stderr: '' })

  const nssmCalls = () => mocks.create.mock.calls.map((call) => call[1] as string[])

  it('服务已存在（运行中）时先停止，更新 Application 与 AppParameters 后重新启动', async () => {
    let call = 0
    let startSeen = false
    mocks.execute.mockImplementation(async () => {
      call++
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (call === 1 && args[0] === 'status') {
        return { code: 0, stdout: 'SERVICE_RUNNING', stderr: '' }
      }
      if (args[0] === 'start') {
        startSeen = true
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'status') {
        return { code: 0, stdout: startSeen ? 'SERVICE_RUNNING' : 'SERVICE_STOPPED', stderr: '' }
      }
      if (args[0] === 'snapshot') return snapshotResult()
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(true)

    const calls = nssmCalls()
    expect(calls.some((args) => args[0] === 'install')).toBe(false)
    expect(calls).toContainEqual([
      'set',
      'easytier-a',
      'AppParameters',
      '--lighttier-service-core --config-server tcp://example.com:11010'
    ])
    expect(calls).toContainEqual([
      'set',
      'easytier-a',
      'Application',
      'C:/res/resource/core/easytier-core.exe'
    ])
    expect(calls.some((args) => args[0] === 'stop')).toBe(true)
    expect(calls).toContainEqual(['start', 'easytier-a'])
  })

  it('自定义显示名与描述写入服务配置', async () => {
    let installed = false
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') {
        return installed
          ? { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
          : { code: 3, stdout: '', stderr: 'does not exist' }
      }
      if (args[0] === 'snapshot') return snapshotResult()
      if (args[0] === 'install') installed = true
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(
      installServiceOnWindows('easytierweb-a', appArgs, {
        displayName: 'LightTier Web A',
        description: 'Web 控制台 A'
      })
    ).resolves.toBe(true)

    const calls = nssmCalls()
    expect(calls).toContainEqual(['set', 'easytierweb-a', 'DisplayName', 'LightTier Web A'])
    expect(calls).toContainEqual(['set', 'easytierweb-a', 'Description', 'Web 控制台 A'])
  })

  it('AppParameters 失败时恢复失败键，且不把旧 Application 切成 GUI', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
      if (args[0] === 'snapshot') return snapshotResult()
      if (args[0] === 'set' && args[2] === 'AppParameters') {
        return { code: 5, stdout: '', stderr: 'access denied' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    const calls = nssmCalls()
    expect(calls[1]).toEqual(['snapshot', 'easytier-a'])
    expect(calls[2]).toEqual([
      'set',
      'easytier-a',
      'AppParameters',
      '--lighttier-service-core --config-server tcp://example.com:11010'
    ])
    expect(calls).toContainEqual([
      'restore',
      'easytier-a',
      'AppParameters',
      '--config-file old.toml  '
    ])
    expect(calls.some((args) => args[0] === 'set' && args[2] === 'Application')).toBe(false)
    expect(calls.some((args) => args[0] === 'start')).toBe(false)
    expect(calls.at(-1)).toEqual(['snapshot', 'easytier-a'])
  })

  it('重装失败时按已尝试键逆序恢复并回读快照', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
      if (args[0] === 'snapshot') return snapshotResult()
      if (args[0] === 'set' && args[2] === 'Description') {
        return { code: 5, stdout: '', stderr: 'description rejected' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    const calls = nssmCalls()
    const writes = calls.filter((args) => args[0] === 'set').map((args) => args[2])
    expect(writes).toEqual(['AppParameters', 'AppDirectory', 'AppExit', 'Description'])
    expect(calls.filter((args) => args[0] === 'restore')).toEqual([
      ['restore', 'easytier-a', 'Description', 'old description'],
      ['restore', 'easytier-a', 'AppExit', 'Default', 'Restart'],
      ['restore', 'easytier-a', 'AppDirectory', 'C:/old'],
      ['restore', 'easytier-a', 'AppParameters', '--config-file old.toml  ']
    ])
    expect(calls.at(-1)).toEqual(['snapshot', 'easytier-a'])
    expect(calls.some((args) => args[0] === 'set' && args[2] === 'Application')).toBe(false)
    expect(calls.some((args) => args[0] === 'start')).toBe(false)
  })

  it('ObjectName 快照权限不足时 fail closed，不停机也不写配置', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_RUNNING', stderr: '' }
      if (args[0] === 'snapshot') return { code: 5, stdout: '', stderr: 'access denied' }
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    expect(nssmCalls()).toEqual([
      ['status', 'easytier-a'],
      ['snapshot', 'easytier-a']
    ])
  })

  it('重装恢复失败时确保停止并记录人工恢复警告', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
      if (args[0] === 'snapshot') return snapshotResult()
      if (args[0] === 'restore') return { code: 5, stdout: '', stderr: 'restore denied' }
      if (args[0] === 'set' && args[2] === 'AppParameters') {
        return { code: 5, stdout: '', stderr: 'set denied' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    const calls = nssmCalls()
    expect(calls).toContainEqual(['stop', 'easytier-a'])
    expect(calls.some((args) => args[0] === 'start')).toBe(false)
    expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('人工恢复'))
    expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('easytier-a'))
  })

  it('新装配置失败时执行 remove confirm 清理半成品', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 3, stdout: '', stderr: 'does not exist' }
      if (args[0] === 'set') return { code: 5, stdout: '', stderr: 'set denied' }
      return { code: 0, stdout: 'installed successfully', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    const calls = nssmCalls()
    expect(calls[1]).toEqual(['install', 'easytier-a', 'C:/res/resource/core/easytier-core.exe'])
    expect(calls.at(-1)).toEqual(['remove', 'easytier-a', 'confirm'])
    expect(calls.some((args) => args[0] === 'snapshot')).toBe(false)
  })

  it('重装启动失败也恢复全部已尝试键，不返回成功', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
      if (args[0] === 'snapshot') return snapshotResult()
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    const calls = nssmCalls()
    const writes = calls.filter((args) => args[0] === 'set').map((args) => args[2])
    expect(writes.at(-1)).toBe('Application')
    expect(calls.filter((args) => args[0] === 'restore').map((args) => args[2])).toEqual([
      'Application',
      'Type',
      'Start',
      'ObjectName',
      'DisplayName',
      'Description',
      'AppExit',
      'AppDirectory',
      'AppParameters'
    ])
    expect(calls.at(-1)).toEqual(['snapshot', 'easytier-a'])
  })

  it('恢复命令成功但回读不一致时仍停止并告警', async () => {
    let snapshots = 0
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
      if (args[0] === 'snapshot') {
        snapshots += 1
        return snapshots === 1
          ? snapshotResult()
          : {
              code: 0,
              stdout: JSON.stringify({ ...snapshot, AppParameters: ['unexpected'] }),
              stderr: ''
            }
      }
      if (args[0] === 'set' && args[2] === 'AppParameters') {
        return { code: 5, stdout: '', stderr: 'set denied' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    expect(snapshots).toBe(2)
    expect(nssmCalls()).toContainEqual(['stop', 'easytier-a'])
    expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('回读不一致'))
  })

  it('新装清理删除失败时明确记录警告', async () => {
    mocks.execute.mockImplementation(async () => {
      const args = mocks.create.mock.lastCall?.[1] as string[]
      if (args[0] === 'status') return { code: 3, stdout: '', stderr: 'does not exist' }
      if (args[0] === 'set') return { code: 5, stdout: '', stderr: 'set denied' }
      if (args[0] === 'remove') return { code: 5, stdout: '', stderr: 'remove denied' }
      return { code: 0, stdout: 'installed successfully', stderr: '' }
    })

    await expect(installServiceOnWindows('easytier-a', appArgs)).resolves.toBe(false)

    expect(nssmCalls().at(-1)).toEqual(['remove', 'easytier-a', 'confirm'])
    expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('删除失败'))
    expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('easytier-a'))
  })
})

describe('detectServiceInstallMethod 配置名解析', () => {
  const stubRecord = (configFileName: string, installMethod: 'nssm' | 'official') => {
    const store = new Map([[`service-config:${configFileName}`, JSON.stringify({ installMethod })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    })
  }

  it('普通与 Web 同名配置使用独立服务记录', async () => {
    const store = new Map([
      ['service-config:easytier-home', JSON.stringify({ installMethod: 'official' })],
      ['service-config:easytierweb-home', JSON.stringify({ installMethod: 'nssm' })]
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    })
    mocks.execute.mockImplementation(async () => {
      const program = mocks.create.mock.lastCall?.[0] as string
      return program === 'easytier-cli'
        ? { code: 0, stdout: 'Service status: running', stderr: '' }
        : { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
    })
    try {
      await expect(detectServiceInstallMethod('easytier-home')).resolves.toBe('official')
      await expect(detectServiceInstallMethod('easytierweb-home')).resolves.toBe('nssm')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('普通服务兼容旧配置名记录，Web 服务不读取有歧义的旧记录', async () => {
    stubRecord('home', 'official')
    mocks.execute.mockImplementation(async () => {
      const program = mocks.create.mock.lastCall?.[0] as string
      return program === 'easytier-cli'
        ? { code: 0, stdout: 'Service status: running', stderr: '' }
        : { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
    })
    try {
      await expect(detectServiceInstallMethod('easytier-home')).resolves.toBe('official')
      await expect(detectServiceInstallMethod('easytierweb-home')).resolves.toBe('nssm')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Web 服务不继承普通服务遗留记录，按实际 NSSM 服务探测', async () => {
    stubRecord('home', 'official')
    // 官方方式已卸载（not installed）；普通服务旧记录不得阻止 Web 的 NSSM 探测
    mocks.execute.mockImplementation(async () => {
      const program = mocks.create.mock.lastCall?.[0] as string
      return program === 'easytier-cli'
        ? { code: 0, stdout: 'Service status: not installed', stderr: '' }
        : { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
    })
    try {
      await expect(detectServiceInstallMethod('easytierweb-home')).resolves.toBe('nssm')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Windows 服务状态未知与卸载 fail-closed', () => {
  it('保留正常 NSSM 状态文本，确认不存在时返回 false', async () => {
    mocks.execute.mockResolvedValueOnce({ code: 0, stdout: ' SERVICE_RUNNING ', stderr: '' })
    await expect(checkServiceOnWindows('easytier-a')).resolves.toBe('SERVICE_RUNNING')

    mocks.execute.mockResolvedValueOnce({ code: 3, stdout: '', stderr: 'does not exist' })
    await expect(checkServiceOnWindows('easytier-a')).resolves.toBe(false)
  })

  it('空输出、非字符串结果与命令异常均返回未知 null', async () => {
    mocks.execute.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    await expect(checkServiceOnWindows('easytier-a')).resolves.toBeNull()

    mocks.execute.mockResolvedValueOnce({ code: 5, stdout: '', stderr: 'access denied' })
    await expect(checkServiceOnWindows('easytier-a')).resolves.toBeNull()

    mocks.execute.mockRejectedValueOnce(new Error('nssm unavailable'))
    await expect(checkServiceOnWindows('easytier-a')).resolves.toBeNull()
  })

  it('NSSM 状态未知时不执行删除', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('nssm unavailable'))

    await expect(uninstallServiceOnWindows('easytier-a')).resolves.toBe(false)

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][1]).toEqual(['status', 'easytier-a'])
  })

  it('NSSM 状态确认存在时仍执行删除', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'SERVICE_STOPPED', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })

    await expect(uninstallServiceOnWindows('easytier-a')).resolves.toBe(true)

    expect(mocks.create.mock.calls.map((call) => call[1])).toContainEqual([
      'remove',
      'easytier-a',
      'confirm'
    ])
  })

  it('运行中的服务先停止并确认停止后再删除', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'SERVICE_RUNNING', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'SERVICE_STOPPED', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })

    await expect(uninstallServiceOnWindows('easytier-a')).resolves.toBe(true)

    const commands = mocks.create.mock.calls.map((call) => call[1])
    expect(commands).toEqual([
      ['status', 'easytier-a'],
      ['stop', 'easytier-a'],
      ['status', 'easytier-a'],
      ['remove', 'easytier-a', 'confirm']
    ])
  })

  it('状态未知时默认拒绝；显式 force 清理才尝试删除', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('nssm unavailable'))
    await expect(uninstallServiceOnWindows('easytier-a')).resolves.toBe(false)

    mocks.create.mockClear()
    mocks.execute.mockReset()
    mocks.execute
      .mockRejectedValueOnce(new Error('nssm unavailable'))
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })

    await expect(uninstallServiceOnWindows('easytier-a', { force: true })).resolves.toBe(true)
    expect(mocks.create.mock.calls.map((call) => call[1])).toContainEqual([
      'remove',
      'easytier-a',
      'confirm'
    ])
  })

  it('官方 CLI 状态未知时不回退默认服务也不执行卸载', async () => {
    mocks.execute.mockResolvedValueOnce({ code: 5, stdout: '', stderr: 'access denied' })

    await expect(checkServiceWithOfficialCli('easytier-a')).resolves.toBeNull()
    expect(mocks.create).toHaveBeenCalledTimes(1)

    mocks.create.mockClear()
    mocks.execute.mockResolvedValueOnce({ code: 5, stdout: '', stderr: 'access denied' })
    await expect(uninstallServiceWithOfficialCli('easytier-a')).resolves.toBe(false)
    expect(mocks.create.mock.calls.map((call) => call[1])).toEqual([
      ['service', '-n', 'easytier-a', 'status']
    ])
  })

  it('已记录的 NSSM 服务探测未知时检测结果也是未知，而非不存在', async () => {
    const store = new Map([
      ['service-config:easytier-a', JSON.stringify({ installMethod: 'nssm' })]
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    })
    mocks.execute.mockRejectedValueOnce(new Error('nssm unavailable'))
    try {
      await expect(detectServiceInstallMethod('easytier-a')).resolves.toBe('unknown')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Windows 服务启动状态判定（服务启停可靠性回归）', () => {
  it('START_PENDING 后转为 RUNNING → 启动成功（不再把待启动当成成功）', async () => {
    let call = 0
    mocks.execute.mockImplementation(async () => {
      call++
      // 第 1 次是 nssm start，其余为状态轮询
      if (call === 1) return { code: 0, stdout: '', stderr: '' }
      const statuses = ['SERVICE_START_PENDING', 'SERVICE_START_PENDING', 'SERVICE_RUNNING']
      return { code: 0, stdout: statuses[Math.min(call - 2, statuses.length - 1)], stderr: '' }
    })
    await expect(startServiceOnWindows('easytier-a')).resolves.toBe(true)
  })

  it('服务不存在（status 退出码 3）→ 启动失败，不能把布尔 false 当成功', async () => {
    let call = 0
    mocks.execute.mockImplementation(async () => {
      call++
      if (call === 1) return { code: 0, stdout: '', stderr: '' }
      return { code: 3, stdout: '', stderr: 'Can not open service! does not exist' }
    })
    await expect(startServiceOnWindows('easytier-a')).resolves.toBe(false)
  })

  it('超时仍为 STOPPED → 启动失败', async () => {
    let call = 0
    mocks.execute.mockImplementation(async () => {
      call++
      if (call === 1) return { code: 0, stdout: '', stderr: '' }
      return { code: 0, stdout: 'SERVICE_STOPPED', stderr: '' }
    })
    await expect(startServiceOnWindows('easytier-a')).resolves.toBe(false)
  })

  it('待启动超过 5 秒但在 20 秒内就绪 → 启动成功', async () => {
    let call = 0
    mocks.execute.mockImplementation(async () => {
      call++
      if (call === 1) return { code: 0, stdout: '', stderr: '' }
      if (call <= 16) return { code: 0, stdout: 'SERVICE_START_PENDING', stderr: '' }
      return { code: 0, stdout: 'SERVICE_RUNNING', stderr: '' }
    })
    await expect(startServiceOnWindows('easytier-a')).resolves.toBe(true)
  })
})

describe('官方 CLI 服务启动迁移（服务信任链回归）', () => {
  it('具名官方服务通过 NSSM 启动并轮询 NSSM 状态，不再调用官方 CLI start', async () => {
    let started = false
    mocks.execute.mockImplementation(async () => {
      const [program, args] = mocks.create.mock.lastCall as [string, string[]]
      if (program === 'easytier-cli') {
        return { code: 0, stdout: 'Service status: stopped', stderr: '' }
      }
      if (args[0] === 'start') {
        started = true
        return { code: 0, stdout: '', stderr: '' }
      }
      return {
        code: 0,
        stdout: started ? 'SERVICE_RUNNING' : 'SERVICE_STOPPED',
        stderr: ''
      }
    })

    await expect(startServiceWithOfficialCli('easytier-a')).resolves.toBe(true)
    expect(mocks.create.mock.calls.map((call) => call[1])).toEqual([
      ['service', '-n', 'easytier-a', 'status'],
      ['start', 'easytier-a'],
      ['status', 'easytier-a']
    ])
  })

  it('NSSM 不可用时 fail closed，不回退官方 CLI start', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'Service status: stopped', stderr: '' })
      .mockRejectedValueOnce(new Error('NSSM 校验失败'))
    await expect(startServiceWithOfficialCli('easytier-a')).resolves.toBe(false)
    expect(mocks.create.mock.calls.map((call) => call[1])).toEqual([
      ['service', '-n', 'easytier-a', 'status'],
      ['start', 'easytier-a']
    ])
  })

  it('旧默认官方服务无法解析具名 NSSM 目标时拒绝启动', async () => {
    mocks.execute
      .mockResolvedValueOnce({ code: 0, stdout: 'not installed', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Service status: stopped', stderr: '' })
    await expect(startServiceWithOfficialCli('easytier-a')).resolves.toBe(false)
    expect(mocks.create.mock.calls.map((call) => call[1])).toEqual([
      ['service', '-n', 'easytier-a', 'status'],
      ['service', 'status']
    ])
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
