/**
 * 文件与资源工具层 — 基于 Tauri FS / HTTP / Shell 插件的统一封装
 *
 * 路径约定：所有文件操作基于 BaseDirectory（Android: AppData / 桌面: Resource），
 * 只传相对路径，禁止用 resourceDir() 拼绝对路径后传入；
 * 职责：目录检查创建、文件读写/列举/删除、内置 config.json 读写、下载（放宽
 * GitHub 重定向）、解压（fflate，剥离压缩包公共前缀目录）、打开系统路径与日志清理。
 * 防护（M-03）：下载限协议/大小/zip 魔数，临时文件校验后原子替换；解压限条目数与
 * 总大小、拦截 zip-slip 穿越条目，Unix 桌面解压后补内核可执行位。
 */
import { CONFIG_PATH, CORE_PATH, LOG_PATH, RESOURCE_PATH, USER_AGENT } from '@/constants/easytier'
import { dirname, extname, join, resourceDir } from '@tauri-apps/api/path'
import {
  BaseDirectory,
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
import { attachConsole, error, info } from '@tauri-apps/plugin-log'
import { Command, open } from '@tauri-apps/plugin-shell'
import { unzipSync } from 'fflate'
import { isAndroid } from './platformUtil'
import { getPlatform } from './sysUtil'
import { isKernelLogFile } from './coreLogUtil'
import pkg from '../../package.json'

// 启用 TargetKind::Webview 后，这个函数将把日志打印到浏览器控制台
attachConsole()

// 运行时基础目录：Android 使用应用数据目录（AppData），桌面使用打包资源目录（Resource）
const getBaseDir = (): BaseDirectory =>
  isAndroid() ? BaseDirectory.AppData : BaseDirectory.Resource

// === 下载与解压防护阈值（相对内核包体非常宽松的护栏，防镜像异常内容与 zip bomb） ===
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024 // 单文件下载上限 200MB
const MAX_EXTRACT_ENTRIES = 500 // 解压条目数上限
const MAX_EXTRACT_TOTAL_BYTES = 500 * 1024 * 1024 // 解压后总大小上限 500MB
// 下载进度上报节流：避免大包逐块触发高频 UI 更新
const DOWNLOAD_PROGRESS_INTERVAL_MS = 80

/** 下载进度：total 为 null 表示服务端未返回 Content-Length，只能展示已下载字节数 */
export interface DownloadProgress {
  received: number
  total: number | null
}

type DownloadProgressCallback = (progress: DownloadProgress) => void

/** Unix 桌面（linux/macos）：解压内核后需要补可执行位 */
const needsExecutableBit = (): boolean => {
  try {
    const p = getPlatform()
    return p === 'linux' || p === 'macos'
  } catch {
    return false
  }
}

/** zip 条目路径安全校验：拒绝绝对路径（/ 开头、盘符）与 .. 穿越，防 zip-slip（导出供测试） */
export const isSafeZipEntryPath = (entryPath: string): boolean => {
  if (!entryPath || entryPath.includes('\0')) return false
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(entryPath)) return false
  return entryPath.split(/[\\/]/).every((seg) => seg !== '..')
}

/**
 * Unix 桌面：批量补可执行位（chmod +x，经 shell 白名单 sh 执行）
 * 路径经参数数组传递（sh -c 'chmod +x "$@"'），不做字符串拼接，避免引号注入
 */
const grantExecutableBits = async (paths: string[]): Promise<boolean> => {
  try {
    const command = Command.create('sh', ['-c', 'chmod +x "$@"', 'lt-chmod', ...paths])
    const output = await command.execute()
    if (output.code !== 0) {
      error(`chmod 失败(code=${output.code}):${output.stderr || output.stdout}`)
      return false
    }
    return true
  } catch (e: any) {
    error(`chmod 执行出错:${JSON.stringify(e)}`)
    return false
  }
}

/**
 * 确保目录存在（不存在则递归创建）
 * 传入文件路径时自动取父目录；基址随平台（Android: AppData / 桌面: Resource）
 */
export const checkDir = async (dirPath: string = RESOURCE_PATH) => {
  try {
    try {
      // @ts-ignore
      const _e = await extname(dirPath)
      // 有扩展名视为文件路径，取其父目录；无扩展名（如 resource/core）视为目录本身
      if (_e) {
        dirPath = await dirname(dirPath)
      }
    } catch (_error) {
      /* empty */
    }
    const dirExists = await exists(dirPath, { baseDir: getBaseDir() })
    if (!dirExists) {
      await mkdir(dirPath, { baseDir: getBaseDir(), recursive: true })
    }
  } catch (e: any) {
    error(`创建resource目录时出错:${JSON.stringify(e)}`)
    throw e
  }
}

// 检测文件是否存在，不存在则创建空文件
export const fileExist = async (filePath: string) => {
  const exist = await exists(filePath, { baseDir: getBaseDir() })
  if (!exist) {
    await writeFileContent(filePath, '', { baseDir: getBaseDir() })
  }
  return exist
}
// 获取resource目录，如果resource目录不存在，则调用checkResourceDir创建，最终返回带'resource'后缀的目录
export const getResourceDir = async () => {
  await checkDir()
  return await join(await resourceDir(), RESOURCE_PATH)
}
// 获取 easytier-cli 可执行文件路径（同时确保 core 目录存在）
export const getCliDir = async () => {
  await checkDir(CORE_PATH)
  return await join(await resourceDir(), CORE_PATH, 'easytier-cli')
}
// 获取 easytier-core 可执行文件路径（同时确保 core 目录存在）
export const getCoreDir = async () => {
  await checkDir(CORE_PATH)
  return await join(await resourceDir(), CORE_PATH, 'easytier-core')
}
// 获取resource下的logs目录
export const getLogsDir = async () => {
  await checkDir(LOG_PATH)
  return await join(await resourceDir(), LOG_PATH)
}

/**
 * 写入内容到文件
 * 1.支持写入字符串或二进制数据 (Uint8Array)
 * 2.可以指定基础目录 (默认为 AppData)
 * 3.支持追加模式和创建新文件的选项
 * 4.包含完整的错误处理
 * @param filePath 文件路径
 * @param content 写入的内容
 * @param options 可选参数
 *
 * 使用示例:
 * ```
 *  await writeFileContent('config.json', '{"setting": "value"}');
 *   // 使用选项
 *   await writeFileContent('data.txt', 'content', {
 *     baseDir: BaseDirectory.AppConfig,
 *     append: true,
 *     createNew: false
 *   });
 *   // 写入二进制数据
 *   const binaryData = new Uint8Array([1, 2, 3]);
 *   await writeFileContent('data.bin', binaryData);
 * ```
 */
export async function writeFileContent(
  filePath: string,
  content: string | Uint8Array,
  options?: {
    baseDir?: BaseDirectory // 基础目录
    append?: boolean // 是否追加模式
    createNew?: boolean // 是否创建新文件
  }
): Promise<void> {
  try {
    const finalOptions = { baseDir: getBaseDir(), append: false, ...options }
    await checkDir(filePath)
    if (typeof content === 'string') {
      // 使用 writeTextFile 处理字符串内容
      await writeTextFile(filePath, content, finalOptions)
    } else {
      // 二进制内容继续使用 writeFile
      await writeFile(filePath, content, finalOptions)
    }
  } catch (e: any) {
    error(`写入文件时出错:${JSON.stringify(e)}`)
    throw e
  }
}

/**
 * 读取文件内容的通用方法
 * @param filePath 文件路径
 * @param options 可选参数
 * @returns Promise<string | Uint8Array> 返回文件内容，如果 asBinary 为 true 则返回 Uint8Array，否则返回字符串
 *
 * 使用示例:
 * ```typescript
 * // 读取文本文件
 * const textContent = await readFileContent('config.json');
 *
 * // 读取二进制文件
 * const binaryContent = await readFileContent('data.bin', { asBinary: true });
 *
 * // 从特定目录读取
 * const configContent = await readFileContent('settings.json', {
 *   baseDir: BaseDirectory.AppConfig
 * });
 * ```
 */
export async function readFileContent(
  filePath: string,
  options?: {
    baseDir?: BaseDirectory // 基础目录
    asBinary?: boolean // 是否以二进制方式读取
  }
): Promise<string | Uint8Array> {
  try {
    const { baseDir = getBaseDir(), asBinary = false } = options || {}
    await checkDir(filePath)
    if (asBinary) {
      const content = await readFile(filePath, { baseDir })
      return content
    } else {
      const content = await readTextFile(filePath, { baseDir })
      return content
    }
  } catch (e: any) {
    if (!JSON.stringify(e).includes('系统找不到指定的文件')) {
      error(`Error reading file ${filePath}:${JSON.stringify(e)}`)
    }
    return ''
  }
}

// 列出目录下的所有文件
export const listFiles = async (targetDir: string = RESOURCE_PATH) => {
  try {
    await checkDir(targetDir)
    const entries = await readDir(targetDir, { baseDir: getBaseDir() })
    return entries.map((entry) => entry.name)
  } catch (e: any) {
    error(`Error listing resource files:${JSON.stringify(e)}`)
    return []
  }
}

// 列出 resource 目录下的所有 .toml 文件
export const listTomlFiles = async (targetDir: string = CONFIG_PATH) => {
  try {
    // @ts-ignore
    const _ = await checkDir(targetDir)

    const entries = await readDir(targetDir, { baseDir: getBaseDir() })
    return entries.filter((entry) => entry.name.endsWith('.toml')).map((entry) => entry.name)
  } catch (e: any) {
    error(`Error listing resource files:${JSON.stringify(e)}`)
    return []
  }
}

// 写入 resource 目录下的 config.json 文件
export const writeConfigJsonObj = async (obj: any) => {
  const configJsonPath = await join(RESOURCE_PATH, 'config.json')
  await checkDir(configJsonPath)
  await writeFileContent(configJsonPath, JSON.stringify(obj), {
    baseDir: getBaseDir()
  })
}

// 读取 resource 目录下的 config.json 文件，并返回 JSON 对象
export const getConfigJsonObj = async () => {
  try {
    const configJsonPath = await join(RESOURCE_PATH, 'config.json')
    await checkDir(configJsonPath)
    const configJson = await readFileContent(configJsonPath, {
      baseDir: getBaseDir()
    })
    return JSON.parse(configJson as string)
  } catch (e: any) {
    error(`读取配置文件失败:${JSON.stringify(e)}`)
    await writeConfigJsonObj({})
    return {}
  }
}

/**
 * 强制删除指定路径的文件或目录
 * @param path 路径
 */
export const deleteFileOrDir = async (path: string) => {
  await remove(path, { baseDir: getBaseDir(), recursive: true })
}

/** 内核包判定：core 目录下仅 .zip 安装包在切换版本时保留（供状态展示与离线重装） */
export const isCorePackageFile = (name: string): boolean => /\.zip$/i.test(name)

/**
 * 安装前清理内核目录：保留各版本 .zip 安装包，删除旧内核可执行文件、DLL 与
 * 未完成的下载临时文件，避免切换版本后残留旧组件。
 * 返回 false 表示存在无法删除的条目（通常仍被进程占用），调用方应中止安装。
 */
export const cleanCoreDirExceptPackages = async (): Promise<boolean> => {
  let ok = true
  try {
    const entries = await readDir(CORE_PATH, { baseDir: getBaseDir() })
    for (const entry of entries) {
      if (entry.isFile && isCorePackageFile(entry.name)) continue
      try {
        await remove(await join(CORE_PATH, entry.name), {
          baseDir: getBaseDir(),
          recursive: true
        })
      } catch (e: any) {
        ok = false
        error(`清理旧内核文件失败 ${entry.name}:${JSON.stringify(e)}`)
      }
    }
  } catch (e: any) {
    error(`列出内核目录失败:${JSON.stringify(e)}`)
    return false
  }
  return ok
}

/**
 * 读取响应体并回报下载进度：优先流式读取（边下边校验大小上限），
 * 环境不支持 ReadableStream 时退回一次性读取。返回 null 表示超出大小上限。
 */
const readBodyWithProgress = async (
  response: Response,
  total: number | null,
  onProgress?: DownloadProgressCallback
): Promise<Uint8Array | null> => {
  let lastReportAt = 0
  const emit = (received: number, force = false) => {
    if (!onProgress) return
    const now = Date.now()
    if (!force && now - lastReportAt < DOWNLOAD_PROGRESS_INTERVAL_MS) return
    lastReportAt = now
    try {
      onProgress({ received, total })
    } catch {
      /* 进度回调异常不应中断下载 */
    }
  }

  // 无流式响应体：整包读取后一次回报（首帧仍先给出 0 进度）
  if (!response.body || typeof response.body.getReader !== 'function') {
    emit(0, true)
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      error(`下载文件超过大小上限:${buffer.byteLength}`)
      return null
    }
    emit(buffer.byteLength, true)
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  emit(0, true)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      // 实际包体上限边下边复核，避免无 Content-Length 时先落盘超大文件
      if (received > MAX_DOWNLOAD_BYTES) {
        error(`下载文件超过大小上限:${received}`)
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
      emit(received)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 流已中止时忽略释放异常 */
    }
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  emit(received, true)
  return merged
}

/**
 * 下载文件
 * @param fileUrl 文件URL
 * @param onProgress 下载进度回调（首帧为 0，流式读取期间约每 80ms 一次，结束时必有一次）
 * @returns 下载是否成功
 * 使用示例：
 * ```typescript
 * const success = await downloadFile('https://example.com/file.zip', ({ received, total }) => {
 *   console.log(total ? `${Math.round((received / total) * 100)}%` : received)
 * });
 * ```
 */
export async function downloadFile(
  fileUrl: string,
  onProgress?: DownloadProgressCallback
): Promise<boolean> {
  try {
    // 协议层防线：仅允许 http/https（镜像源可自定义，不做域名白名单）
    let url: URL
    try {
      url = new URL(fileUrl)
    } catch {
      error(`下载地址非法:${fileUrl}`)
      return false
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      error(`不支持的下载协议:${url.protocol}`)
      return false
    }

    info(`开始下载:${fileUrl}`)
    // 使用 Tauri 的 http plugin
    const response = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      // 增加超时时间
      connectTimeout: 30000,
      // GitHub release 下载会重定向到 objects.githubusercontent.com（可能多次），适当放宽使下载稳定
      maxRedirections: 5
    })
    if (!response.ok) {
      // 失败交由调用方统一提示
      return false
    }

    // 文件名：取 URL path 末段并清理非法字符（防路径穿越/覆盖非预期文件）
    let rawName = url.pathname.split('/').pop() || ''
    try {
      rawName = decodeURIComponent(rawName)
    } catch {
      /* 非法转义序列保持原样，交由下方清理 */
    }
    const filename = rawName
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/^\.+/, '')
      .replace(/[\s.]+$/, '')
    if (!filename) {
      error(`无法从下载地址解析文件名:${fileUrl}`)
      return false
    }

    // Content-Length 预检（存在时提前拒绝超限包体）；缺失/为 0 时进度只展示已下载字节
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      error(`下载文件超过大小上限(${contentLength} > ${MAX_DOWNLOAD_BYTES}):${fileUrl}`)
      return false
    }
    const total = contentLength > 0 ? contentLength : null

    // 构建保存路径（核心独立存放在 resource/core 下）
    const savePath = await join(CORE_PATH, filename)

    // 确保目录存在
    await checkDir(CORE_PATH)

    // 流式读取响应体并回报进度，同时做实际包体上限复核
    const uint8Array = await readBodyWithProgress(response, total, onProgress)
    if (!uint8Array) return false

    // zip 魔数校验（"PK"）：拒绝镜像站返回的 HTML 错误页等非压缩包内容，避免污染本地安装包
    if (!(uint8Array[0] === 0x50 && uint8Array[1] === 0x4b)) {
      error(`下载内容不是有效的 zip 包:${fileUrl}`)
      return false
    }

    info(`开始写入文件:${savePath}`)
    // 先写临时文件、校验通过后原子替换目标，不破坏已存在的可用安装包
    const tmpPath = savePath + '.download'
    try {
      await writeFileContent(tmpPath, uint8Array, {
        baseDir: getBaseDir()
      })
      await rename(tmpPath, savePath, {
        oldPathBaseDir: getBaseDir(),
        newPathBaseDir: getBaseDir()
      })
    } catch (e) {
      // 清理未落位的临时文件（尽力而为，忽略清理失败）
      await remove(tmpPath, { baseDir: getBaseDir() }).catch(() => {})
      throw e
    }

    return true
  } catch (e: any) {
    error(`下载文件时出错:${JSON.stringify(e)}`)
    return false
  }
}

/**
 * 1.在资源管理器中打开指定目录
 * 2.在浏览器中打开指定网址
 * @param path 要打开的目录路径或网址
 */
export async function openPath(path: string) {
  try {
    await open(path)
  } catch (e: any) {
    error(`打开资源管理器失败:${JSON.stringify(e)}`)
  }
}

/**
 * 解压文件到指定目录，支持处理多层目录
 * @param zipPath 压缩文件路径（相对于 Resource 目录）
 * @param destPath 解压目标目录（相对于 Resource 目录）
 * @param keepDir   是否保留原路径
 * @param beforeWrite 写入前回调（如清理旧内核文件）；返回 false 则中止解压
 * @returns Promise<boolean> 解压是否成功
 */
export async function extractFile(
  zipPath: string,
  destPath: string,
  keepDir: boolean = false,
  beforeWrite?: () => Promise<boolean>
): Promise<boolean> {
  try {
    // 读取zip文件内容  resource\easytier-windows-x86_64-v2.0.3.zip
    const zipContent = (await readFileContent(zipPath, {
      baseDir: getBaseDir(),
      asBinary: true
    })) as Uint8Array

    // 使用 fflate 解压
    const files = unzipSync(zipContent)

    // 安全闸 1：条目数与解压后总大小上限（防 zip bomb）
    const paths = Object.keys(files)
    if (paths.length > MAX_EXTRACT_ENTRIES) {
      error(`压缩包条目数超限(${paths.length} > ${MAX_EXTRACT_ENTRIES}):${zipPath}`)
      return false
    }
    // 空包/仅目录的 zip 也属合法压缩格式，必须在清理旧内核前拒绝
    if (!paths.some((p) => !p.endsWith('/'))) {
      error(`压缩包不包含可释放的内核文件:${zipPath}`)
      return false
    }
    let totalBytes = 0
    for (const data of Object.values(files)) totalBytes += data.length
    if (totalBytes > MAX_EXTRACT_TOTAL_BYTES) {
      error(`压缩包解压后大小超限(${totalBytes} > ${MAX_EXTRACT_TOTAL_BYTES}):${zipPath}`)
      return false
    }
    // 预校验全部条目：压缩包非法时直接中止，避免清理旧内核后又只写入部分文件
    const unsafeEntry = paths.find((p) => !isSafeZipEntryPath(p))
    if (unsafeEntry) {
      error(`压缩包包含非法条目(${unsafeEntry})，已中止解压:${zipPath}`)
      return false
    }

    // 待解压内容校验通过后再执行前置清理（如删除旧内核文件）：
    // 压缩包缺失/损坏/非法时不会误删当前可用内核
    if (beforeWrite && !(await beforeWrite())) {
      error(`解压前置清理失败，已中止:${zipPath}`)
      return false
    }

    // 分析目录结构，找到最深的公共目录
    // easytier-windows-x86_64/
    const commonPrefix = await findCommonPrefix(paths)
    // Unix 桌面解压出的内核二进制需补可执行位，先收集目标绝对路径，解压完成后统一 chmod
    const needExecBit = needsExecutableBit()
    const executables: string[] = []
    let writeFailed = false
    // 写入解压后的文件
    for (const [filePath, fileData] of Object.entries(files)) {
      try {
        // filePath:easytier-windows-x86_64/easytier-cli.exe
        // 如果文件在子目录中，去掉公共前缀  easytier-cli.exe
        const relativePath = commonPrefix ? filePath.replace(commonPrefix, '') : filePath
        // 跳过目录项
        if (relativePath.endsWith('/')) continue

        // 安全闸 2：zip-slip 防护——拒绝绝对路径 / 含 .. 的穿越条目
        if (!isSafeZipEntryPath(relativePath) || !isSafeZipEntryPath(filePath)) {
          error(`跳过非法压缩包条目:${filePath}`)
          continue
        }

        // 构建目标文件路径 resource\easytier-cli.exe
        let targetPath: string
        if (keepDir) {
          targetPath = await join(destPath, filePath)
        } else {
          targetPath = await join(destPath, relativePath)
        }
        // 确保目标目录存在
        await checkDir(await dirname(targetPath))

        // 写入文件
        await writeFileContent(targetPath, fileData, {
          baseDir: getBaseDir()
        })

        // Unix 内核二进制通常无扩展名（easytier-core / easytier-cli），收集以便补执行位
        if (needExecBit && !relativePath.split('/').pop()!.includes('.')) {
          executables.push(await join(await resourceDir(), targetPath))
        }
      } catch (e: any) {
        writeFailed = true
        error(`处理文件 ${filePath} 时出错:${JSON.stringify(e)}`)
      }
    }

    // 任一内核文件写入失败都不能视为安装成功（旧文件已在写入前清理，保留 zip 便于重试）
    if (writeFailed) {
      error(`部分内核文件写入失败，安装未完成:${zipPath}`)
      return false
    }

    // Unix 桌面：补可执行位（无执行位内核无法启动；失败则保留压缩包便于重试）
    if (executables.length > 0) {
      const chmodOk = await grantExecutableBits(executables)
      if (!chmodOk) {
        error(`补充可执行位失败，保留压缩包:${zipPath}`)
        return false
      }
    }

    // 保留 zip：设置页据此展示下载状态，并支持不重新下载直接切换/离线重装
    return true
  } catch (e: any) {
    error(`解压文件时出错:${JSON.stringify(e)}`)
    return false
  }
}

/**
 * 查找所有路径的公共前缀目录
 * @param paths 路径数组
 * @returns 公共前缀
 */
async function findCommonPrefix(paths: string[]): Promise<string> {
  if (paths.length === 0) return ''
  if (paths.length === 1) return await dirname(paths[0])

  // 分割所有路径
  const parts = paths.map((p) => p.split('/').filter(Boolean))

  const prefix: string[] = []
  const firstParts = parts[0]

  for (let i = 0; i < firstParts.length; i++) {
    const part = firstParts[i]
    if (parts.every((p) => p[i] === part)) {
      prefix.push(part)
    } else {
      break
    }
  }

  return prefix.length > 0 ? `${prefix.join('/')}/` : ''
}

// 清空程序logs目录下 pkg name 的日志文件，以免日志文件过大
export const clearLogs = async () => {
  try {
    const logsFile = await join('logs', pkg.name + '.log')
    // 清空 logsFile 的内容（如果失败不影响程序启动）
    await writeFileContent(logsFile, '', { baseDir: getBaseDir() })
  } catch (e: any) {
    // 如果清理失败，只记录警告，不阻塞启动
    error(`清理日志文件失败（不影响使用）: ${e.message || e}`)
  }
}

// 清空 logs 目录下内核日志文件（当前文件 + 轮转/旧版命名的历史文件）
// 仅清空已存在的文件（旧实现按日期拼名会意外创建残留空文件；轮转实际为 easytier.log.N 而非日期后缀）
export const clearETLogs = async (fileName: string) => {
  try {
    const files = await listFiles(LOG_PATH)
    const targets = files.filter((f) => isKernelLogFile(f, fileName))
    for (const target of targets) {
      try {
        await writeFileContent(await join(LOG_PATH, target), '', { baseDir: getBaseDir() })
      } catch (e: any) {
        error(`清理日志文件 ${target} 失败（不影响使用）: ${e.message || e}`)
      }
    }
  } catch (e: any) {
    // 如果清理失败，只记录警告，不阻塞启动
    error(`清理日志文件失败（不影响使用）: ${e.message || e}`)
  }
}
