/**
 * fileUtil 解压防护单测（M-03 回归）
 *
 * 覆盖 zip-slip 条目路径校验矩阵：正常内核包条目放行；`..` 穿越、绝对路径、
 * Windows 盘符、含空字节一律拒绝（extractFile 会跳过这些条目）。
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'

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
  extname: vi.fn(async (p: string) => {
    const name = p.split('/').pop() ?? ''
    const index = name.lastIndexOf('.')
    return index > 0 ? name.slice(index) : ''
  }),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')),
  resourceDir: vi.fn(async () => '/app')
}))

vi.mock('@/shared/platform/platformUtil', () => ({ isAndroid: () => false }))

import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile
} from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import {
  backupCoreExecutables,
  checkDir,
  cleanCoreDirExceptPackages,
  clearAllLogs,
  discardCoreBackup,
  downloadFile,
  extractFile,
  fileExists,
  isCorePackageFile,
  isSafeZipEntryPath,
  listTomlFiles,
  measureDownloadSpeed,
  readFileContent,
  resolveKernelLogFile,
  restoreCoreExecutables,
  writeFileContent,
  writeFileWithBackup,
  type DownloadProgress
} from '@/shared/platform/fileUtil'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkDir（目录创建）', () => {
  it('按目录本身创建含点号的路径，不误判为文件', async () => {
    vi.mocked(exists).mockResolvedValue(false)

    await checkDir('logs/kernel/scope.v1')

    expect(mkdir).toHaveBeenCalledWith('logs/kernel/scope.v1', {
      baseDir: 1,
      recursive: true
    })
  })
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

  it('拒绝 http 下载，避免明文镜像替换内核', async () => {
    vi.mocked(fetch).mockClear()
    await expect(downloadFile('http://example.com/easytier.zip')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

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
    // 下载暂存路径每次唯一；writeFileContent 内部原子写后，再由下载流程直接换到目标文件
    const stagingPath = vi.mocked(rename).mock.calls[0][1] as string
    expect(stagingPath).toMatch(
      /^resource\/core\/easytier-windows-x86_64-v2\.7\.0\.zip\.lt-tmp-[^/]+$/
    )
    expect(rename).toHaveBeenLastCalledWith(
      stagingPath,
      'resource/core/easytier-windows-x86_64-v2.7.0.zip',
      expect.anything()
    )
  })

  it('并发下载使用独立暂存路径，失败只清理自身且不误删另一份', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({}) as any)
      .mockResolvedValueOnce(mockResponse({}) as any)
    const target = 'resource/core/easytier-windows-x86_64-v2.7.0.zip'
    const targetRenames: string[] = []
    vi.mocked(rename).mockImplementation(async (oldPath, newPath) => {
      if (String(newPath) === target) {
        targetRenames.push(String(oldPath))
        if (targetRenames.length === 1) throw new Error('rename failed')
      }
    })
    try {
      const results = await Promise.all([downloadFile(fileUrl), downloadFile(fileUrl)])

      expect(results).toEqual([false, true])
      expect(targetRenames).toHaveLength(2)
      expect(new Set(targetRenames).size).toBe(2)
      expect(remove).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledWith(targetRenames[0], { baseDir: 1 })
      expect(remove).not.toHaveBeenCalledWith(targetRenames[1], { baseDir: 1 })
    } finally {
      vi.mocked(rename).mockImplementation(async () => {})
      vi.mocked(remove).mockImplementation(async () => {})
    }
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

  it('提供正确 SHA-256 时允许落盘', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({}) as any)
    const expectedSha256 = createHash('sha256').update(zipBytes).digest('hex')

    await expect(
      downloadFile(fileUrl, undefined, { expectedSize: zipBytes.length, expectedSha256 })
    ).resolves.toBe(true)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('定长篡改包即使大小与魔数正确也拒绝落盘', async () => {
    const tampered = zipBytes.slice()
    tampered[tampered.length - 1] ^= 0xff
    vi.mocked(fetch).mockResolvedValue(mockResponse({ chunks: [tampered] }) as any)

    await expect(
      downloadFile(fileUrl, undefined, {
        expectedSize: tampered.length,
        expectedSha256: createHash('sha256').update(zipBytes).digest('hex')
      })
    ).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
  })

  it('摘要格式非法时在请求前拒绝', async () => {
    await expect(downloadFile(fileUrl, undefined, { expectedSha256: 'sha256:1234' })).resolves.toBe(
      false
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('非 zip 内容不落盘', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ chunks: [new TextEncoder().encode('<html>error</html>')] }) as any
    )

    await expect(downloadFile(fileUrl)).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('连接假活（长时间无数据）时按停滞中止，不落盘', async () => {
    const headers = new Headers({ 'content-length': '10' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers,
      body: new ReadableStream<Uint8Array>({ start() {} })
    } as unknown as Response)

    await expect(
      downloadFile(fileUrl, undefined, { stallTimeoutMs: 60, responseTimeoutMs: 0 })
    ).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('速度低于下限时中止，避免几 KB/s 的源长期占用', async () => {
    const headers = new Headers({ 'content-length': '1000' })
    const slowBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        controller.enqueue(new Uint8Array([0x50]))
      }
    })
    vi.mocked(fetch).mockResolvedValue({ ok: true, headers, body: slowBody } as unknown as Response)

    await expect(
      downloadFile(fileUrl, undefined, {
        responseTimeoutMs: 0,
        stallTimeoutMs: 500,
        minSpeedBps: 1024,
        slowGraceMs: 80
      })
    ).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('extractFile（本次读取包体摘要）', () => {
  const zipPath = 'resource/core/kernel.zip'
  const packageBytes = zipSync({
    'kernel/easytier-core.exe': new Uint8Array([0x4d, 0x5a]),
    'kernel/easytier-cli.exe': new Uint8Array([0x4d, 0x5a])
  })
  const expectedSha256 = createHash('sha256').update(Buffer.from(packageBytes)).digest('hex')

  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue(packageBytes as Uint8Array<ArrayBuffer>)
  })

  it('摘要匹配时解压，保持未传摘要的旧调用兼容', async () => {
    await expect(extractFile(zipPath, 'resource/core')).resolves.toBe(true)
    await expect(
      extractFile(zipPath, 'resource/core', false, async () => true, expectedSha256)
    ).resolves.toBe(true)

    expect(writeFile).toHaveBeenCalledTimes(4)
  })

  it('校验本次实际读取的完整字节，换包后不执行清理或写盘', async () => {
    const beforeWrite = vi.fn(async () => true)
    const tampered = packageBytes.slice()
    tampered[tampered.length - 1] ^= 0xff
    vi.mocked(readFile).mockResolvedValue(tampered)

    await expect(
      extractFile(zipPath, 'resource/core', false, beforeWrite, expectedSha256)
    ).resolves.toBe(false)

    expect(beforeWrite).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
  })

  it('摘要格式非法时不读取或写盘', async () => {
    await expect(
      extractFile(zipPath, 'resource/core', false, undefined, 'sha256:bad')
    ).resolves.toBe(false)

    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('包体读取失败时不吞错也不写盘', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES'))

    await expect(extractFile(zipPath, 'resource/core')).resolves.toBe(false)

    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('measureDownloadSpeed（下载前吞吐采样）', () => {
  const fileUrl = 'https://example.com/app.apk'

  it('采样窗口内读到数据时返回正速度，并主动断开', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024))
        controller.enqueue(new Uint8Array(1024))
        controller.close()
      }
    })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body
    } as unknown as Response)

    await expect(
      measureDownloadSpeed(fileUrl, { windowMs: 200, maxBytes: 4096, responseTimeoutMs: 0 })
    ).resolves.toBeGreaterThan(0)
  })

  it('响应建立后无任何数据时返回 0', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({ start() {} })
    } as unknown as Response)

    await expect(
      measureDownloadSpeed(fileUrl, { windowMs: 60, responseTimeoutMs: 0 })
    ).resolves.toBe(0)
  })

  it('请求失败时返回 0', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    await expect(measureDownloadSpeed(fileUrl)).resolves.toBe(0)
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
  it('配置目录不可读时默认容错，严格列举则抛错', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readDir).mockRejectedValue(new Error('EACCES'))

    await expect(listTomlFiles()).resolves.toEqual([])
    await expect(listTomlFiles('config', { throwOnError: true })).rejects.toThrow('EACCES')
  })

  it('fileExists 使用 Resource 基址并原样返回存在性结果', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true)
    await expect(fileExists('config.json')).resolves.toBe(true)
    expect(exists).toHaveBeenCalledWith('config.json', { baseDir: 1 })

    vi.mocked(exists).mockResolvedValueOnce(false)
    await expect(fileExists('config.json')).resolves.toBe(false)
  })

  it('writeFileWithBackup 覆盖前把旧内容写入 .bak，并原子替换目标', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('old-content')

    await writeFileWithBackup('config.json', 'new-content')

    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^config\.json\.bak\.lt-tmp-[^/]+$/),
      'old-content',
      expect.objectContaining({ baseDir: 1 })
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/^config\.json\.bak\.lt-tmp-[^/]+$/),
      'config.json.bak',
      expect.anything()
    )
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^config\.json\.lt-tmp-[^/]+$/),
      'new-content',
      expect.objectContaining({ baseDir: 1 })
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/^config\.json\.lt-tmp-[^/]+$/),
      'config.json',
      expect.anything()
    )
  })

  it('目标不存在时不读取旧内容，直接原子写入', async () => {
    vi.mocked(exists).mockResolvedValue(false)

    await writeFileWithBackup('config.json', 'new-content')

    expect(readTextFile).not.toHaveBeenCalled()
    expect(writeTextFile).toHaveBeenCalledTimes(1)
    expect(writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^config\.json\.lt-tmp-[^/]+$/),
      'new-content',
      expect.objectContaining({ baseDir: 1 })
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/^config\.json\.lt-tmp-[^/]+$/),
      'config.json',
      expect.anything()
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

describe('writeFileContent 原子写', () => {
  it('先写唯一临时文件再 rename 到目标', async () => {
    await writeFileContent('config/a.toml', 'x')
    const temporary = vi.mocked(writeTextFile).mock.calls[0][0]
    expect(temporary).toMatch(/^config\/a\.toml\.lt-tmp-[^/]+$/)
    expect(writeTextFile).toHaveBeenCalledWith(
      temporary,
      'x',
      expect.objectContaining({ baseDir: 1, createNew: true })
    )
    expect(rename).toHaveBeenCalledWith(temporary, 'config/a.toml', expect.anything())
  })

  it('并发写同一目标使用不同临时文件', async () => {
    await Promise.all([
      writeFileContent('config/a.toml', 'first'),
      writeFileContent('config/a.toml', 'second')
    ])
    const temporary = vi.mocked(writeTextFile).mock.calls.map(([path]) => path)
    expect(new Set(temporary).size).toBe(2)
  })

  it('临时写入失败时清理临时文件并向上抛错', async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('disk full'))
    await expect(writeFileContent('config/a.toml', 'x')).rejects.toThrow('disk full')
    const temporary = vi.mocked(writeTextFile).mock.calls[0][0]
    expect(rename).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(temporary, expect.anything())
  })

  it('二进制写入同样走唯一临时文件', async () => {
    await writeFileContent('core/easytier-core.exe', new Uint8Array([1, 2]))
    const temporary = vi.mocked(writeFile).mock.calls[0][0]
    expect(temporary).toMatch(/^core\/easytier-core\.exe\.lt-tmp-[^/]+$/)
    expect(writeFile).toHaveBeenCalledWith(
      temporary,
      expect.any(Uint8Array),
      expect.objectContaining({ createNew: true })
    )
    expect(rename).toHaveBeenCalledWith(temporary, 'core/easytier-core.exe', expect.anything())
  })
})

describe('内核文件备份与恢复', () => {
  const entry = (name: string, isFile = true) => ({
    name,
    isFile,
    isDirectory: !isFile,
    isSymlink: false
  })

  const installMemoryFs = (initial: Record<string, string[]>) => {
    const directories = new Map(Object.entries(initial))
    vi.mocked(mkdir).mockImplementation(async (path) => {
      const key = String(path)
      if (!directories.has(key)) directories.set(key, [])
    })
    const directoryNames = (path: string) =>
      new Set(
        [...directories.keys()]
          .filter((key) => key.startsWith(`${path}/`))
          .map((key) => key.slice(path.length + 1).split('/')[0])
      )
    vi.mocked(readDir).mockImplementation(async (path) => {
      const key = String(path)
      const names = directories.get(key) ?? []
      const dirs = directoryNames(key)
      return [...new Set([...names, ...dirs])].map((name) => entry(name, !dirs.has(name))) as any
    })
    vi.mocked(rename).mockImplementation(async (oldPath, newPath) => {
      const from = String(oldPath)
      const to = String(newPath)
      const parent = from.slice(0, from.lastIndexOf('/'))
      const name = from.slice(parent.length + 1)
      const isFile = directories.has(from) || (directories.get(parent) ?? []).includes(name)
      if (!isFile) throw new Error(`missing ${from}`)
      if (directories.has(to)) throw new Error(`exists ${to}`)
      const prefix = `${from}/`
      for (const [path, names] of [...directories]) {
        if (path === from || path.startsWith(prefix)) {
          directories.set(path.replace(from, to), names)
          directories.delete(path)
        }
      }
      if (isFile) {
        const names = directories.get(parent) ?? []
        if (names.includes(name)) {
          directories.set(
            parent,
            names.filter((item) => item !== name)
          )
          const targetParent = to.slice(0, to.lastIndexOf('/'))
          directories.set(targetParent, [
            ...(directories.get(targetParent) ?? []),
            to.slice(targetParent.length + 1)
          ])
        }
      }
    })
    vi.mocked(remove).mockImplementation(async (filePath) => {
      const path = String(filePath)
      for (const key of [...directories.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) directories.delete(key)
      }
      const parent = path.slice(0, path.lastIndexOf('/'))
      const name = path.slice(parent.length + 1)
      directories.set(
        parent,
        (directories.get(parent) ?? []).filter((item) => item !== name)
      )
    })
    return directories
  }

  it('备份时保留各版本 zip，只移动可执行文件与目录', async () => {
    const fs = installMemoryFs({
      'resource/core': [
        'easytier-windows-x86_64-v2.6.4.zip',
        'easytier-core.exe',
        'easytier-cli.exe'
      ],
      'resource/core/logs': ['old.log']
    })

    const backupPath = await backupCoreExecutables()

    expect(backupPath).toMatch(/^resource\/core-previous-[^/]+$/)
    expect(fs.get(backupPath!)).toEqual(
      expect.arrayContaining(['easytier-core.exe', 'easytier-cli.exe'])
    )
    expect(fs.get(`${backupPath}/logs`)).toEqual(['old.log'])
    expect(fs.get('resource/core')).toEqual(['easytier-windows-x86_64-v2.6.4.zip'])
  })

  it('不清除上一次失败遗留的备份', async () => {
    const fs = installMemoryFs({
      'resource/core': ['easytier-core.exe'],
      'resource/core-previous': ['old-core.exe']
    })

    const backupPath = await backupCoreExecutables()

    expect(backupPath).not.toBe('resource/core-previous')
    expect(fs.get('resource/core-previous')).toEqual(['old-core.exe'])
  })

  it('没有可备份的旧内核时返回 null，且不创建空备份目录', async () => {
    const fs = installMemoryFs({
      'resource/core': ['easytier-windows-x86_64-v2.6.4.zip']
    })

    await expect(backupCoreExecutables()).resolves.toBeNull()

    expect(mkdir).not.toHaveBeenCalled()
    expect(fs.get('resource/core')).toEqual(['easytier-windows-x86_64-v2.6.4.zip'])
  })

  it('备份部分失败时回滚本次已移动文件并抛错', async () => {
    const fs = installMemoryFs({
      'resource/core': ['easytier-core.exe', 'easytier-cli.exe']
    })
    const renameFile = vi.mocked(rename).getMockImplementation()!
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (from === 'resource/core/easytier-cli.exe') throw new Error('EBUSY')
      await renameFile(from, to)
    })

    await expect(backupCoreExecutables()).rejects.toThrow('EBUSY')

    expect(fs.get('resource/core')).toEqual(
      expect.arrayContaining(['easytier-core.exe', 'easytier-cli.exe'])
    )
    expect([...fs.keys()].filter((path) => path.startsWith('resource/core-previous-'))).toEqual([])
  })

  it('回滚失败时保留本次备份并抛出含恢复路径的错误', async () => {
    const fs = installMemoryFs({
      'resource/core': ['easytier-core.exe', 'easytier-cli.exe']
    })
    const renameFile = vi.mocked(rename).getMockImplementation()!
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (from === 'resource/core/easytier-cli.exe') throw new Error('source busy')
      if (String(from).includes('core-previous-') && String(to).startsWith('resource/core/')) {
        throw new Error('rollback denied')
      }
      await renameFile(from, to)
    })

    const failure = await backupCoreExecutables().catch((cause: unknown) => cause)

    const preserved = [...fs.keys()].find((path) => path.startsWith('resource/core-previous-'))
    expect(preserved).toBeDefined()
    expect(fs.get(preserved!)).toContain('easytier-core.exe')
    expect(failure).toMatchObject({
      code: 'core_backup_rollback_failed',
      backupPath: preserved,
      cause: expect.objectContaining({ message: 'source busy' }),
      rollbackCause: expect.objectContaining({ message: 'rollback denied' })
    })
  })

  it('列举旧内核失败时抛错，不伪装成无旧内核', async () => {
    installMemoryFs({ 'resource/core': [] })
    vi.mocked(readDir).mockRejectedValueOnce(new Error('directory denied'))

    await expect(backupCoreExecutables()).rejects.toThrow('directory denied')
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('恢复失败保留新内核与剩余备份，重试可完成恢复', async () => {
    const fs = installMemoryFs({
      'resource/core': ['new-core.exe', 'partial.exe', 'pkg.zip'],
      'resource/core-previous': ['easytier-core.exe', 'easytier-cli.exe']
    })
    const renameFile = vi.mocked(rename).getMockImplementation()!
    let fail = true
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (fail && from === 'resource/core-previous/easytier-cli.exe') {
        fail = false
        throw new Error('backup locked')
      }
      await renameFile(from, to)
    })

    await expect(restoreCoreExecutables('resource/core-previous')).resolves.toBe(false)

    expect(fs.get('resource/core')).toContain('pkg.zip')
    expect(fs.get('resource/core-previous')).toContain('easytier-cli.exe')
    expect([...fs.values()].some((names) => names.includes('new-core.exe'))).toBe(true)
    expect(
      vi.mocked(remove).mock.calls.some(([path]) => path === 'resource/core/new-core.exe')
    ).toBe(false)

    await expect(restoreCoreExecutables('resource/core-previous')).resolves.toBe(true)

    expect(fs.get('resource/core')).toEqual(
      expect.arrayContaining(['pkg.zip', 'easytier-core.exe', 'easytier-cli.exe'])
    )
    expect(fs.has('resource/core-previous')).toBe(false)
  })

  it('丢弃指定备份时递归删除备份目录', async () => {
    await discardCoreBackup('resource/core-previous-test')
    expect(remove).toHaveBeenCalledWith(
      'resource/core-previous-test',
      expect.objectContaining({ recursive: true })
    )
  })
})
