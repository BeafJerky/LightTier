/**
 * 桌面进程与内核命令行工具层（Windows / macOS / Linux）
 *
 * 职责：easytier-core 后台启停（含 RPC 端口自动分配与双层冲突检测）、
 * easytier-cli 调用、进程扫描（Windows 走 PowerShell CIM，Unix 走 ps）、
 * 进程终止、端口冲突预检（规避多实例启动失败）、Windows 服务管理
 * （NSSM / 官方 CLI 双方案）与路由增删。
 * 说明：Android 平台不经过此层（内核进程内运行，见 mobileVpn.ts / coreApi.ts）。
 */
import { CONFIG_PATH, CORE_PATH, NSSM_NAME } from '@/shared/constants/easytier'
import { invoke } from '@tauri-apps/api/core'
import { join, resourceDir } from '@tauri-apps/api/path'
import { attachConsole, error, info, warn } from '@tauri-apps/plugin-log'
import {
  getCoreDir,
  getKernelLogsDir,
  getLogsDir,
  getResourceDir,
  getWebKernelLogsDir,
  readFileContent
} from './fileUtil'
import {
  DEFAULT_LOG_COUNT,
  DEFAULT_LOG_SIZE_MB,
  normalizeLogLevel,
  parsePositiveInt
} from '@/shared/lib/coreLogUtil'
import { getPlatform, sleep } from './sysUtil'
import * as systemOps from './systemOps'
import * as toml from 'smol-toml'
import { clearExitRoute } from './routeUtil'
import { compareCoreVersion, parseCoreVersion } from '@/entities/kernel/kernelCompatUtil'
import { t } from '@/shared/i18n/t'
import { readServiceInstallMethod, type ServiceInstallMethod } from './serviceInstallRecord'

// 启用 TargetKind::Webview 后，这个函数将把日志打印到浏览器控制台
attachConsole()

const SERVICE_CORE_ARG = '--lighttier-service-core'

/** SCM 经 LightTier 隐藏入口校验并启动内核；重复调用不叠加入口参数。 */
export function buildServiceAppParameters(args: string): string {
  return /^--lighttier-service-core(?=[ \t]|$)/.test(args)
    ? args
    : args
      ? `${SERVICE_CORE_ARG} ${args}`
      : SERVICE_CORE_ARG
}

// 内核日志兜底目录：默认按配置隔离到 <resource>/logs/kernel/<scope>；
// 无配置名时回退 logs 根目录；极端失败（非 Tauri 环境等）退回相对 './logs' 由内核按 CWD 解析
async function getDefaultLogDir(configFileName?: string): Promise<string> {
  try {
    if (configFileName) return await getKernelLogsDir(configFileName)
    return await getLogsDir()
  } catch {
    return './logs'
  }
}

/**
 * 从配置文件中读取日志/端口相关配置（内核启动与服务安装共用）
 *
 * 日志目录由管理器统一决定：始终按配置隔离到 <resource>/logs/kernel/<scope>，
 * 避免多实例共写 easytier.log 造成交错与轮转互踩。
 * TOML 的 `[file_logger] dir` 不参与路径决策：内核按任意绝对路径写入后，查看/清理/
 * 打开目录与公网 IP 提取（受 Tauri fs 作用域限制只覆盖应用目录）都会读不到（F-07）。
 * 级别与轮转参数仍按 TOML 翻译为 CLI 参数（--file-log-level/size/count）。
 * @param configFileName 配置文件名
 */
async function getConfigFromFile(configFileName: string): Promise<{
  logDir: string
  logLevel: string
  sizeMb: number
  count: number
  rpcPortal: string | undefined
  listeners: string[]
}> {
  try {
    // 读取配置文件内容
    const configContent = (await readFileContent(CONFIG_PATH + '/' + configFileName)) as string
    const config = toml.parse(configContent) as any

    // 获取日志配置（目录恒定走应用隔离目录，级/轮转参数按 TOML 归一化，非法值回落默认）
    const logger = config.file_logger || {}
    const logDir = await getDefaultLogDir(configFileName)
    const logLevel = normalizeLogLevel(logger.level)
    const sizeMb = parsePositiveInt(logger.size_mb ?? logger.size, DEFAULT_LOG_SIZE_MB)
    const count = parsePositiveInt(logger.count, DEFAULT_LOG_COUNT)
    // 获取 rpc_portal 配置（v2.5.0 起配置文件中的 rpc_portal 不再生效，需通过命令行参数传递）
    const rpcPortal = config.rpc_portal || undefined
    // 获取监听地址列表（如 ["tcp://0.0.0.0:11000"]）
    const listeners = config.listeners || []

    return { logDir, logLevel, sizeMb, count, rpcPortal, listeners }
  } catch (e) {
    error(`读取配置文件失败:${JSON.stringify(e)}`)
    // 返回默认值（日志目录仍尽力回落到该配置的隔离目录）
    return {
      logDir: await getDefaultLogDir(configFileName),
      logLevel: 'info',
      sizeMb: DEFAULT_LOG_SIZE_MB,
      count: DEFAULT_LOG_COUNT,
      rpcPortal: undefined,
      listeners: []
    }
  }
}

/**
 * 构建 easytier-core 启动参数（包含日志配置和 rpc-portal）
 * v2.5.0 起 rpc_portal 不再从配置文件读取，需通过 --rpc-portal 命令行参数传递
 * @param configFileName 配置文件名（如 server.toml）
 * @param configPath 配置文件完整路径
 * @returns 完整的启动参数字符串
 */
export async function buildCoreArgsWithLogConfig(
  configFileName: string,
  configPath: string
): Promise<string> {
  const args = await buildCoreArgsList(configFileName, configPath)
  // 字符串形式供 nssm AppParameters 使用：路径可能含空格，统一加引号
  return args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')
}

/**
 * 构建 easytier-core 启动参数数组（官方 CLI 的 --core-args 需要逐个参数传递）
 * v2.5.0 起 rpc_portal 不再从配置文件读取，需通过 --rpc-portal 命令行参数传递
 */
export async function buildCoreArgsList(
  configFileName: string,
  configPath: string
): Promise<string[]> {
  const { logDir, logLevel, sizeMb, count, rpcPortal } = await getConfigFromFile(configFileName)
  const args = [
    '--file-log-dir',
    logDir,
    '--file-log-level',
    logLevel,
    '--file-log-size',
    `${sizeMb}`,
    '--file-log-count',
    `${count}`,
    '--config-file',
    configPath
  ]
  if (rpcPortal) args.push('--rpc-portal', rpcPortal)
  return args
}

// 失败日志脱敏：nssm set <svc> ObjectName <user> <password> 的密码与 --password 类参数
// 不得写入应用日志（命令行本身由系统进程表承载，日志是可控面）
const maskSecretArgs = (program: string, args: string[]): string[] => {
  const masked = [...args]
  const isNssm = /(^|[\\/])nssm(\.exe)?$/i.test(program)
  const objectNameIdx = isNssm ? masked.findIndex((a) => a.toLowerCase() === 'objectname') : -1
  // ObjectName 后依次是用户名与密码：保留用户名，密码及其后参数全部遮蔽
  if (objectNameIdx >= 0) {
    for (let i = objectNameIdx + 2; i < masked.length; i++) masked[i] = '***'
  }
  for (let i = 1; i < masked.length; i++) {
    if (/^--?(password|passwd|pwd)$/i.test(masked[i - 1])) masked[i] = '***'
  }
  return masked
}

/**
 * 执行外部程序并等待其完成
 * @param program 程序路径
 * @param args 程序参数数组
 * @param options 执行选项（可选）
 * @returns Promise<any> 程序输出
 *
 * 返回契约（退出码是唯一成功依据，stderr 仅作诊断）：
 * - 退出码 0 且 stdout 非空 → 返回 stdout 字符串（trim 后）
 * - 退出码 0 但 stdout 为空 → 返回 { code: 0, stdout, stderr }
 * - 退出码非 0 → 返回 { code, msg, stdout, stderr }（msg 为 stderr 优先的错误摘要）
 *
 * 使用示例:
 * ```
 * // 示例：执行命令并等待结果
 * const output = await executeAndWait('git', ['status'])
 * info('命令输出:', output)
 * ```
 */
// 扫描所有 easytier-core 进程，提取已占用的 rpc-portal 端口号
const getUsedRpcPortals = async (): Promise<Set<number>> => {
  const res = await getRunningProcesses('easytier-core')
  const portals = new Set<number>()
  if (res?.length) {
    res.forEach((r: any) => {
      const cmd = r.commandLine || ''
      const match = cmd.match(/--rpc-portal\s+(\S+)/)
      if (match) {
        const portal = match[1]
        // 匹配 host:port 格式或裸端口号
        const portMatch = portal.match(/:(\d+)$/)
        const port = portMatch ? parseInt(portMatch[1]) : parseInt(portal)
        if (!isNaN(port)) portals.add(port)
      }
    })
  }
  return portals
}

// 查找一个未被任何进程占用的 RPC 端口，从 15889 开始扫描
const findAvailableRpcPortal = async (): Promise<string> => {
  const usedPortals = await getUsedRpcPortals()
  for (let port = 15889; port < 65535; port++) {
    if (usedPortals.has(port)) continue
    try {
      const available = await invoke<boolean>('check_port_available', { port })
      if (available) return `127.0.0.1:${port}`
    } catch {
      /* 非 Tauri 环境，跳过 */
    }
  }
  throw new Error('No available RPC port found in range 15889-65535')
}

// 从 listeners URI 列表中提取端口号（如 tcp://0.0.0.0:11000 → 11000）
const extractListenerPorts = (listeners: string[] = []): Set<number> => {
  const ports = new Set<number>()
  listeners.forEach((l) => {
    const match = l.match(/:(\d+)\s*$/)
    if (match) {
      const port = parseInt(match[1], 10)
      if (!isNaN(port)) ports.add(port)
    }
  })
  return ports
}

/**
 * 并发启动端口预检：对比目标配置与正在运行配置的 listeners 监听端口
 * 用于规避多实例启动时端口占用导致的“同时运行多个配置无法启动成功”
 * @param configFileName 待启动配置文件名（含 .toml）
 * @returns 冲突列表（含端口与被占用配置名，空数组代表无冲突）；预检失败时安全降级返回空数组，由内核自身报错兜底
 */
export const checkPortConflicts = async (configFileName: string): Promise<PortConflict[]> => {
  const conflicts: PortConflict[] = []
  try {
    const { listeners: targetListeners } = await getConfigFromFile(configFileName)
    const targetPorts = extractListenerPorts(targetListeners)
    if (targetPorts.size === 0) return conflicts

    // 扫描正在运行的 easytier-core 进程，读取其配置文件的监听端口
    const res = await getRunningProcesses('easytier-core')
    if (!res?.length) return conflicts
    for (const r of res) {
      const cmd = r.commandLine || ''
      const match = cmd.match(/[/\\]([^/\\]+)\.toml/) || cmd.match(/([^\s"]+)\.toml/)
      if (!match) continue
      const runningName = match[1] + '.toml'
      if (runningName === configFileName) continue
      const { listeners } = await getConfigFromFile(runningName)
      const runningPorts = extractListenerPorts(listeners)
      targetPorts.forEach((port) => {
        if (runningPorts.has(port) && !conflicts.some((c) => c.port === port)) {
          conflicts.push({ port, conflictConfig: runningName })
        }
      })
      if (conflicts.length === targetPorts.size) break
    }
  } catch (e) {
    error(`端口预检失败:${JSON.stringify(e)}`)
  }
  return conflicts
}

/** 命令执行结果是否成功：字符串输出或 { code: 0 } 均视为成功（Unix kill 成功时 stdout 为空） */
const isCommandSuccess = (res: unknown): boolean =>
  typeof res === 'string' ||
  (!!res && typeof res === 'object' && (res as { code?: number }).code === 0)

/**
 * 校验 Rust 侧 run_command 返回的进程号。
 * 旧实现把失败字符串 / 403 当作成功返回，调用方会写入无效 pid 并显示“已启动”，
 * 因此在边界统一收敛为“正整数 PID，否则抛错”，失败必须向 UI 传播。
 */
const parseSpawnedPid = (res: unknown): number => {
  const pid = typeof res === 'number' ? res : Number(String(res ?? '').trim())
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(t('newCommon.coreStartInvalidPid'))
  }
  return pid
}

// 运行 easytier-core 配置（自动分配 RPC 端口）
// @returns 内核进程 PID；启动失败（含 spawn 失败/无效 PID）抛出异常
export async function runEasyTierCore(configFileName: string): Promise<number> {
  try {
    const configPath = await join(await resourceDir(), CONFIG_PATH, configFileName)
    const program = await getCoreDir()

    // 读取配置文件获取日志配置和 rpc_portal
    const {
      logDir,
      logLevel,
      sizeMb,
      count,
      rpcPortal: tomlRpcPortal
    } = await getConfigFromFile(configFileName)

    // 确定实际使用的 RPC 端口（双层冲突检测）
    let actualRpcPortal: string
    if (tomlRpcPortal) {
      // TOML 指定了端口，检查是否可用
      const portMatch = tomlRpcPortal.match(/:(\d+)/)
      const port = portMatch ? parseInt(portMatch[1]) : 15888
      try {
        const available = await invoke<boolean>('check_port_available', { port })
        actualRpcPortal = available ? tomlRpcPortal : await findAvailableRpcPortal()
      } catch {
        // 非 Tauri 环境，直接使用 TOML 值
        actualRpcPortal = tomlRpcPortal
      }
    } else {
      // TOML 未指定，自动分配
      actualRpcPortal = await findAvailableRpcPortal()
    }

    const args: string[] = [
      '--file-log-dir',
      `${logDir}`,
      '--file-log-level',
      logLevel,
      '--file-log-size',
      `${sizeMb}`,
      '--file-log-count',
      `${count}`,
      '--config-file',
      `${configPath}`,
      '--rpc-portal',
      actualRpcPortal
    ]

    const res = await invoke<string>('run_command', {
      program,
      args
    })
    const pid = parseSpawnedPid(res)
    info(`运行结果：${pid}, rpc-portal: ${actualRpcPortal}`)
    return pid
  } catch (e) {
    error(`运行 easytier-core失败:${JSON.stringify(e)}`)
    throw e
  }
}

// 运行 easytier-core web配置
// @returns 内核进程 PID；启动失败（含 spawn 失败/无效 PID）抛出异常
export async function runEasyTierCoreWeb(url: string): Promise<number> {
  try {
    const program = await getCoreDir()
    let logDir = './logs'
    try {
      logDir = await getWebKernelLogsDir()
    } catch {
      /* 非 Tauri 环境或目录创建失败时保留相对兜底 */
    }
    // Web 配置没有本地 TOML，统一使用默认日志策略，避免日志落到进程 CWD 或被关闭
    const res = await invoke<string>('run_command', {
      program,
      args: [
        '--config-server',
        `${url}`,
        '--file-log-dir',
        logDir,
        '--file-log-level',
        'info',
        '--file-log-size',
        `${DEFAULT_LOG_SIZE_MB}`,
        '--file-log-count',
        `${DEFAULT_LOG_COUNT}`
      ]
    })
    const pid = parseSpawnedPid(res)
    info(`运行结果：${pid}`)
    return pid
  } catch (e) {
    error(`运行 easytier-core失败:${JSON.stringify(e)}`)
    throw e
  }
}

// 运行 easytier-cli 配置
// @returns CLI 输出；执行失败（spawn 失败/非 0 退出码）抛出异常
export async function runEasyTierCli(args: string[]): Promise<any> {
  try {
    // 注：改用 Rust 侧 run_cli 会出现卡顿，故统一走 shell 执行
    const res = await systemOps.runCliCommand(args)
    if (!isCommandSuccess(res)) {
      throw new Error((res as { msg?: string })?.msg || 'easytier-cli 执行失败')
    }
    return res
  } catch (e) {
    error(`获取结果失败:${JSON.stringify(e)}`)
    throw e
  }
}

/**
 * 根据PID终止进程
 * @param pid 进程ID
 * @param force 是否强制终止 (默认false)
 * @returns Promise<boolean> 是否成功终止
 *
 * 使用示例:
 * ```
 * // 正常终止进程
 * await killProcess(1234)
 *
 * // 强制终止进程
 * await killProcess(1234, true)
 * ```
 */
export async function killProcess(pid: number, _force: boolean = true): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    warn(`终止进程失败：无效 PID(${pid})`)
    return false
  }
  try {
    const ok = await systemOps.killProcess(pid)
    if (!ok) warn(`终止进程 ${pid} 失败`)
    else info(`进程 ${pid} 已终止`)
    return ok
  } catch (e: any) {
    error(`终止进程 ${pid} 失败:${e}`)
    return false
  }
}

// 停止所有节点
export async function stopAllNodes() {
  try {
    const processList = await getRunningProcesses('easytier-core')
    const results = await Promise.all(
      processList.map(async (process) => ({
        pid: process.pid,
        ok: await killProcess(process.pid)
      }))
    )
    // 仍有节点存活时不得清理出口路由：这些路由正被运行中的实例使用
    const failed = results.filter((r) => !r.ok).map((r) => r.pid)
    if (failed.length > 0) {
      error(`停止所有节点未完全成功（PID:${failed.join(',')}），跳过出口路由清理`)
      return
    }
    // 5.10：全部停止后自动清除出口节点路由（升级内核等强停场景不残留）
    await clearExitRoute()
  } catch (e) {
    error(`停止所有节点失败:${e}`)
  }
}

/**
 * 获取正在运行的程序信息
 * @param {string} [programName] - 可选的程序名，用于模糊查询
 * @returns {Promise<Array>} - 返回一个包含程序信息的数组对象
 */
export const getRunningProcesses = async (
  programName: string = 'easytier-core'
): Promise<Array<any>> => {
  const list = await systemOps.listProcesses(programName)
  return list.map((item) => ({ ...item, fileName: programName }))
}

/**
 * 根据已知的配置名称列表，检测哪些配置正在运行
 * 返回 RunningItem[] 格式的运行列表（包含从命令行提取的 rpcPortal）
 */
export const fetchRunningList = async (configNames: string[]): Promise<RunningItem[]> => {
  const res = await getRunningProcesses('easytier-core')
  const newList: RunningItem[] = []
  const knownNames = new Set(configNames)
  if (res?.length) {
    res.forEach((r: any) => {
      const cmd = r.commandLine || ''
      const match = cmd.match(/[/\\]([^/\\]+)\.toml/) || cmd.match(/([^\s"]+)\.toml/)
      if (match) {
        const name = match[1]
        if (knownNames.has(name)) {
          const rpcMatch = cmd.match(/--rpc-portal\s+(\S+)/)
          newList.push({
            configFileName: name,
            fileName: `${name}.toml`,
            pid: r.pid,
            rpcPortal: rpcMatch ? rpcMatch[1] : undefined
          })
        }
      }
    })
  }
  return newList
}

/**
 * 查询 NSSM 服务状态。
 *
 * 正常状态返回原始状态文本；仅明确的“服务不存在”返回 false；
 * 命令异常、空输出、非状态文本等无法确认状态的情况返回 null。
 */
export const checkServiceOnWindows = async (
  serviceName: string
): Promise<string | false | null> => {
  try {
    const output = await systemOps.runNssmCommand(['status', serviceName])
    const result = typeof output === 'string' ? null : (output as any)
    const status =
      typeof output === 'string'
        ? output.trim()
        : typeof result?.stdout === 'string'
          ? result.stdout.trim()
          : ''
    const diagnostic = [status, result?.stderr, result?.msg]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
    if (result?.code === 3 || /does not exist|not installed|未安装|不存在/i.test(diagnostic)) {
      return false
    }
    if (result && result.code !== undefined && result.code !== 0) return null
    if (
      ![
        'SERVICE_STOPPED',
        'SERVICE_START_PENDING',
        'SERVICE_STOP_PENDING',
        'SERVICE_RUNNING',
        'SERVICE_CONTINUE_PENDING',
        'SERVICE_PAUSE_PENDING',
        'SERVICE_PAUSED'
      ].includes(status.toUpperCase())
    ) {
      return null
    }
    return status
  } catch {
    return null
  }
}
/*
# 无需确认移除服务：
nssm remove <servicename> confirm
# 管理服务：
nssm start <servicename>     # 启动服务
nssm stop <servicename>      # 停止服务
nssm restart <servicename>   # 重启服务
nssm status <servicename>    # 显示服务状态
nssm statuscode <servicename>   # 显示服务状态码
nssm rotate <servicename>    # 旋转服务日志
nssm processes <servicename> # 显示服务关联的进程
 */
const SERVICE_SNAPSHOT_KEYS = [
  'Application',
  'AppParameters',
  'AppDirectory',
  'AppExit',
  'Description',
  'DisplayName',
  'ObjectName',
  'Start',
  'Type'
] as const

type ServiceSnapshotKey = (typeof SERVICE_SNAPSHOT_KEYS)[number]
type ServiceSnapshot = Record<ServiceSnapshotKey, string[]>

/** 仅接受后端固定九键快照；权限不足、异常或结构不完整都必须在写入前失败。 */
const readServiceSnapshot = async (serviceName: string): Promise<ServiceSnapshot> => {
  const result = await systemOps.runNssmCommand(['snapshot', serviceName])
  const output =
    typeof result === 'string'
      ? result
      : result && typeof result === 'object' && result.code === 0
        ? result.stdout
        : null
  if (output === null) throw new Error(`读取服务快照失败:${serviceName}`)
  const parsed: unknown = JSON.parse(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`服务快照结构无效:${serviceName}`)
  }
  const record = parsed as Record<string, unknown>
  if (
    Object.keys(record).length !== SERVICE_SNAPSHOT_KEYS.length ||
    !SERVICE_SNAPSHOT_KEYS.every(
      (key) =>
        Array.isArray(record[key]) &&
        record[key].length > 0 &&
        record[key].every((value) => typeof value === 'string')
    )
  ) {
    throw new Error(`服务快照键或值不完整:${serviceName}`)
  }
  return record as ServiceSnapshot
}

/**
 * Windows 安装指定程序为系统服务
 * @param serviceName 服务名
 * @param args 程序参数
 * @param options 可选参数
 * @param options.username 运行服务的用户名（可选，不提供则使用 LocalSystem）
 * @param options.password 运行服务的用户密码（当提供 username 时必需）
 * @param options.displayName 服务显示名（缺省按服务名生成）
 * @param options.description 服务描述（缺省按服务名生成）
 * @returns Promise<boolean> 是否成功
 *
 * 服务已存在时按“重装”处理：停止 → 更新 Application/AppParameters 等 → 重新启动，
 * 否则旧参数会一直生效（切换内核或修改配置后服务仍跑旧命令行）。
 */
export const installServiceOnWindows = async (
  serviceName: string,
  args: string,
  options?: {
    username?: string
    password?: string
    displayName?: string
    description?: string
  }
): Promise<boolean> => {
  try {
    const appDirectory = await getResourceDir()
    // Windows 需要 .exe 扩展名；核心独立存放在 resource/core 下
    const corePath = await join(await resourceDir(), CORE_PATH, 'easytier-core.exe')
    const displayName =
      options?.displayName?.trim() || t('newConfig.svcDefaultName', { name: serviceName })
    const description =
      options?.description?.trim() || t('newConfig.svcDefaultDesc', { name: serviceName })
    // 如果提供了用户名和密码，使用指定用户运行服务；否则使用 LocalSystem
    const objectNameArgs =
      options?.username && options?.password
        ? ['set', serviceName, 'ObjectName', `.\\${options.username}`, options.password]
        : ['set', serviceName, 'ObjectName', 'LocalSystem']
    // 参数按数组逐项传递，不需要手动添加引号。
    const setSteps = [
      ['set', serviceName, 'AppParameters', buildServiceAppParameters(args)],
      ['set', serviceName, 'AppDirectory', appDirectory],
      ['set', serviceName, 'AppExit', 'Default', 'Restart'],
      ['set', serviceName, 'Description', description],
      ['set', serviceName, 'DisplayName', displayName],
      objectNameArgs,
      ['set', serviceName, 'Start', 'SERVICE_AUTO_START'],
      ['set', serviceName, 'Type', 'SERVICE_WIN32_OWN_PROCESS']
    ]

    const applySteps = async (steps: string[][]): Promise<{ ok: boolean; attempted: string[] }> => {
      const attempted: string[] = []
      for (const step of steps) {
        attempted.push(step[2])
        try {
          const stepRes = await systemOps.runNssmCommand(step)
          if (isCommandSuccess(stepRes)) continue
        } catch {
          // 与失败退出码同样进入恢复；下面统一记录脱敏诊断。
        }
        error(`配置服务失败:${JSON.stringify(maskSecretArgs(NSSM_NAME, step))}`)
        return { ok: false, attempted }
      }
      return { ok: true, attempted }
    }

    const restoreSnapshot = async (
      snapshot: ServiceSnapshot,
      attempted: string[]
    ): Promise<boolean> => {
      const failures: string[] = []
      for (const key of [...attempted].reverse()) {
        try {
          const result = await systemOps.runNssmCommand([
            'restore',
            serviceName,
            key,
            ...snapshot[key as ServiceSnapshotKey]
          ])
          if (!isCommandSuccess(result)) failures.push(key)
        } catch {
          failures.push(key)
        }
      }
      try {
        const current = await readServiceSnapshot(serviceName)
        for (const key of attempted) {
          const snapshotKey = key as ServiceSnapshotKey
          if (JSON.stringify(current[snapshotKey]) !== JSON.stringify(snapshot[snapshotKey])) {
            failures.push(`${key}(回读不一致)`)
          }
        }
      } catch {
        failures.push('快照回读失败')
      }
      if (failures.length === 0) return true

      const stopped = await stopServiceOnWindows(serviceName)
      warn(
        `服务回滚失败，已尝试停止但需人工恢复 SCM 配置:${serviceName}；失败键:${[...new Set(failures)].join(',')}；停止:${stopped ? '成功' : '失败'}`
      )
      return false
    }

    const removePartialInstall = async (): Promise<void> => {
      try {
        const result = await systemOps.runNssmCommand(['remove', serviceName, 'confirm'])
        if (!isCommandSuccess(result)) {
          warn(`新装服务删除失败，需人工检查:${serviceName}`)
        }
      } catch {
        warn(`新装服务删除失败，需人工检查:${serviceName}`)
      }
    }

    const exist = await checkServiceOnWindows(serviceName)
    info(`服务是否存在:${JSON.stringify(exist)}`)
    if (exist === null) {
      error(`服务状态未知，中止安装:${serviceName}`)
      return false
    }
    if (exist) {
      // 先取全量快照再停机，ObjectName 等键无权限时不会中断旧服务。
      const snapshot = await readServiceSnapshot(serviceName)
      if (exist !== 'SERVICE_STOPPED' && !(await stopServiceOnWindows(serviceName))) {
        error(`停止旧服务失败:${serviceName}`)
        return false
      }
      // AppParameters 先写、Application 最后写，避免参数失败时旧 core 变成 GUI。
      const configured = await applySteps([
        ...setSteps,
        ['set', serviceName, 'Application', corePath]
      ])
      if (!configured.ok) {
        await restoreSnapshot(snapshot, configured.attempted)
        return false
      }
      if (!(await startServiceOnWindows(serviceName))) {
        await restoreSnapshot(snapshot, configured.attempted)
        return false
      }
      return true
    }

    if (options?.username && options?.password) {
      info(`使用用户 ${options.username} 运行服务`)
    } else {
      info('使用 LocalSystem 运行服务')
    }

    const installRes = await systemOps.runNssmCommand(['install', serviceName, corePath])
    info(`安装服务结果:${JSON.stringify(installRes)}`)
    if (
      !isCommandSuccess(installRes) &&
      !(typeof installRes === 'string' && /success|installed/i.test(installRes))
    ) {
      return false
    }
    const configured = await applySteps(setSteps)
    if (!configured.ok) {
      await removePartialInstall()
      return false
    }
    return true
  } catch (e: any) {
    error(`安装服务失败:${e}`)
    return false
  }
}
/**
 * Windows 删除服务
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否成功
 */
export const uninstallServiceOnWindows = (serviceName: string): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      const status = await checkServiceOnWindows(serviceName)
      if (status === null || status === false) {
        resolve(false)
        return
      }
      const args = ['remove', serviceName, 'confirm']
      const res: any = await systemOps.runNssmCommand(args)
      info(`删除服务:${JSON.stringify(res)}`)
      resolve(isCommandSuccess(res))
    } catch (e: any) {
      error(`删除服务出错:${e}`)
      resolve(false)
    }
  })
}
/**
 * 轮询等待服务达到目标状态：nssm/CLI 的 start/stop 异步生效，固定 sleep 在慢盘上易误判
 * @returns 是否在超时前达到目标状态（中途 STOPPED 等中间态继续等待，超时才算失败）
 */
const waitServiceStatus = async (
  probe: () => Promise<unknown>,
  target: 'SERVICE_RUNNING' | 'SERVICE_STOPPED',
  attempts = 10,
  intervalMs = 500
): Promise<boolean> => {
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs)
    const status = await probe()
    if (typeof status === 'string' && status.trim().toUpperCase() === target) return true
  }
  return false
}

/**
 * Windows 启动服务
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否成功（以服务状态轮询结果为准，而非命令退出码）
 */
export const startServiceOnWindows = (serviceName: string): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      // 服务已运行时 nssm start 可能返回非 0，状态轮询才是唯一成功依据
      const res = await systemOps.runNssmCommand(['start', serviceName])
      const running = await waitServiceStatus(
        () => checkServiceOnWindows(serviceName),
        'SERVICE_RUNNING'
      )
      info(`启动服务:${JSON.stringify(res)} 状态:${running ? 'SERVICE_RUNNING' : '未就绪'}`)
      resolve(running)
    } catch (e: any) {
      error('启动服务出错:', e)
      resolve(false)
    }
  })
}

/**
 * Windows 停止服务
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否成功
 */
export const stopServiceOnWindows = (serviceName: string): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      const res = await systemOps.runNssmCommand(['stop', serviceName])
      const stopped = await waitServiceStatus(
        () => checkServiceOnWindows(serviceName),
        'SERVICE_STOPPED'
      )
      info(`停止服务:${JSON.stringify(res)} 状态:${stopped ? 'SERVICE_STOPPED' : '未就绪'}`)
      resolve(stopped)
    } catch (e: any) {
      error('停止服务出错:', e)
      resolve(false)
    }
  })
}

/**
 * 执行官方 CLI 的 service 子命令（v2.4.5+）
 *
 * 服务名是 Service 子命令的一级参数，必须放在动作之前：
 *   easytier-cli service -n <name> <install|uninstall|status|start|stop>
 * serviceName 传空串时沿用 CLI 默认服务名（env!("CARGO_PKG_NAME")），仅用于兼容
 * 旧版 LightTier 安装的官方服务（当时未传 -n）。
 */
const runOfficialServiceCmd = (serviceName: string, action: string, extra: string[] = []) => {
  const args = ['service']
  if (serviceName) args.push('-n', serviceName)
  args.push(action, ...extra)
  return systemOps.runCliCommand(args)
}

/** 解析 service status 输出：明确未安装 false / 已知状态文本 / 无法确认 null。 */
const parseOfficialServiceStatus = (res: any): string | false | null => {
  const output =
    typeof res === 'string'
      ? res
      : res && typeof res === 'object'
        ? [res.stdout, res.stderr, res.msg]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
        : ''
  const text = output.trim()
  const lowerRes = text.toLowerCase()

  if (!text) return null
  if (
    lowerRes.includes('not installed') ||
    lowerRes.includes('未安装') ||
    lowerRes.includes('does not exist') ||
    lowerRes.includes('不存在')
  ) {
    return false
  }

  if (
    lowerRes.includes('running') ||
    lowerRes.includes('运行') ||
    lowerRes.includes('started') ||
    lowerRes.includes('active')
  ) {
    return 'SERVICE_RUNNING'
  }

  if (lowerRes.includes('stopped') || lowerRes.includes('停止') || lowerRes.includes('inactive')) {
    return 'SERVICE_STOPPED'
  }

  return null
}

/** 查询指定名称（空串=CLI 默认名）的官方服务状态 */
const checkOfficialServiceStatus = async (serviceName: string): Promise<string | false | null> => {
  try {
    return parseOfficialServiceStatus(await runOfficialServiceCmd(serviceName, 'status'))
  } catch (e: any) {
    error(`官方CLI检查服务状态失败: ${e}`)
    return null
  }
}

/**
 * 解析实际可操作的官方服务名：优先具名服务，回退旧版未传 -n 的默认名。
 * @returns 服务名（空串表示 CLI 默认名）；两者都不存在时为 null
 */
const resolveOfficialServiceName = async (serviceName: string): Promise<string | null> => {
  const namedStatus = await checkOfficialServiceStatus(serviceName)
  if (namedStatus === null) return null
  if (typeof namedStatus === 'string') return serviceName
  if (!serviceName) return null

  const defaultStatus = await checkOfficialServiceStatus('')
  if (typeof defaultStatus === 'string') return ''
  return null
}

/**
 * 使用官方 easytier-cli 安装服务
 * @param serviceName 服务名（-n）；按配置独立命名，与 NSSM 方案保持一致
 */
export const installServiceWithOfficialCli = async (
  serviceName: string,
  configPath: string,
  configFileName: string,
  options: {
    description?: string
    displayName?: string
    disableAutostart?: boolean
    /** 当前内核版本；缺省时现场执行 easytier-cli -V 探测 */
    coreVersion?: string | null
  } = {}
): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      const appDirectory = await getResourceDir()
      const platform = await getPlatform()

      // Windows 需要 .exe 扩展名；核心独立存放在 resource/core 下
      const coreFileName = platform === 'windows' ? 'easytier-core.exe' : 'easytier-core'
      const corePath = await join(await resourceDir(), CORE_PATH, coreFileName)

      // 构建命令参数（服务名须位于动作之前：service -n <name> install）
      const args = ['service', '-n', serviceName, 'install']

      if (options.description) {
        args.push('--description', options.description)
      }

      if (options.displayName) {
        args.push('--display-name', options.displayName)
      }

      // 官方 CLI 安装阶段必须禁用自启动；安全转换成功后，仅未禁用自启时由前端恢复。
      args.push('--disable-autostart', 'true')

      // 注意：参数按数组逐项传递，不需要手动添加引号
      args.push('--core-path', `${corePath}`)
      args.push('--service-work-dir', appDirectory)

      // 读取配置文件获取日志配置和 rpc_portal
      // v2.5.0 起 rpc_portal 不再从配置文件读取，需通过 --rpc-portal 命令行参数传递
      const configFile = configFileName.endsWith('.toml')
        ? configFileName
        : `${configFileName}.toml`
      const coreArgs = await buildCoreArgsList(configFile, configPath)

      // 核心参数传递方式随版本变化：
      // - v2.4.5 ~ v2.6.4：`--` 之后的位置参数（trailing_var_arg）
      // - v2.7.0+：`--core-args` 接收 1..N 个值，且必须是最后一个选项
      let coreVersion = parseCoreVersion(options.coreVersion)
      if (!coreVersion) {
        try {
          coreVersion = parseCoreVersion(await runEasyTierCli(['-V']))
        } catch {
          /* 探测失败按旧版位置参数处理 */
        }
      }
      const namedCoreArgs = !!coreVersion && compareCoreVersion(coreVersion, 'v2.7.0') >= 0
      if (namedCoreArgs) {
        args.push('--core-args', ...coreArgs)
      } else {
        args.push('--', ...coreArgs)
      }

      // 执行安装
      const res: any = await systemOps.runCliCommand(args)

      info(`官方CLI安装服务结果: ${JSON.stringify(res)}`)

      if (
        res &&
        (res.code === 0 ||
          res.code === undefined ||
          res.includes('success') ||
          res.includes('安装成功'))
      ) {
        if (options.disableAutostart !== true) {
          const autostart = await systemOps.runNssmCommand([
            'set',
            serviceName,
            'Start',
            'SERVICE_AUTO_START'
          ])
          if (!isCommandSuccess(autostart)) {
            error(`恢复服务开机自启失败:${serviceName}`)
            resolve(false)
            return
          }
        }
        resolve(true)
        return
      }
      resolve(false)
    } catch (e: any) {
      error(`官方CLI安装服务失败: ${e}`)
      resolve(false)
    }
  })
}

/**
 * 使用官方 easytier-cli 卸载服务
 */
export const uninstallServiceWithOfficialCli = async (serviceName: string) => {
  try {
    const target = await resolveOfficialServiceName(serviceName)
    if (target === null) return false

    const res: any = await runOfficialServiceCmd(target, 'uninstall')
    info(`官方CLI卸载服务结果: ${JSON.stringify(res)}`)

    return !!(
      res &&
      (res.code === 0 ||
        res.code === undefined ||
        res.includes('success') ||
        res.includes('卸载成功'))
    )
  } catch (e: any) {
    error(`官方CLI卸载服务失败: ${e}`)
    return false
  }
}

/**
 * 使用官方 easytier-cli 检查服务状态
 * 具名服务不存在时回退 CLI 默认名（兼容旧版 LightTier 安装的官方服务）
 */
export const checkServiceWithOfficialCli = async (
  serviceName: string
): Promise<string | false | null> => {
  const status = await checkOfficialServiceStatus(serviceName)
  if (status === null || typeof status === 'string') return status
  if (serviceName) return await checkOfficialServiceStatus('')
  return false
}

/**
 * 使用官方 easytier-cli 启动服务
 */
export const startServiceWithOfficialCli = async (serviceName: string) => {
  try {
    const target = await resolveOfficialServiceName(serviceName)
    if (target === null) return false
    // 旧默认服务没有具名 SCM 目标，不能安全迁移；绝不回退官方 CLI start。
    if (!target) {
      error('官方默认服务缺少具名 NSSM 目标，拒绝启动')
      return false
    }

    // 官方服务启动也只走受信 NSSM：复核自身哈希/core，并先迁移 Application/AppParameters。
    return await startServiceOnWindows(target)
  } catch (e: any) {
    error(`官方CLI启动服务失败: ${e}`)
    return false
  }
}

/**
 * 使用官方 easytier-cli 停止服务
 */
export const stopServiceWithOfficialCli = async (serviceName: string) => {
  try {
    const target = await resolveOfficialServiceName(serviceName)
    if (target === null) return false

    await runOfficialServiceCmd(target, 'stop')

    // 按实际操作的服务名轮询复查，避免回退探测把另一服务状态误算进来
    return await waitServiceStatus(() => checkOfficialServiceStatus(target), 'SERVICE_STOPPED')
  } catch (e: any) {
    error(`官方CLI停止服务失败: ${e}`)
    return false
  }
}

/** 指定安装方式下服务是否仍然存在；null 表示状态未知。 */
const isServiceInstalled = async (
  serviceName: string,
  method: ServiceInstallMethod
): Promise<boolean | null> => {
  if (method === 'nssm') {
    const status = await checkServiceOnWindows(serviceName)
    return status === null ? null : status !== false
  }
  const status = await checkServiceWithOfficialCli(serviceName)
  return status === null ? null : status !== false
}

/**
 * 自动检测服务安装方式。
 *
 * 有安装记录时只复核该方式：记录为已卸载就不再猜另一种，
 * 避免 nssm 服务被删后官方 CLI 恰好同名而误判。无记录才按 nssm → official 顺序探测。
 */
export const detectServiceInstallMethod = async (
  serviceName: string
): Promise<ServiceInstallMethod | 'none' | 'unknown'> => {
  const recorded = readServiceInstallMethod(serviceName)
  if (recorded) {
    const installed = await isServiceInstalled(serviceName, recorded)
    if (installed === true) return recorded
    return installed === null ? 'unknown' : 'none'
  }

  let unknown = false
  for (const method of ['nssm', 'official'] as const) {
    const installed = await isServiceInstalled(serviceName, method)
    if (installed === true) return method
    if (installed === null) unknown = true
  }
  return unknown ? 'unknown' : 'none'
}

/** 把 IPv4 的最后一段替换为 0（192.168.1.5 → 192.168.1.0），用于按网段探测路由 */
export const replaceLastWithZero = (ip: string): string => {
  const segments = ip.split('.')
  if (segments.length === 1) return '0'
  segments[segments.length - 1] = '0'
  return segments.join('.')
}
