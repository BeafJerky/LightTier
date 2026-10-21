/**
 * fileUtil 解压防护单测（M-03 回归）
 *
 * 覆盖 zip-slip 条目路径校验矩阵：正常内核包条目放行；`..` 穿越、绝对路径、
 * Windows 盘符、含空字节一律拒绝（extractFile 会跳过这些条目）。
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({
  attachConsole: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Resource: 1, AppData: 2 },
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn()
}))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: vi.fn() },
  open: vi.fn()
}))

vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async (p: string) => p.split('/').slice(0, -1).join('/')),
  extname: vi.fn(async () => ''),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')),
  resourceDir: vi.fn(async () => '/app')
}))

vi.mock('@/utils/platformUtil', () => ({ isAndroid: () => false }))

import {
  exists,
  readDir,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile
} from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import {
  cleanCoreDirExceptPackages,
  clearAllLogs,
  downloadFile,
  fileExists,
  isCorePackageFile,
  isSafeZipEntryPath,
  readFileContent,
  resolveKernelLogFile,
  writeFileWithBackup,
  type DownloadProgress
} from '@/utils/fileUtil'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isSafeZipEntryPath（zip-slip 防护）', () => {
  it('放行正常内核包条目（含公共前缀目录与空格文件名）', () => {
    expect(isSafeZipEntryPath('easytier-windows-x86_64/easytier-core.exe')).toBe(true)
    expect(isSafeZipEntryPath('easytier-windows-x86_64/easytier-cli.exe')).toBe(true)
    expect(isSafeZipEntryPath('easytier-core')).toBe(true)
    expect(isSafeZipEntryPath('a/b/c.txt')).toBe(true)
    expect(isSafeZipEntryPath('sub dir/file name.txt')).toBe(true)
    expect(isSafeZipEntryPath('a..b/c')).toBe(true) // 片段中含 .. 但不是 .. 段
    expect(isSafeZipEntryPath('easytier-windows-x86_64/')).toBe(true) // 目录项（调用方另行跳过）
  })

  it('拒绝 ../ 穿越条目', () => {
    expect(isSafeZipEntryPath('../evil.txt')).toBe(false)
    expect(isSafeZipEntryPath('a/../../evil.txt')).toBe(false)
    expect(isSafeZipEntryPath('a/..')).toBe(false)
    expect(isSafeZipEntryPath('..')).toBe(false)
    expect(isSafeZipEntryPath('..\\evil.txt')).toBe(false) // Windows 分隔符
  })

  it('拒绝绝对路径与盘符条目', () => {
    expect(isSafeZipEntryPath('/abs/evil.txt')).toBe(false)
    expect(isSafeZipEntryPath('\\abs\\evil.txt')).toBe(false)
    expect(isSafeZipEntryPath('C:/windows/system32/evil.dll')).toBe(false)
    expect(isSafeZipEntryPath('c:evil')).toBe(false)
  })

  it('拒绝空路径与含空字节的条目', () => {
    expect(isSafeZipEntryPath('')).toBe(false)
    expect(isSafeZipEntryPath('a/b\u0000.txt')).toBe(false)
  })
})

describe('isCorePackageFile', () => {
  it('仅识别 .zip 内核包（大小写不敏感）', () => {
    expect(isCorePackageFile('easytier-windows-x86_64-v2.6.4.zip')).toBe(true)
    expect(isCorePackageFile('EASYTIER-WINDOWS-X86_64-V2.6.4.ZIP')).toBe(true)
    expect(isCorePackageFile('easytier-core.exe')).toBe(false)
    expect(isCorePackageFile('easytier-windows-x86_64-v2.6.4.zip.download')).toBe(false)
  })
})

describe('cleanCoreDirExceptPackages', () => {
  const entry = (name: string, isFile = true) => ({
    name,
    isFile,
    isDirectory: !isFile,
    isSymlink: false
  })

  it('保留各版本 zip，删除旧内核文件、下载临时文件与目录', async () => {
    vi.mocked(readDir).mockResolvedValue([
      entry('easytier-windows-x86_64-v2.6.4.zip'),
      entry('easytier-windows-x86_64-v2.7.0.zip'),
      entry('easytier-core.exe'),
      entry('easytier-windows-x86_64-v2.7.0.zip.download'),
      entry('old-dir', false)
    ] as any)

    await expect(cleanCoreDirExceptPackages()).resolves.toBe(true)

    expect(remove).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenCalledWith('resource/core/easytier-core.exe', expect.anything())
    expect(remove).toHaveBeenCalledWith(
      'resource/core/easytier-windows-x86_64-v2.7.0.zip.download',
      expect.anything()
    )
    expect(remove).toHaveBeenCalledWith('resource/core/old-dir', expect.anything())
    expect(remove).not.toHaveBeenCalledWith(
      'resource/core/easytier-windows-x86_64-v2.6.4.zip',
      expect.anything()
    )
    expect(remove).not.toHaveBeenCalledWith(
      'resource/core/easytier-windows-x86_64-v2.7.0.zip',
      expect.anything()
    )
  })

  it('存在无法删除的文件时返回 false，供安装流程中止', async () => {
    vi.mocked(readDir).mockResolvedValue([entry('easytier-core.exe')] as any)
    vi.mocked(remove).mockRejectedValueOnce(new Error('EBUSY'))

    await expect(cleanCoreDirExceptPackages()).resolves.toBe(false)
  })
})

describe('downloadFile（流式进度）', () => {
  const fileUrl = 'https://example.com/easytier-windows-x86_64-v2.7.0.zip'
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

  const mockResponse = (options: {
    chunks?: Uint8Array[]
    contentLength?: number | null
    body?: boolean
  }) => {
    const headers = new Headers()
    if (options.contentLength !== null) {
      headers.set('content-length', String(options.contentLength ?? zipBytes.byteLength))
    }
    return {
      ok: true,
      headers,
      body:
        options.body === false
          ? null
          : new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of options.chunks ?? [zipBytes]) controller.enqueue(chunk)
                controller.close()
              }
            }),
      arrayBuffer: async () => zipBytes.buffer
    } as unknown as Response
  }

  it('流式读取时回报起始与结束进度，并写入完整 zip', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ chunks: [zipBytes.subarray(0, 3), zipBytes.subarray(3)] }) as any
    )
    const progress: DownloadProgress[] = []

    await expect(downloadFile(fileUrl, (p) => progress.push(p))).resolves.toBe(true)

    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress[0]).toEqual({ received: 0, total: zipBytes.byteLength })
    expect(progress[progress.length - 1]).toEqual({
      received: zipBytes.byteLength,
      total: zipBytes.byteLength
    })
    expect(vi.mocked(writeFile).mock.calls[0][1]).toEqual(zipBytes)
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('缺失 Content-Length 时 total 为 null，结束仍回报已下载字节数', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ contentLength: null }) as any)
    const progress: DownloadProgress[] = []

    await expect(downloadFile(fileUrl, (p) => progress.push(p))).resolves.toBe(true)

    expect(progress[0]).toEqual({ received: 0, total: null })
    expect(progress[progress.length - 1]).toEqual({
      received: zipBytes.byteLength,
      total: null
    })
  })

  it('响应体不可流式读取时回退整包读取并回报进度', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ body: false }) as any)
    const progress: DownloadProgress[] = []

    await expect(downloadFile(fileUrl, (p) => progress.push(p))).resolves.toBe(true)

    expect(progress).toEqual([
      { received: 0, total: zipBytes.byteLength },
      { received: zipBytes.byteLength, total: zipBytes.byteLength }
    ])
  })

  it('非 zip 内容不落盘', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ chunks: [new TextEncoder().encode('<html>error</html>')] }) as any
    )

    await expect(downloadFile(fileUrl)).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('resolveKernelLogFile（按配置定位日志）', () => {
  const entries = (names: string[]) => names.map((name) => ({ name }) as any)

  it('优先新布局 logs/kernel/<scope>/ 中的当前文件', async () => {
    vi.mocked(readDir).mockImplementation(async (dir: string | URL) => {
      if (dir === 'logs/kernel/server') {
        return entries(['easytier.log', 'easytier.log.1'])
      }
      return entries(['easytier.log', 'server.log'])
    })

    await expect(resolveKernelLogFile('server.toml')).resolves.toEqual({
      dir: 'logs/kernel/server',
      file: 'easytier.log'
    })
  })

  it('新布局没有文件时回退旧版 logs/ 根目录', async () => {
    vi.mocked(readDir).mockImplementation(async (dir: string | URL) => {
      if (dir === 'logs/kernel/server') return []
      return entries(['server.log', 'server.log.1'])
    })

    await expect(resolveKernelLogFile('server.toml')).resolves.toEqual({
      dir: 'logs',
      file: 'server.log'
    })
  })

  it('旧版目录同时存在共享 easytier.log 时仍优先本配置的 {name}.log', async () => {
    vi.mocked(readDir).mockImplementation(async (dir: string | URL) => {
      if (dir === 'logs/kernel/server') return []
      return entries(['easytier.log', 'server.log'])
    })

    await expect(resolveKernelLogFile('server.toml')).resolves.toEqual({
      dir: 'logs',
      file: 'server.log'
    })
  })

  it('两处都没有日志时返回 null（区别于空日志）', async () => {
    vi.mocked(readDir).mockResolvedValue([])
    await expect(resolveKernelLogFile('server.toml')).resolves.toBeNull()
  })
})

describe('clearAllLogs（只清理历史分段，保留活跃日志）', () => {
  const entries = (names: string[]) => names.map((name) => ({ name }) as any)

  it('覆盖应用/旧版/按配置目录，返回真实计数且不删除当前文件', async () => {
    vi.mocked(readDir).mockImplementation(async (dir: string | URL) => {
      if (dir === 'logs') {
        return entries([
          'lighttier.log',
          'lighttier_2026-10-21_10-00-00.log',
          'monitor_server_20261021.log',
          'easytier.log',
          'easytier.log.1',
          'server.log',
          'server.log.1',
          'server.2026-10-20.log',
          'kernel'
        ])
      }
      if (dir === 'logs/kernel') return entries(['server'])
      if (dir === 'logs/kernel/server') {
        return entries(['easytier.log', 'easytier.log.1', 'easytier.log.2'])
      }
      return []
    })
    vi.mocked(remove).mockResolvedValue(undefined)

    const result = await clearAllLogs()

    expect(result.removed).toBe(7)
    expect(result.kept).toBe(4)
    expect(result.failed).toBe(0)
    expect(vi.mocked(remove)).toHaveBeenCalledTimes(7)
    const removed = vi.mocked(remove).mock.calls.map(([path]) => path)
    expect(removed).not.toContain('logs/lighttier.log')
    expect(removed).not.toContain('logs/easytier.log')
    expect(removed).not.toContain('logs/server.log')
    expect(removed).toContain('logs/lighttier_2026-10-21_10-00-00.log')
    expect(removed).toContain('logs/monitor_server_20261021.log')
    expect(removed).toContain('logs/kernel/server/easytier.log.2')
  })

  it('单个文件删除失败时继续清理并记录失败', async () => {
    vi.mocked(readDir).mockImplementation(async (dir: string | URL) => {
      if (dir === 'logs') return entries(['lighttier.log', 'easytier.log.1', 'easytier.log.2'])
      return []
    })
    vi.mocked(remove).mockRejectedValueOnce(new Error('locked')).mockResolvedValue(undefined)

    const result = await clearAllLogs()

    expect(result.removed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failedFiles[0].file).toBe('logs/easytier.log.1')
  })
})

describe('安全读写辅助函数（H-05 回归）', () => {
  it('fileExists 使用 Resource 基址并原样返回存在性结果', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true)
    await expect(fileExists('config.json')).resolves.toBe(true)
    expect(exists).toHaveBeenCalledWith('config.json', { baseDir: 1 })

    vi.mocked(exists).mockResolvedValueOnce(false)
    await expect(fileExists('config.json')).resolves.toBe(false)
  })

  it('writeFileWithBackup 覆盖前把旧内容写入 .bak', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('old-content')

    await writeFileWithBackup('config.json', 'new-content')

    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      'config.json.bak',
      'old-content',
      expect.objectContaining({ baseDir: 1 })
    )
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      'config.json',
      'new-content',
      expect.objectContaining({ baseDir: 1 })
    )
  })

  it('目标不存在时不读取旧内容，直接写入', async () => {
    vi.mocked(exists).mockResolvedValue(false)

    await writeFileWithBackup('config.json', 'new-content')

    expect(readTextFile).not.toHaveBeenCalled()
    expect(writeTextFile).toHaveBeenCalledTimes(1)
    expect(writeTextFile).toHaveBeenCalledWith(
      'config.json',
      'new-content',
      expect.objectContaining({ baseDir: 1 })
    )
  })

  it('旧内容不可读时中止覆盖，不写入新内容', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockRejectedValue(new Error('EACCES'))

    await expect(writeFileWithBackup('config.json', 'new-content')).rejects.toThrow('EACCES')
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('readFileContent 默认吞掉错误返回空串，throwOnError 时向上抛出', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockRejectedValue(new Error('EACCES'))

    await expect(readFileContent('config.json')).resolves.toBe('')
    await expect(readFileContent('config.json', { throwOnError: true })).rejects.toThrow('EACCES')
  })
})
