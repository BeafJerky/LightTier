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

import { readDir, remove } from '@tauri-apps/plugin-fs'
import { cleanCoreDirExceptPackages, isCorePackageFile, isSafeZipEntryPath } from '@/utils/fileUtil'

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
