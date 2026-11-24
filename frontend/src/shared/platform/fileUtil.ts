/**
 * 文件与资源工具层 — 基于 Tauri FS / HTTP / Shell 插件的统一封装
 *
 * 路径约定：所有文件操作基于 BaseDirectory（Android: AppData / 桌面: Resource），
 * 只传相对路径，禁止用 resourceDir() 拼绝对路径后传入；
 * 职责：目录检查创建、文件读写/列举/删除、内置 config.json 读写、下载（放宽
 * GitHub 重定向）、解压（fflate，剥离压缩包公共前缀目录）、打开系统路径与日志清理。
 * 防护（M-03）：下载限协议/大小/包类型魔数（zip 查 PK、exe 查 MZ），临时文件校验后原子替换；解压限条目数与
 * 总大小、拦截 zip-slip 穿越条目，Unix 桌面解压后补内核可执行位。
 */
import {
  CONFIG_PATH,
  CORE_PATH,
  LOG_PATH,
  RESOURCE_PATH,
  USER_AGENT
} from '@/shared/constants/easytier'
import { dirname, join, resourceDir } from '@tauri-apps/api/path'
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
import { unzipSync } from 'fflate'
import { isAndroid } from './platformUtil'
import * as systemOps from './systemOps'
import { getPlatform } from './sysUtil'
import { verifyManagerPackage } from './updateUtil'
import {
  getConfigLogBaseName,
  getKernelLogScope,
  isActiveKernelLogFile,
  isKernelLogFile,
  pickLogTarget
} from '@/shared/lib/coreLogUtil'
import pkg from '../../../../package.json'

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
// 下载中止阈值：响应头超时、连续无数据（卡死）与低速中止（镜像能连上却几乎不动）
const DEFAULT_RESPONSE_TIMEOUT_MS = 20000
const DEFAULT_STALL_TIMEOUT_MS = 15000
const DEFAULT_SLOW_GRACE_MS = 10000
// 下载前吞吐采样：窗口与单源上限（只需区分“能用/极慢/不通”，不追求精确带宽）
const SPEED_SAMPLE_WINDOW_MS = 1800
const SPEED_SAMPLE_MAX_BYTES = 256 * 1024
const SPEED_SAMPLE_RESPONSE_TIMEOUT_MS = 5000

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
    await systemOps.ensureExecutable(paths)
    return true
  } catch (e: any) {
    error(`chmod 执行出错:${JSON.stringify(e)}`)
    return false
  }
}

/**
 * 确保目录存在（不存在则递归创建）。
 * 只接受目录路径；文件写入前用 ensureParentDir，避免按扩展名猜测路径类型。
 */
export const checkDir = async (dirPath: string = RESOURCE_PATH) => {
  try {
    const dirExists = await exists(dirPath, { baseDir: getBaseDir() })
    if (!dirExists) {
      await mkdir(dirPath, { baseDir: getBaseDir(), recursive: true })
    }
  } catch (e: any) {
    error(`创建resource目录时出错:${JSON.stringify(e)}`)
    throw e
  }
}

const ensureParentDir = async (filePath: string): Promise<void> => {
  await checkDir(await dirname(filePath))
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

// 内核按配置隔离的日志子目录根（相对 logs）
const KERNEL_LOG_ROOT = `${LOG_PATH}/kernel`
// Web 配置没有本地配置名，使用保留作用域，避免与用户配置目录冲突
const WEB_KERNEL_LOG_SCOPE = '__web__'

/**
 * 获取某配置的内核日志目录（绝对路径，供 easytier-core 的 --file-log-dir 使用）
 * 目录在 logs/kernel/<scope> 下创建；EasyTier 只支持固定文件名 easytier.log，
 * 按配置分目录是避免多实例日志交错与轮转互相覆盖的唯一可行方式。
 */
export const getKernelLogsDir = async (configFileName: string): Promise<string> => {
  const scope = getKernelLogScope(configFileName)
  const relative = `${KERNEL_LOG_ROOT}/${scope}`
  await mkdir(relative, { baseDir: getBaseDir(), recursive: true })
  return await join(await getLogsDir(), 'kernel', scope)
}

/** Web 配置的内核日志目录（无本地配置名，使用保留作用域隔离） */
export const getWebKernelLogsDir = async (): Promise<string> =>
  getKernelLogsDir(WEB_KERNEL_LOG_SCOPE)

/**
 * 定位某配置当前可读的内核日志文件：
 * 1. 优先新布局 logs/kernel/<scope>/
 * 2. 回退旧版共享目录 logs/（旧版 {configName}.log 与共享 easytier.log）
 * 返回 null 表示没有任何可读日志（与“日志为空”区分）。
 */
export interface KernelLogLocation {
  dir: string
  file: string
}

export const resolveKernelLogFile = async (
  configName: string
): Promise<KernelLogLocation | null> => {
  const scopedDir = `${KERNEL_LOG_ROOT}/${getKernelLogScope(configName)}`
  const scopedFiles = await listFiles(scopedDir, true)
  const scopedTarget = pickLogTarget(scopedFiles, configName)
  if (scopedFiles.includes(scopedTarget)) return { dir: scopedDir, file: scopedTarget }

  const legacyFiles = await listFiles(LOG_PATH, true)
  // 旧版共享目录中按配置名写入的文件属于本配置，优先于可能被其他实例共写的 easytier.log
  const baseName = getConfigLogBaseName(configName)
  if (baseName && legacyFiles.includes(`${baseName}.log`)) {
    return { dir: LOG_PATH, file: `${baseName}.log` }
  }
  const legacyTarget = pickLogTarget(legacyFiles, configName)
  if (legacyFiles.includes(legacyTarget)) return { dir: LOG_PATH, file: legacyTarget }
  return null
}

export interface FileWriteOptions {
  baseDir?: BaseDirectory
  append?: boolean
  createNew?: boolean
}

let temporaryFileSequence = 0
const createTemporaryPath = (filePath: string): string => {
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
  temporaryFileSequence = (temporaryFileSequence + 1) >>> 0
  return `${filePath}.lt-tmp-${Date.now().toString(36)}-${temporaryFileSequence.toString(36)}-${random}`
}

/**
 * 写入文本或二进制内容，写入前确保父目录存在。
 * 默认先写唯一临时文件再 rename 到目标，避免中断留下半文件或并发写互相覆盖；
 * append/createNew 需保留原语义，走直接写入。
 * 失败时清理临时文件、记录路径与原错误后重抛，调用方据此决定回滚或提示。
 */
export async function writeFileContent(
  filePath: string,
  content: string | Uint8Array,
  options: FileWriteOptions = {}
): Promise<void> {
  const { baseDir = getBaseDir(), append = false, createNew = false } = options
  if (append || createNew) {
    try {
      await ensureParentDir(filePath)
      if (typeof content === 'string') {
        await writeTextFile(filePath, content, { baseDir, append, createNew })
      } else {
        await writeFile(filePath, content, { baseDir })
      }
    } catch (cause) {
      error(`写入文件失败 ${filePath}:${JSON.stringify(cause)}`)
      throw cause
    }
    return
  }
  let tmpPath = ''
  try {
    await ensureParentDir(filePath)
    for (let attempt = 0; attempt < 16; attempt++) {
      tmpPath = createTemporaryPath(filePath)
      try {
        if (typeof content === 'string') {
          await writeTextFile(tmpPath, content, { baseDir, createNew: true })
        } else {
          await writeFile(tmpPath, content, { baseDir, createNew: true })
        }
        break
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (!/already ?exists|file exists|os error 183|系统存在指定的文件/i.test(message)) {
          throw cause
        }
        if (attempt === 15) throw cause
      }
    }
    await rename(tmpPath, filePath, {
      oldPathBaseDir: baseDir,
      newPathBaseDir: baseDir
    })
  } catch (cause) {
    if (tmpPath) await remove(tmpPath, { baseDir }).catch(() => {})
    error(`写入文件失败 ${filePath}:${JSON.stringify(cause)}`)
    throw cause
  }
}

/** 判断是否为「文件不存在」类错误：这类读取失败按空内容处理，其余错误需要留日志 */
const isMissingFileError = (cause: unknown): boolean => {
  const text = cause instanceof Error ? `${cause.name} ${cause.message}` : JSON.stringify(cause)
  return /not ?found|no such file|os error 2|系统找不到指定的文件/i.test(text ?? '')
}

export interface FileReadOptions {
  baseDir?: BaseDirectory
  asBinary?: boolean
  /** 数据关键路径开启：读取失败直接抛错，避免把异常当成空内容写回覆盖 */
  throwOnError?: boolean
}

/**
 * 读取文件内容。
 * 默认把「文件不存在」和读取失败都折叠为空字符串；需要区分两者时传 throwOnError。
 */
export async function readFileContent(
  filePath: string,
  options: FileReadOptions = {}
): Promise<string | Uint8Array> {
  const { baseDir = getBaseDir(), asBinary = false, throwOnError = false } = options
  try {
    await ensureParentDir(filePath)
    return asBinary
      ? await readFile(filePath, { baseDir })
      : await readTextFile(filePath, { baseDir })
  } catch (cause) {
    if (throwOnError) throw cause
    if (!isMissingFileError(cause)) {
      error(`读取文件失败 ${filePath}:${JSON.stringify(cause)}`)
    }
    return ''
  }
}

/**
 * 判断文件是否存在（与读写使用同一 BaseDirectory）。
 * 存在性检查本身失败时抛错，避免调用方把“无法确认”当成“文件不存在”后覆盖数据。
 */
export const fileExists = async (filePath: string): Promise<boolean> => {
  return await exists(filePath, { baseDir: getBaseDir() })
}

/**
 * 带备份的安全写入：覆盖前把上一份内容保存为 `<file>.bak`。
 * 无法读取旧内容（非“不存在”）时中止写入，避免在旧数据损坏/不可读时直接覆盖。
 */
export const writeFileWithBackup = async (filePath: string, content: string): Promise<void> => {
  if (await fileExists(filePath)) {
    const previous = (await readFileContent(filePath, { throwOnError: true })) as string
    await writeFileContent(`${filePath}.bak`, previous)
  }
  await writeFileContent(filePath, content)
}

// 列出目录下的所有文件（只读；目录不存在时返回空数组，不隐式创建）
// silent：轮询类读取在目录尚未生成时不应反复写错误日志
export const listFiles = async (targetDir: string = RESOURCE_PATH, silent = false) => {
  try {
    const entries = await readDir(targetDir, { baseDir: getBaseDir() })
    return entries.map((entry) => entry.name)
  } catch (e: any) {
    if (!silent) error(`Error listing resource files:${JSON.stringify(e)}`)
    return []
  }
}

export interface ListTomlFilesOptions {
  /** 数据关键路径开启：目录不存在可创建，但创建/列举失败必须抛错 */
  throwOnError?: boolean
}

// 列出配置目录下的 .toml 文件名；默认保持既有容错，关键备份路径可要求严格失败
export const listTomlFiles = async (
  targetDir: string = CONFIG_PATH,
  options: ListTomlFilesOptions = {}
): Promise<string[]> => {
  try {
    await checkDir(targetDir)
    const entries = await readDir(targetDir, { baseDir: getBaseDir() })
    return entries.flatMap((entry) => (entry.name.endsWith('.toml') ? [entry.name] : []))
  } catch (cause) {
    error(`列举配置目录失败 ${targetDir}:${JSON.stringify(cause)}`)
    if (options.throwOnError) throw cause
    return []
  }
}

// 写入 resource 目录下的 config.json 文件
export const writeConfigJsonObj = async (obj: any) => {
  const configJsonPath = await join(RESOURCE_PATH, 'config.json')
  await ensureParentDir(configJsonPath)
  await writeFileContent(configJsonPath, JSON.stringify(obj), {
    baseDir: getBaseDir()
  })
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
/** 上一版固定备份目录；新安装使用独立会话目录，避免覆盖失败现场 */
export const CORE_BACKUP_PATH = 'resource/core-previous'

const createCoreRecoveryDir = async (prefix: string): Promise<string> => {
  for (let attempt = 0; attempt < 16; attempt++) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
    const path = `${prefix}-${Date.now().toString(36)}-${random}`
    try {
      await mkdir(path, { baseDir: getBaseDir() })
      return path
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!/already ?exists|file exists|os error 183/i.test(message) || attempt === 15) throw cause
    }
  }
  throw new Error('无法创建内核恢复目录')
}

const isCoreBackupPath = (path: string): boolean =>
  path === CORE_BACKUP_PATH || /^resource\/core-previous-[a-z0-9-]+$/.test(path)

class CoreBackupRollbackError extends Error {
  readonly code = 'core_backup_rollback_failed'
  readonly backupPath: string
  readonly rollbackCause: unknown

  constructor(backupPath: string, cause: unknown, rollbackCause: unknown) {
    super('core_backup_rollback_failed', { cause })
    this.name = 'CoreBackupRollbackError'
    this.backupPath = backupPath
    this.rollbackCause = rollbackCause
  }
}

/**
 * 解压前把现有内核文件移入独立备份目录（保留各版本 zip）。
 * 返回本次备份路径；没有旧内核时返回 null。失败必须抛错，回滚失败则保留备份供人工恢复。
 */
export const backupCoreExecutables = async (): Promise<string | null> => {
  let backupPath = ''
  const moved: string[] = []
  try {
    const entries = await readDir(CORE_PATH, { baseDir: getBaseDir() })
    const movable = entries.filter((entry) => !(entry.isFile && isCorePackageFile(entry.name)))
    if (!movable.length) return null
    backupPath = await createCoreRecoveryDir(CORE_BACKUP_PATH)
    for (const entry of movable) {
      const source = await join(CORE_PATH, entry.name)
      await rename(source, await join(backupPath, entry.name), {
        oldPathBaseDir: getBaseDir(),
        newPathBaseDir: getBaseDir()
      })
      moved.push(entry.name)
    }
    return backupPath
  } catch (cause) {
    error(`备份旧内核失败:${cause instanceof Error ? cause.stack : JSON.stringify(cause)}`)
    if (!backupPath) throw cause
    try {
      for (const name of moved.reverse()) {
        await rename(await join(backupPath, name), await join(CORE_PATH, name), {
          oldPathBaseDir: getBaseDir(),
          newPathBaseDir: getBaseDir()
        })
      }
      await remove(backupPath, { baseDir: getBaseDir(), recursive: true })
    } catch (rollbackCause) {
      error(
        `备份旧内核失败且回滚失败，保留 ${backupPath}:${JSON.stringify({
          cause,
          rollbackCause
        })}`
      )
      throw new CoreBackupRollbackError(backupPath, cause, rollbackCause)
    }
    throw cause
  }
}

/**
 * 用指定备份恢复内核。新内核先移至独立恢复点，再移回旧备份；任一步失败都保留现场，可重试。
 */
export const restoreCoreExecutables = async (
  backupPath: string = CORE_BACKUP_PATH
): Promise<boolean> => {
  if (!isCoreBackupPath(backupPath)) {
    error(`拒绝恢复非法内核备份路径:${backupPath}`)
    return false
  }
  let discardedPath = ''
  const restored: string[] = []
  try {
    const backups = await readDir(backupPath, { baseDir: getBaseDir() })
    const current = await readDir(CORE_PATH, { baseDir: getBaseDir() }).catch(async () => {
      await checkDir(CORE_PATH)
      return [] as Awaited<ReturnType<typeof readDir>>
    })
    const replaceable = current.filter((entry) => !(entry.isFile && isCorePackageFile(entry.name)))
    if (replaceable.length) {
      discardedPath = await createCoreRecoveryDir('resource/core-unrestored')
      for (const entry of replaceable) {
        await rename(await join(CORE_PATH, entry.name), await join(discardedPath, entry.name), {
          oldPathBaseDir: getBaseDir(),
          newPathBaseDir: getBaseDir()
        })
      }
    }
    for (const entry of backups) {
      await rename(await join(backupPath, entry.name), await join(CORE_PATH, entry.name), {
        oldPathBaseDir: getBaseDir(),
        newPathBaseDir: getBaseDir()
      })
      restored.push(entry.name)
    }
    await discardCoreBackup(backupPath)
    return true
  } catch (cause) {
    let rollbackCause: unknown = null
    try {
      for (const name of restored.reverse()) {
        await rename(await join(CORE_PATH, name), await join(backupPath, name), {
          oldPathBaseDir: getBaseDir(),
          newPathBaseDir: getBaseDir()
        })
      }
    } catch (e) {
      rollbackCause = e
    }
    error(
      `恢复旧内核失败，保留备份 ${backupPath}${discardedPath ? ` 与新内核 ${discardedPath}` : ''}:${JSON.stringify(
        {
          cause: cause instanceof Error ? cause.message : cause,
          rollbackCause: rollbackCause instanceof Error ? rollbackCause.message : rollbackCause
        }
      )}`
    )
    return false
  }
}

/** 安装成功后丢弃回滚备份（尽力而为，失败仅留日志） */
export const discardCoreBackup = async (backupPath: string = CORE_BACKUP_PATH): Promise<void> => {
  if (!isCoreBackupPath(backupPath)) {
    error(`拒绝清理非法内核备份路径:${backupPath}`)
    return
  }
  await remove(backupPath, { baseDir: getBaseDir(), recursive: true }).catch((e) =>
    error(`清理内核备份失败 ${backupPath}:${JSON.stringify(e)}`)
  )
}

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

/** 单次读取结果：超时表示对端长时间没有任何数据（连接假活） */
type ChunkReadResult = ReadableStreamReadResult<Uint8Array> | 'timeout'

/** 读取一块数据，超过 ms 没有返回即判定停滞 */
const readChunkWithTimeout = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number
): Promise<ChunkReadResult> => {
  if (ms <= 0) return reader.read()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    reader.read().then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (cause) => {
        clearTimeout(timer)
        reject(cause)
      }
    )
  })
}

/** 读取失败原因：超限、停滞、低速；调用方据此提示或换源 */
type BodyReadFailure = 'limit' | 'stall' | 'slow'

type BodyReadOutcome = { ok: true; data: Uint8Array } | { ok: false; reason: BodyReadFailure }

interface BodyReadLimits {
  /** 连续无数据超时（ms），0 关闭 */
  stallTimeoutMs: number
  /** 起步宽限（ms）：超过后才判定平均速度 */
  slowGraceMs: number
  /** 最低平均速度（字节/秒），0 关闭 */
  minSpeedBps: number
}

/**
 * 读取响应体并回报下载进度：优先流式读取（边下边校验大小上限），
 * 环境不支持 ReadableStream 时退回一次性读取。
 * 流式读取期间做停滞与低速检测：镜像会返回 200 却长期不吐数据或只有几 KB/s，
 * 不设上限会让下载无限挂起，调用方也无法换源。
 */
const readBodyWithProgress = async (
  response: Response,
  total: number | null,
  onProgress: DownloadProgressCallback | undefined,
  limits: BodyReadLimits
): Promise<BodyReadOutcome> => {
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
      return { ok: false, reason: 'limit' }
    }
    emit(buffer.byteLength, true)
    return { ok: true, data: buffer }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  const startedAt = Date.now()
  emit(0, true)
  try {
    for (;;) {
      const step = await readChunkWithTimeout(reader, limits.stallTimeoutMs)
      if (step === 'timeout') {
        error(`下载停滞：${limits.stallTimeoutMs}ms 未收到数据`)
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'stall' }
      }
      if (step.done) break
      if (!step.value) continue
      received += step.value.byteLength
      // 实际包体上限边下边复核，避免无 Content-Length 时先落盘超大文件
      if (received > MAX_DOWNLOAD_BYTES) {
        error(`下载文件超过大小上限:${received}`)
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'limit' }
      }
      chunks.push(step.value)
      emit(received)
      // 低速检测：镜像能连上但只有几 KB/s 时，按平均速度及时中止并换源
      if (limits.minSpeedBps > 0) {
        const elapsed = Date.now() - startedAt
        if (elapsed >= limits.slowGraceMs) {
          const avgSpeed = received / (elapsed / 1000)
          if (avgSpeed < limits.minSpeedBps) {
            error(`下载速度过低(${Math.round(avgSpeed)}B/s < ${limits.minSpeedBps}B/s)`)
            await reader.cancel().catch(() => {})
            return { ok: false, reason: 'slow' }
          }
        }
      }
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
  return { ok: true, data: merged }
}

/**
 * 实测下载吞吐（字节/秒）：GET 真实资源，采样窗口结束后主动断开。
 * 用于下载前选源——HEAD 延迟无法反映镜像的真实带宽（存在“HEAD 很快、GET 不动”的源）。
 * 失败或没有任何数据时返回 0。
 */
export interface SpeedSampleOptions {
  /** 采样窗口（ms），默认 1800 */
  windowMs?: number
  /** 单源采样字节上限，默认 256KB */
  maxBytes?: number
  /** 等待响应头的超时（ms），默认 5000 */
  responseTimeoutMs?: number
}

export async function measureDownloadSpeed(
  url: string,
  options: SpeedSampleOptions = {}
): Promise<number> {
  const windowMs = options.windowMs ?? SPEED_SAMPLE_WINDOW_MS
  const maxBytes = options.maxBytes ?? SPEED_SAMPLE_MAX_BYTES
  const responseTimeoutMs = options.responseTimeoutMs ?? SPEED_SAMPLE_RESPONSE_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let received = 0
  let startedAt = 0
  try {
    // 响应头超时：坏源可能连 HEAD 都回但 GET 永远不返回
    if (responseTimeoutMs > 0) timer = setTimeout(() => controller.abort(), responseTimeoutMs)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Cache-Control': 'no-cache'
      },
      connectTimeout: responseTimeoutMs,
      maxRedirections: 5,
      signal: controller.signal
    })
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!response.ok) return 0
    if (!response.body || typeof response.body.getReader !== 'function') return 0

    const startedAtMs = Date.now()
    startedAt = startedAtMs
    // 采样窗口到点即断开，不把整包下完
    timer = setTimeout(() => controller.abort(), windowMs)
    const reader = response.body.getReader()
    try {
      for (;;) {
        if (received >= maxBytes) break
        const remaining = windowMs - (Date.now() - startedAtMs)
        if (remaining <= 0) break
        const step = await readChunkWithTimeout(reader, Math.min(remaining, 1000))
        if (step === 'timeout') {
          if (Date.now() - startedAtMs >= windowMs) break
          continue
        }
        if (step.done) break
        if (step.value) received += step.value.byteLength
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const elapsed = Math.max(1, Date.now() - startedAtMs)
    return Math.round((Math.min(received, maxBytes) / elapsed) * 1000)
  } catch {
    // 采样窗口主动 abort 视为正常结束：按已收到的数据折算速度
    if (received <= 0) return 0
    const elapsed = Math.max(1, Date.now() - startedAt)
    return Math.round((received / elapsed) * 1000)
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}

/** 下载可选参数：保存目录与中止阈值 */
export interface DownloadOptions {
  /** 保存目录（相对 BaseDirectory 的相对路径），默认 CORE_PATH */
  dir?: string
  /** 官方标注的包体字节数：实际长度不符即判为半包（镜像截断/中断），不落盘 */
  expectedSize?: number | null
  /** 官方 SHA-256（hex）：提供时必须校验完整包体，格式非法或篡改均不落盘 */
  expectedSha256?: string
  /** 等待响应头超时（ms），0 关闭；默认 20s */
  responseTimeoutMs?: number
  /** 连续无数据中止阈值（ms），0 关闭；默认 15s */
  stallTimeoutMs?: number
  /** 起步宽限（ms）：超过后才判定平均速度；默认 10s */
  slowGraceMs?: number
  /** 最低平均速度（字节/秒），0 关闭（默认关闭） */
  minSpeedBps?: number
}

/**
 * 下载文件
 * @param fileUrl 文件URL
 * @param onProgress 下载进度回调（首帧为 0，流式读取期间约每 80ms 一次，结束时必有一次）
 * @param options 保存目录等可选参数（更新安装包与内核包分目录存放）
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
  onProgress?: DownloadProgressCallback,
  options?: DownloadOptions
): Promise<boolean> {
  const targetDir = options?.dir || CORE_PATH
  const responseTimeoutMs = options?.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS
  const stallTimeoutMs = options?.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const slowGraceMs = options?.slowGraceMs ?? DEFAULT_SLOW_GRACE_MS
  const minSpeedBps = options?.minSpeedBps ?? 0
  const expectedSha256 = options?.expectedSha256
  if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedSha256.trim())) {
    error('下载摘要格式非法，拒绝请求')
    return false
  }
  // 响应头超时用 abort 真正掐断连接；进入读流后由停滞/低速检测接管
  const controller = new AbortController()
  let responseTimer: ReturnType<typeof setTimeout> | null = null
  try {
    // 只允许 HTTPS：内核与安装包必须走加密通道，避免镜像/中间人替换内容
    let url: URL
    try {
      url = new URL(fileUrl)
    } catch {
      error(`下载地址非法:${fileUrl}`)
      return false
    }
    if (url.protocol !== 'https:') {
      error(`不支持的下载协议:${url.protocol}（仅允许 https）`)
      return false
    }

    info(`开始下载:${fileUrl}`)
    // 使用 Tauri 的 http plugin
    if (responseTimeoutMs > 0) {
      responseTimer = setTimeout(() => controller.abort(), responseTimeoutMs)
    }
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
      maxRedirections: 5,
      signal: controller.signal
    })
    if (responseTimer) {
      clearTimeout(responseTimer)
      responseTimer = null
    }
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

    // 构建保存路径（内核包在 resource/core，更新安装包按 options.dir 分目录）
    const savePath = await join(targetDir, filename)

    // 确保目录存在
    await checkDir(targetDir)

    // 流式读取响应体并回报进度，同时做实际包体上限复核
    const body = await readBodyWithProgress(response, total, onProgress, {
      stallTimeoutMs,
      slowGraceMs,
      minSpeedBps
    })
    if (!body.ok) {
      // 停滞/低速时掐断 Rust 侧连接，避免后台继续占用带宽
      controller.abort()
      return false
    }
    const uint8Array = body.data

    // 包体长度复核：镜像站截断或连接中断时不落盘，避免把半包交给安装器
    const expectedSize = options?.expectedSize
    if (expectedSize && uint8Array.byteLength !== expectedSize) {
      error(`下载包体不完整(${uint8Array.byteLength}/${expectedSize}):${fileUrl}`)
      return false
    }
    if (expectedSha256 !== undefined && !verifyManagerPackage(uint8Array, expectedSha256)) {
      error(`下载包体 SHA-256 校验失败:${fileUrl}`)
      return false
    }

    // 文件头校验：镜像站可能返回 HTML 错误页，必须按包类型验魔数，避免污染本地安装包
    // zip（内核包/APK）为 "PK"，PE 可执行（Windows 安装包）为 "MZ"
    const expectedMagic = /\.exe$/i.test(filename) ? 'MZ' : 'PK'
    const actualMagic = String.fromCharCode(uint8Array[0] ?? 0, uint8Array[1] ?? 0)
    if (actualMagic !== expectedMagic) {
      error(`下载内容不是有效的 ${expectedMagic} 包:${fileUrl}`)
      return false
    }

    info(`开始写入文件:${savePath}`)
    // 先写临时文件、校验通过后原子替换目标，不破坏已存在的可用安装包
    const tmpPath = createTemporaryPath(savePath)
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
  } finally {
    if (responseTimer) clearTimeout(responseTimer)
  }
}

/**
 * 1.在资源管理器中打开指定目录
 * 2.在浏览器中打开指定网址
 * @param path 要打开的目录路径或网址
 */
export async function openPath(path: string): Promise<boolean> {
  try {
    await systemOps.openPath(path)
    return true
  } catch (e: any) {
    error(`打开资源管理器失败:${JSON.stringify(e)}`)
    return false
  }
}

/**
 * 解压文件到指定目录，支持处理多层目录
 * @param zipPath 压缩文件路径（相对于 Resource 目录）
 * @param destPath 解压目标目录（相对于 Resource 目录）
 * @param keepDir   是否保留原路径
 * @param beforeWrite 写入前回调（如清理旧内核文件）；返回 false 则中止解压
 * @param expectedSha256 可选：内置清单可信包摘要；必须匹配本次实际读取的完整字节
 * @returns Promise<boolean> 解压是否成功
 */
export async function extractFile(
  zipPath: string,
  destPath: string,
  keepDir: boolean = false,
  beforeWrite?: () => Promise<boolean>,
  expectedSha256?: string
): Promise<boolean> {
  try {
    const expectedHash = expectedSha256?.trim().toLowerCase()
    if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedHash ?? '')) {
      error('压缩包摘要格式非法，拒绝解压')
      return false
    }
    // 读取zip文件内容  resource\easytier-windows-x86_64-v2.0.3.zip
    const zipContent = (await readFileContent(zipPath, {
      baseDir: getBaseDir(),
      asBinary: true,
      throwOnError: true
    })) as Uint8Array

    // 校验与解压使用同一份字节，堵住验包后、停服务/备份期间更换 zip 的窗口。
    if (expectedHash && !verifyManagerPackage(zipContent, expectedHash)) {
      error(`压缩包 SHA-256 校验失败:${zipPath}`)
      return false
    }

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
 * 求若干路径的最长公共目录前缀（以 / 结尾）；无公共段时返回空串。
 * 单路径没有「公共」概念，退回其所在目录。
 */
async function findCommonPrefix(paths: string[]): Promise<string> {
  if (paths.length === 0) return ''
  if (paths.length === 1) return await dirname(paths[0])

  const [reference, ...others] = paths.map((path) => path.split('/').filter(Boolean))
  let sharedLength = 0
  while (
    sharedLength < reference.length &&
    others.every((segments) => segments[sharedLength] === reference[sharedLength])
  ) {
    sharedLength += 1
  }
  return sharedLength === 0 ? '' : `${reference.slice(0, sharedLength).join('/')}/`
}

/** 日志清理结果：只删除非活跃文件，正在写入的当前日志保留并计数 */
export interface LogClearFailure {
  file: string
  reason: string
}

export interface LogClearResult {
  removed: number
  kept: number
  failed: number
  removedFiles: string[]
  failedFiles: LogClearFailure[]
}

const createClearResult = (): LogClearResult => ({
  removed: 0,
  kept: 0,
  failed: 0,
  removedFiles: [],
  failedFiles: []
})

// 删除单个日志文件并累计结果（失败不中断后续清理）
const removeLogFile = async (
  dir: string,
  fileName: string,
  result: LogClearResult
): Promise<void> => {
  const file = `${dir}/${fileName}`
  try {
    await remove(file, { baseDir: getBaseDir() })
    result.removed++
    result.removedFiles.push(file)
  } catch (e: any) {
    result.failed++
    result.failedFiles.push({ file, reason: e?.message || String(e) })
    error(`清理日志文件 ${file} 失败:${JSON.stringify(e)}`)
  }
}

// 应用日志历史：plugin-log 轮转为 lighttier_yyyy-MM-dd_HH-mm-ss.log（同日冲突产生 .bak）
// 监控页旧版隐藏诊断文件 monitor_*.log 也一并清理
const isAppLogHistory = (fileName: string): boolean =>
  (fileName.startsWith(`${pkg.name}_`) && /\.log(?:\.bak)?$/.test(fileName)) ||
  /^monitor_.+\.log$/.test(fileName)

// 旧版共享目录中的内核历史分段（数字轮转或日期后缀）；活跃文件不在此列
const isRootKernelHistory = (fileName: string): boolean =>
  /^easytier\.log\.\d+$/.test(fileName) ||
  /^easytier\.log\.\d{4}-\d{2}-\d{2}/.test(fileName) ||
  /\.log\.\d+$/.test(fileName) ||
  /^.+\.\d{4}-\d{2}-\d{2}/.test(fileName)

/**
 * 清理日志：删除应用日志与内核日志的**历史分段**，保留正在写入的当前文件。
 *
 * 为什么不截断活跃文件：
 * - Windows 上日志文件被内核/插件持有，跨进程截断会失败或与写入竞争；
 * - Unix 上截断正在追加的文件会破坏内核的写入偏移，产生稀疏空洞。
 * 历史分段（轮转文件）已关闭，可安全删除；当前文件由各自的轮转策略约束大小。
 */
export const clearAllLogs = async (): Promise<LogClearResult> => {
  const result = createClearResult()
  const appActiveLog = `${pkg.name}.log`

  // 1. 应用日志历史 + 旧版监控隐藏日志
  const rootFiles = await listFiles(LOG_PATH, true)
  for (const fileName of rootFiles) {
    if (isAppLogHistory(fileName)) {
      await removeLogFile(LOG_PATH, fileName, result)
    } else if (
      fileName === appActiveLog ||
      fileName === 'easytier.log' ||
      (/\.log$/.test(fileName) && !isRootKernelHistory(fileName))
    ) {
      // 应用当前日志、内核当前日志、旧版按配置写入的当前日志
      result.kept++
    }
  }

  // 2. 旧版共享目录中的内核历史分段
  for (const fileName of rootFiles) {
    if (isAppLogHistory(fileName) || !isRootKernelHistory(fileName)) continue
    await removeLogFile(LOG_PATH, fileName, result)
  }

  // 3. 新布局 logs/kernel/<scope>/：保留 easytier.log 等活跃文件
  const scopes = await listFiles(KERNEL_LOG_ROOT, true)
  for (const scope of scopes) {
    const dir = `${KERNEL_LOG_ROOT}/${scope}`
    const files = await listFiles(dir, true)
    for (const fileName of files) {
      if (!isKernelLogFile(fileName, scope)) continue
      if (isActiveKernelLogFile(fileName, scope)) {
        result.kept++
        continue
      }
      await removeLogFile(dir, fileName, result)
    }
  }

  return result
}
