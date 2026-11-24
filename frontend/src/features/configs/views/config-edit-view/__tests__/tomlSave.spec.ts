import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveConfigToml } from '../tomlSave'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import { runTomlTransaction } from '@/shared/platform/webConfigStorage'

const makeIo = () => ({
  readFileContent: vi.fn(),
  writeFileContent: vi.fn()
})

describe('Android config-edit-view TOML 事务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('编辑保存（包括导入后保存）的旧文件读取、备份和写盘共用队列', async () => {
    const files = new Map([[`${CONFIG_PATH}/demo.toml`, 'hostname = "old"\n']])
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const io = makeIo()
    io.readFileContent.mockImplementationOnce(async () => {
      await gate
      return files.get(`${CONFIG_PATH}/demo.toml`)
    })
    io.writeFileContent.mockImplementation(async (path: string, content: string) => {
      files.set(path, content)
    })

    const save = saveConfigToml('demo', 'hostname = "imported"\n', 'edit', io)
    await vi.waitFor(() => expect(io.readFileContent).toHaveBeenCalledTimes(1))

    const queuedWrite = vi.fn()
    const queued = runTomlTransaction(async () => {
      queuedWrite()
      files.set(`${CONFIG_PATH}/demo.toml`, 'hostname = "newer"\n')
    })
    await Promise.resolve()
    expect(queuedWrite).not.toHaveBeenCalled()

    release()
    await Promise.all([save, queued])

    expect(files.get(`${CONFIG_PATH}/demo.toml.bak`)).toBe('hostname = "old"\n')
    expect(files.get(`${CONFIG_PATH}/demo.toml`)).toBe('hostname = "newer"\n')
  })

  it('新增保存的目标文件写入排在其它 TOML 事务之后', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queuedWrite = vi.fn()
    const queued = runTomlTransaction(async () => {
      await gate
      queuedWrite()
    })

    const io = makeIo()
    const save = saveConfigToml('added', 'hostname = "added"\n', 'add', io)
    await Promise.resolve()
    expect(io.writeFileContent).not.toHaveBeenCalled()

    release()
    await Promise.all([queued, save])

    expect(queuedWrite).toHaveBeenCalledTimes(1)
    expect(io.writeFileContent).toHaveBeenCalledWith(
      `${CONFIG_PATH}/added.toml`,
      'hostname = "added"\n'
    )
  })
})
