/**
 * useConfigDetail 单测：演示数据、读取/解析错误态与快速切换的过期请求丢弃
 */
import { describe, it, expect, vi } from 'vitest'
import { useConfigDetail } from '@/features/configs/composables/useConfigDetail'

const createDetail = (opts: {
  isTauri: boolean
  read?: (path: string, options?: { throwOnError?: boolean }) => Promise<string | ArrayBuffer>
}) => {
  const writeFileWithBackup = vi.fn(async () => {})
  const detail = useConfigDetail({
    readFileContent: opts.read ?? (async () => ''),
    writeFileWithBackup,
    isTauri: opts.isTauri,
    t: (key: string) => key
  })
  return { detail, writeFileWithBackup }
}

describe('useConfigDetail', () => {
  it('Mock 环境无 fileName 时展示对应演示配置', async () => {
    const { detail } = createDetail({ isTauri: false })
    await detail.loadConfigDetail({ configFileName: '家庭局域网' })
    expect(detail.detailState.value).toBe('demo')
    expect(detail.selectedDetail.value?.hostname).toBe('home-router')
  })

  it('Tauri 环境读取失败 / 空内容进入错误态', async () => {
    const readFail = createDetail({
      isTauri: true,
      read: async () => {
        throw new Error('io')
      }
    })
    await readFail.detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })
    expect(readFail.detail.detailState.value).toBe('error')
    expect(readFail.detail.detailError.value).toEqual({ kind: 'read', message: '' })

    const empty = createDetail({ isTauri: true, read: async () => '   ' })
    await empty.detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })
    expect(empty.detail.detailError.value).toEqual({ kind: 'empty', message: '' })
  })

  it('读取配置时强制抛出 I/O 错误，避免调用方退回默认吞错实现', async () => {
    const read = vi.fn(async () => 'hostname = "node-a"')
    const { detail } = createDetail({ isTauri: true, read })

    await detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })

    expect(read).toHaveBeenCalledWith('config/a.toml', { throwOnError: true })
  })

  it('TOML 解析失败记录 parse 错误与原始信息', async () => {
    const { detail } = createDetail({ isTauri: true, read: async () => 'hostname = [' })
    await detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })
    expect(detail.detailState.value).toBe('error')
    expect(detail.detailError.value?.kind).toBe('parse')
    expect(detail.detailError.value?.message).toBeTruthy()
  })

  it('解析成功进入 ready 并重置路由筛选', async () => {
    const { detail } = createDetail({
      isTauri: true,
      read: async () => 'hostname = "node-a"\nroutes = ["10.0.0.0/8"]'
    })
    detail.routeFilter.value = '不存在的路由'
    await detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })
    expect(detail.detailState.value).toBe('ready')
    expect(detail.selectedDetail.value?.hostname).toBe('node-a')
    expect(detail.routeFilter.value).toBe('')
    expect(detail.filteredRoutes.value).toEqual(['10.0.0.0/8'])
  })

  it('旧标记迁移通过带备份的安全写入，备份失败不覆盖原文件', async () => {
    const { detail, writeFileWithBackup } = createDetail({
      isTauri: true,
      read: async () => '# 保留原文件\nconfig_exit_nodes_route = true\nhostname = "node-a"\n'
    })
    writeFileWithBackup.mockRejectedValueOnce(new Error('backup failed'))

    await detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })

    expect(detail.detailState.value).toBe('ready')
    expect(writeFileWithBackup).toHaveBeenCalledWith(
      'config/a.toml',
      expect.stringContaining('[lighttier]')
    )
  })

  it('快速切换配置时丢弃先发出的过期请求', async () => {
    let resolveFirst: ((value: string) => void) | undefined
    const read = vi.fn((path: string) => {
      if (path.includes('a.toml')) {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve('hostname = "node-b"')
    })
    const { detail } = createDetail({ isTauri: true, read })

    const first = detail.loadConfigDetail({ configFileName: 'A', fileName: 'a.toml' })
    const second = detail.loadConfigDetail({ configFileName: 'B', fileName: 'b.toml' })
    resolveFirst?.('hostname = "node-a"')
    await Promise.all([first, second])

    expect(detail.selectedDetail.value?.hostname).toBe('node-b')
    expect(detail.detailState.value).toBe('ready')
  })
})
