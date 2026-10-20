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
  const create = vi.fn(() => ({ execute }))
  return { execute, create, platform: { current: 'windows' } }
})

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: mocks.create }
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

import { executeCmd, getRunningProcesses } from '@/utils/shellUtil'

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.create.mockClear()
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
