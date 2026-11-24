import { CONFIG_PATH } from '@/shared/constants/easytier'
import { runTomlTransaction } from '@/shared/platform/webConfigStorage'

export interface ConfigTomlFileIo {
  readFileContent: (path: string, options?: { throwOnError?: boolean }) => Promise<string>
  writeFileContent: (path: string, content: string) => Promise<void>
}

export class ConfigBackupError extends Error {
  constructor() {
    super('backup failed')
    this.name = 'ConfigBackupError'
  }
}

/** Android 编辑页落盘边界：编辑模式先备份旧文件，再写入编辑器最终内容（含导入内容）。 */
export const saveConfigToml = async (
  name: string,
  content: string,
  mode: 'add' | 'edit',
  io: ConfigTomlFileIo
): Promise<void> =>
  runTomlTransaction(async () => {
    if (mode === 'edit') {
      try {
        const previous = await io.readFileContent(`${CONFIG_PATH}/${name}.toml`, {
          throwOnError: true
        })
        await io.writeFileContent(`${CONFIG_PATH}/${name}.toml.bak`, previous)
      } catch {
        throw new ConfigBackupError()
      }
    }
    await io.writeFileContent(`${CONFIG_PATH}/${name}.toml`, content)
  })
