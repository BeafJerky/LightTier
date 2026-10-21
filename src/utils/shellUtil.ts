/**
 * 桌面进程与内核命令行工具层（Windows / macOS / Linux）
 *
 * 职责：easytier-core 后台启停（含 RPC 端口自动分配与双层冲突检测）、
 * easytier-cli 调用、进程扫描（Windows 走 PowerShell CIM，Unix 走 ps）、
 * 进程终止、端口冲突预检（规避多实例启动失败）、Windows 服务管理
 * （NSSM / 官方 CLI 双方案）与路由增删。
 * 说明：Android 平台不经过此层（内核进程内运行，见 mobileVpn.ts / coreApi.ts）。
 */
import { CONFIG_PATH, CORE_PATH, NSSM_NAME } from '@/constants/easytier'
import { invoke } from '@tauri-apps/api/core'
import { join, resourceDir } from '@tauri-apps/api/path'
import { attachConsole, debug, error, info, warn } from '@tauri-apps/plugin-log'
import { Command, type SpawnOptions } from '@tauri-apps/plugin-shell'
import { getCliDir, getCoreDir, getLogsDir, getResourceDir, readFileContent } from './fileUtil'
import {
  DEFAULT_LOG_COUNT,
  DEFAULT_LOG_SIZE_MB,
  normalizeLogLevel,
  parsePositiveInt,
  resolveLogDir
} from './coreLogUtil'
import { getPlatform, sleep } from './sysUtil'
import * as toml from 'smol-toml'
import { clearExitRoute } from './routeUtil'
import { compareCoreVersion, parseCoreVersion } from './kernelCompatUtil'
import { t } from '@/utils/i18nUtil'

// 启用 TargetKind::Webview 后，这个函数将把日志打印到浏览器控制台
attachConsole()

// 内核日志兜底目录：<resource>/logs（保证与读取端 LogViewer/clearETLogs/routeUtil 同目录）；
// 极端失败（非 Tauri 环境等）时退回相对 './logs' 由内核按进程 CWD 解析
async function getDefaultLogDir(): Promise<string> {
  try {
    return await getLogsDir()
  } catch {
    return './logs'
  }
}

/**
 * 从配置文件中读取日志/端口相关配置（内核启动与服务安装共用）
 *
 * 日志目录统一归一化为绝对路径：配置为空或相对路径时回落 <resource>/logs。
 * v2.6.x 内核忽略 TOML `[file_logger]` 段，其日志由本层翻译为 CLI 参数
 * （--file-log-dir/level/size/count）传入；相对目录会随内核进程 CWD 漂移，
 * 导致日志查看/清理/路由提取全部读不到（修复 H-02）。
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

    // 获取日志配置（归一化目录/级别与轮转参数，非法值回落默认，避免内核启动 panic）
    const logger = config.file_logger || {}
    const logDir = await resolveLogDir(logger.dir, getDefaultLogDir)
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
    // 返回默认值（日志目录仍尽力回落到应用 logs 目录）
    return {
      logDir: await getDefaultLogDir(),
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
export async function executeCmd(
  program: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<any> {
  try {
    // 创建命令实例
    const command = Command.create(program, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: options.encoding
    })
    // 执行并等待完成
    const output = await command.execute()
    // 注：output.code 为 null（信号终止等）时按 0 处理；不少 Windows 工具成功时也会向 stderr 输出进度/告警
    const code = output.code ?? 0
    const stdout = output.stdout || ''
    const stderr = output.stderr || ''
    if (code !== 0) {
      warn(`执行参数:${JSON.stringify(args)}`)
      warn(`执行程序失败(code=${code}):${stderr || stdout || '未知错误'}`)
      return {
        code,
        msg: stderr.trim() || stdout.trim() || String(output),
        stdout: stdout.trim(),
        stderr: stderr.trim()
      }
    }
    return stdout.trim() || { code: 0, stdout: '', stderr: stderr.trim() }
  } catch (e: any) {
    error(`执行程序失败:${JSON.stringify(e)}`)
    throw e
  }
}

/**
 * 在后台持续运行外部程序
 * @param program 程序路径
 * @param args 程序参数数组
 * @param options 执行选项（可选）
 * @returns Promise<number> 返回进程 PID
 *
 * 使用示例:
 * ```
 * // 示例1: 启动 Node.js 服务
 * const pid = await executeBack('node', ['server.js'])
 *
 * // 示例2: 启动 Python 脚本
 * const pid = await executeBack('python', ['script.py'], {
 *   cwd: '/path/to/project'
 * })
 *
 * // 示例3: 启动带环境变量的程序
 * const pid = await executeBack('myapp', [], {
 *   env: {
 *     'NODE_ENV': 'production'
 *   }
 * })
 * ```
 */
export async function executeBack(
  program: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<number> {
  try {
    // 根据操作系统选择不同的命令
    const platform = await getPlatform()
    const binPath = await join(await getResourceDir(), program)
    let finalProgram = program
    let finalArgs = args
    if (platform === 'windows') {
      // Windows 下使用 start 命令在后台运行
      // 注意：cmd /c 会将后面的参数拼接成字符串并通过 shell 解析
      // 所以需要将整个命令构建成一个字符串，并正确处理包含空格的路径
      // start 命令格式：start ["title"] [/d path] [options] command [parameters]
      // 第一个引号参数被当作窗口标题，所以我们用空字符串 "" 作为标题
      const quotedProgram = program.includes(' ') ? `"${program}"` : program
      // 为包含空格的参数添加引号
      const quotedArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')
      // 将整个命令拼接成一个字符串传递给 cmd /c
      const commandStr = `start "" /b ${quotedProgram} ${quotedArgs}`
      finalArgs = ['/c', commandStr]
      finalProgram = 'cmd'
    }
    if (platform === 'linux' || platform === 'macos') {
      // 使用 sudo 运行 nohup
      // Unix 系统使用数组参数，Tauri 会正确处理包含空格的参数，不需要手动添加引号
      finalArgs = ['nohup', binPath, ...args]
      finalProgram = 'sudo'
    }
    info(`执行命令：${finalProgram}`)
    info(`执行参数：${JSON.stringify(finalArgs)}`)
    // 创建命令对象
    const command = Command.create(finalProgram, finalArgs, options)

    // 监听输出(可选)
    command.stdout.on('data', (line) => {
      info(`[${program}] 输出:${line}`)
    })
    // 监听错误
    command.on('error', (e: any) => {
      error(`[${program}] 错误:${e}`)
    })

    // 启动进程
    const child = await command.spawn()

    info(`[${program}] 后台进程已启动, PID: ${child.pid}`)
    return child.pid
  } catch (e: any) {
    error(`启动后台程序失败:${e}`)
    throw e
  }
}

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
      const match = cmd.match(/[\/\\]([^\/\\]+)\.toml/) || cmd.match(/([^\s"]+)\.toml/)
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

// 运行 easytier-core 配置（自动分配 RPC 端口）
export async function runEasyTierCore(configFileName: string): Promise<any> {
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

    const res = await invoke('run_command', {
      program,
      args
    })
    info(`运行结果：${res}, rpc-portal: ${actualRpcPortal}`)
    return res
  } catch (e) {
    error(`运行 easytier-core失败:${JSON.stringify(e)}`)
    return 403
  }
}

// 运行 easytier-core web配置
export async function runEasyTierCoreWeb(url: string): Promise<any> {
  try {
    const program = await getCoreDir()
    const res = await invoke('run_command', {
      program,
      args: ['--config-server', `${url}`]
    })
    info(`运行结果：${res}`)
    return res
  } catch (e) {
    error(`运行 easytier-core失败:${JSON.stringify(e)}`)
    return 403
  }
}

// 运行 easytier-cli 配置
export async function runEasyTierCli(args: string[]): Promise<any> {
  try {
    // 注：改用 Rust 侧 run_cli 会出现卡顿，故统一走 shell 执行
    return await executeCmd('easytier-cli', args)
  } catch (e) {
    error(`获取结果失败:${JSON.stringify(e)}`)
    return 403
  }
}

// 经 Rust 侧 run_cli 调用本地 easytier-cli（与 runEasyTierCli 的 shell 路径互补）
export async function runCmd(args: string[]): Promise<any> {
  try {
    const program = await getCliDir()
    return await invoke('run_cli', {
      program,
      args
    })
  } catch (e) {
    error(`获取结果失败:${JSON.stringify(e)}`)
    return 403
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
export async function killProcess(pid: number, force: boolean = true): Promise<boolean> {
  try {
    const platform = await getPlatform()
    // Windows 使用 taskkill 命令
    if (platform === 'windows') {
      const args = force ? ['/F', '/PID', pid.toString()] : ['/PID', pid.toString()]
      const result = await executeCmd('taskkill', args, { encoding: 'gbk' })
      debug(`强制终止进程 ${result}`)
    }
    // Unix-like 系统使用 kill 命令
    else {
      const signal = force ? '-9' : '-15' // SIGKILL vs SIGTERM
      const result = await executeCmd('kill', [signal, pid.toString()])
      debug(`强制终止进程 ${result}`)
    }
    info(`进程 ${pid} 已终止`)
    return true
  } catch (e: any) {
    error(`终止进程 ${pid} 失败:${e}`)
    return false
  }
}

// 停止所有节点
export async function stopAllNodes() {
  try {
    const processList = await getRunningProcesses('easytier-core')
    await Promise.all(
      processList.map(async (process) => {
        await killProcess(process.pid)
      })
    )
    // 5.10：全部停止后自动清除出口节点路由（升级内核等强停场景不残留）
    await clearExitRoute()
  } catch (e) {
    error(`停止所有节点失败:${e}`)
  }
}

// Linux/macOS 下使用 sudo 的示例
export async function killProcessWithSudo(pid: number, force: boolean = false): Promise<boolean> {
  try {
    const signal = force ? '-9' : '-15'
    await executeCmd('sudo', ['kill', signal, pid.toString()])
    return true
  } catch (e: any) {
    error(`使用 sudo 终止进程 ${pid} 失败:${e}`)
    return false
  }
}

// Windows 结束所有 easytier-core 进程
export async function killAllEasyTierCoreProcessWin() {
  return await executeCmd('taskkill', ['/IM', 'easytier-core.exe', '/F'])
}

// Linux/macOS 结束所有 easytier-core 进程
export async function killAllEasyTierCoreProcessUnix() {
  return await executeCmd('killall', ['easytier-core'])
}

/**
 * 获取正在运行的程序信息
 * @param {string} [programName] - 可选的程序名，用于模糊查询
 * @returns {Promise<Array>} - 返回一个包含程序信息的数组对象
 */
export const getRunningProcesses = async (
  programName: string = 'easytier-core'
): Promise<Array<any>> => {
  return new Promise(async (resolve, reject) => {
    // 声明后由下方平台分支赋值（初始值从未被读取，无需初始化）
    let args: string[]
    let program: string
    let encoding = 'utf-8'
    const processInfo: any[] = []
    const platform = await getPlatform()

    if (platform === 'windows') {
      // 新的 PowerShell 命令
      const psCommand = `\
        Get-CimInstance -ClassName Win32_Process -Filter "CommandLine LIKE '%${programName}%'" |\
        Select-Object @{N='name';E={$_.Caption}},\
                      @{N='commandLine';E={$_.CommandLine}},\
                      @{N='path';E={$_.ExecutablePath}},\
                      @{N='pid';E={$_.ProcessId}},\
                      @{N='memory';E={$_.WorkingSetSize}} |\
        ConvertTo-Json -Compress\
      `.trim()

      program = 'powershell'
      // 可选 ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand]
      args = ['-NoProfile', '-Command', psCommand]
      encoding = 'gbk'
    } else if (platform === 'macos' || platform === 'linux') {
      // macOS 和 Linux 使用 ps 命令
      // 注意：管道符需要通过 shell 执行，所以使用 sh -c 包装整个命令
      const psCommand = `ps -eo comm,args,pid,rss | grep ${programName}`
      program = 'sh'
      args = ['-c', psCommand]
    } else {
      reject(new Error('Unsupported OS'))
      return
    }
    executeCmd(program, args, { encoding })
      .then((res) => {
        // 命令失败（返回 { code, msg }）或 grep 无匹配（Unix 下 grep 退出码 1）时视为无匹配进程
        if (typeof res !== 'string') {
          resolve(processInfo)
          return
        }
        if (platform === 'windows') {
          // 解析 PowerShell 的 JSON 输出
          // 注：ConvertTo-Json 在仅一条结果时输出单个对象而非数组，需归一化为数组
          let parsed: any
          try {
            parsed = JSON.parse(res || '[]')
          } catch {
            parsed = []
          }
          const list = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === 'object'
              ? [parsed]
              : []
          const result = list.filter((r: any) => !String(r.name || '').includes('powershell.exe'))
          result.forEach((p: any) => {
            if (p.commandLine && p.commandLine.includes(programName)) {
              const process = {
                name: p.name,
                commandLine: p.commandLine,
                path: p.path,
                pid: parseInt(p.pid, 10) || 0,
                memory: parseInt(p.memory, 10) || 0,
                fileName: programName
              }
              processInfo.push(process)
            }
          })
          resolve(processInfo)
          return
        }
        // 解析 macOS 和 Linux 的 ps 文本输出（列固定为 comm,args,pid,rss，从行尾定位 pid/rss 最稳妥）
        const lines = res.trim().split('\n')
        lines.forEach((line: string) => {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 4) {
            const rss = parts[parts.length - 1]
            const pid = parts[parts.length - 2]
            const comm = parts[0]
            const commandLine = parts.slice(1, parts.length - 2).join(' ')
            if (commandLine.includes(programName)) {
              const process = {
                name: comm,
                commandLine: commandLine,
                path: comm, // ps 命令不直接提供可执行文件路径
                pid: parseInt(pid, 10),
                memory: parseInt(rss, 10) * 1024, // rss 单位是 KB
                fileName: programName
              }
              processInfo.push(process)
            }
          }
        })
        resolve(processInfo)
      })
      .catch((error) => {
        reject(error)
      })
  })
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
      const match = cmd.match(/[\/\\]([^\/\\]+)\.toml/) || cmd.match(/([^\s"]+)\.toml/)
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
 * 检测服务是否存在
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否存在
 */
export const checkServiceOnWindows = (serviceName: string): Promise<any> => {
  return new Promise(async (resolve) => {
    try {
      const args = ['status', serviceName]
      const res: any = await executeCmd(NSSM_NAME, args, { encoding: 'gbk' })
      // 服务不存在时 nssm 返回 code 3 或 "does not exist" 文案
      if (res && (res.code! === 3 || res.includes('does not exist'))) {
        resolve(false)
        return
      }
      resolve(res)
    } catch (e: any) {
      resolve(false)
    }
  })
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
/**
 * Windows 安装指定程序为系统服务
 * @param serviceName 服务名
 * @param args 程序参数
 * @param options 可选参数
 * @param options.username 运行服务的用户名（可选，不提供则使用 LocalSystem）
 * @param options.password 运行服务的用户密码（当提供 username 时必需）
 * @returns Promise<boolean> 是否成功
 */
export const installServiceOnWindows = async (
  serviceName: string,
  args: string,
  options?: { username?: string; password?: string }
): Promise<boolean> => {
  return new Promise(async (resolve) => {
    const appDirectory = await getResourceDir()
    // Windows 需要 .exe 扩展名；核心独立存放在 resource/core 下
    const corePath = await join(await resourceDir(), CORE_PATH, 'easytier-core.exe')
    try {
      // 服务是否存在
      const exist: any = await checkServiceOnWindows(serviceName)
      info(`服务是否存在:${JSON.stringify(exist)}`)
      if (exist) {
        resolve(true)
        return
      }
      // 注意：Tauri Command.create 会将每个数组元素作为独立参数传递，不需要手动添加引号
      // 引号只在通过 shell 解析字符串时需要
      const args1 = ['install', serviceName, `${corePath}`]

      const args2 = ['set', serviceName, 'AppParameters', `${args}`]
      const args3 = ['set', serviceName, 'AppDirectory', appDirectory]
      const args4 = ['set', serviceName, 'AppExit', 'Default', 'Restart']
      const args5 = [
        'set',
        serviceName,
        'Description',
        t('newConfig.svcDefaultDesc', { name: serviceName })
      ]
      const args6 = [
        'set',
        serviceName,
        'DisplayName',
        t('newConfig.svcDefaultName', { name: serviceName })
      ]

      // 如果提供了用户名和密码，使用指定用户运行服务；否则使用 LocalSystem
      let args7: string[]
      if (options?.username && options?.password) {
        args7 = ['set', serviceName, 'ObjectName', `.\\${options.username}`, options.password]
        info(`使用用户 ${options.username} 运行服务`)
      } else {
        args7 = ['set', serviceName, 'ObjectName', 'LocalSystem']
        info('使用 LocalSystem 运行服务')
      }

      const args8 = ['set', serviceName, 'Start', 'SERVICE_AUTO_START']
      const args9 = ['set', serviceName, 'Type', 'SERVICE_WIN32_OWN_PROCESS']
      await executeCmd(NSSM_NAME, args1, { encoding: 'gbk' }).then(async (res) => {
        info(`安装服务结果:${JSON.stringify(res)}`)
        if (
          res &&
          (res.code! === 0 ||
            res.code! === 1 ||
            res.includes('success') ||
            res.includes('installed'))
        ) {
          await executeCmd(NSSM_NAME, args2, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args3, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args4, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args5, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args6, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args7, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args8, { encoding: 'gbk' })
          await executeCmd(NSSM_NAME, args9, { encoding: 'gbk' })
          resolve(true)
          return
        }
        resolve(false)
      })
    } catch (e: any) {
      error(`安装服务失败:${e}`)
      resolve(false)
    }
  })
}
/**
 * Windows 删除服务
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否成功
 */
export const uninstallServiceOnWindows = (serviceName: string) => {
  return new Promise(async (resolve) => {
    try {
      const args = ['remove', serviceName, 'confirm']
      const res: any = await executeCmd(NSSM_NAME, args, { encoding: 'gbk' })
      info(`删除服务:${JSON.stringify(res)}`)
      if (res && (res.code! === 0 || res.includes('success'))) {
        resolve(true)
      } else {
        resolve(false)
      }
    } catch (e: any) {
      error(`删除服务出错:${e}`)
      resolve(false)
    }
  })
}
/**
 * Windows 启动服务
 * @param serviceName 服务名
 * @returns Promise<boolean> 是否成功
 */
export const startServiceOnWindows = (serviceName: string) => {
  return new Promise(async (resolve) => {
    try {
      const args = ['start', serviceName]
      await executeCmd(NSSM_NAME, args, { encoding: 'gbk' })
      await sleep(2000)
      const res = await checkServiceOnWindows(serviceName)
      info('启动服务:' + JSON.stringify(res))
      if (JSON.stringify(res).includes('SERVICE_STOPPED')) {
        resolve(false)
        return
      }
      resolve(true)
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
export const stopServiceOnWindows = (serviceName: string) => {
  return new Promise(async (resolve) => {
    try {
      const args = ['stop', serviceName]
      await executeCmd(NSSM_NAME, args, { encoding: 'gbk' })
      await sleep(2000)
      const res = await checkServiceOnWindows(serviceName)
      info('停止服务:' + JSON.stringify(res))
      if (JSON.stringify(res).includes('SERVICE_STOPPED')) {
        resolve(true)
        return
      }
      resolve(false)
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
  return executeCmd('easytier-cli', args, { encoding: 'gbk' })
}

/** 解析 service status 输出：未安装 false / 运行中 SERVICE_RUNNING / 已停止 SERVICE_STOPPED */
const parseOfficialServiceStatus = (res: any): string | boolean => {
  if (typeof res === 'string') {
    const lowerRes = res.toLowerCase()

    // 首先检查未安装状态（优先级最高）
    if (
      lowerRes.includes('not installed') ||
      lowerRes.includes('未安装') ||
      lowerRes.includes('does not exist') ||
      lowerRes.includes('不存在')
    ) {
      return false
    }

    // 检查运行状态
    if (
      lowerRes.includes('running') ||
      lowerRes.includes('运行') ||
      lowerRes.includes('started') ||
      lowerRes.includes('active')
    ) {
      return 'SERVICE_RUNNING'
    }

    // 检查停止状态
    if (
      lowerRes.includes('stopped') ||
      lowerRes.includes('停止') ||
      lowerRes.includes('inactive')
    ) {
      return 'SERVICE_STOPPED'
    }
  }

  // 检查返回对象的错误码
  if (res && typeof res === 'object') {
    // code 为 0 表示命令执行成功
    if (res.code === 0) return 'SERVICE_STOPPED'
    // 其他错误码表示服务不存在或命令失败
    if (res.code !== undefined) return false
  }

  // 默认未安装
  return false
}

/** 查询指定名称（空串=CLI 默认名）的官方服务状态 */
const checkOfficialServiceStatus = async (serviceName: string): Promise<string | boolean> => {
  try {
    return parseOfficialServiceStatus(await runOfficialServiceCmd(serviceName, 'status'))
  } catch (e: any) {
    error(`官方CLI检查服务状态失败: ${e}`)
    return false
  }
}

/**
 * 解析实际可操作的官方服务名：优先具名服务，回退旧版未传 -n 的默认名。
 * @returns 服务名（空串表示 CLI 默认名）；两者都不存在时为 null
 */
const resolveOfficialServiceName = async (serviceName: string): Promise<string | null> => {
  if ((await checkOfficialServiceStatus(serviceName)) !== false) return serviceName
  if (serviceName && (await checkOfficialServiceStatus('')) !== false) return ''
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

      // 官方 CLI 的 --disable-autostart 为 Option<bool>，必须显式带 true/false
      if (options.disableAutostart) {
        args.push('--disable-autostart', 'true')
      }

      // 注意：Tauri Command.create 会将每个数组元素作为独立参数传递，不需要手动添加引号
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
      const res: any = await executeCmd('easytier-cli', args, { encoding: 'gbk' })

      info(`官方CLI安装服务结果: ${JSON.stringify(res)}`)

      if (
        res &&
        (res.code === 0 ||
          res.code === undefined ||
          res.includes('success') ||
          res.includes('安装成功'))
      ) {
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
export const checkServiceWithOfficialCli = async (serviceName: string) => {
  const status = await checkOfficialServiceStatus(serviceName)
  if (status !== false) return status
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

    await runOfficialServiceCmd(target, 'start')
    await sleep(2000)

    // 按实际操作的服务名复查，避免回退探测把另一服务状态误算进来
    return (await checkOfficialServiceStatus(target)) === 'SERVICE_RUNNING'
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
    await sleep(2000)

    // 按实际操作的服务名复查，避免回退探测把另一服务状态误算进来
    return (await checkOfficialServiceStatus(target)) === 'SERVICE_STOPPED'
  } catch (e: any) {
    error(`官方CLI停止服务失败: ${e}`)
    return false
  }
}

/**
 * 自动检测服务安装方式
 */
export const detectServiceInstallMethod = async (
  serviceName: string
): Promise<'nssm' | 'official' | 'none'> => {
  // 从 serviceName 中提取 configFileName (移除 'easytier-' 前缀)
  const configFileName = serviceName.replace(/^easytier-/, '')

  // 优先从 localStorage 读取保存的安装方式
  const SERVICE_CONFIG_PREFIX = 'service-config:'
  const savedConfigStr = localStorage.getItem(SERVICE_CONFIG_PREFIX + configFileName)

  if (savedConfigStr) {
    try {
      const savedConfig = JSON.parse(savedConfigStr)
      const savedMethod = savedConfig.installMethod

      // 如果有保存的安装方式，直接检查该方式的状态
      if (savedMethod === 'nssm') {
        const status = await checkServiceOnWindows(serviceName)
        if (status && status !== false) {
          return 'nssm'
        }
        // 如果服务已卸载，返回 none
        return 'none'
      } else if (savedMethod === 'official') {
        const status = await checkServiceWithOfficialCli(serviceName)
        if (status) {
          return 'official'
        }
        // 如果服务已卸载，返回 none
        return 'none'
      }
    } catch (e) {
      // 解析失败，继续使用自动检测
      error(`解析服务配置失败: ${e}`)
    }
  }

  // 没有保存的配置，使用自动检测（向后兼容旧版本安装的服务）
  // 先检查 NSSM
  const nssmStatus = await checkServiceOnWindows(serviceName)
  if (nssmStatus && nssmStatus !== false) {
    return 'nssm'
  }

  // 再检查官方 CLI
  const officialStatus = await checkServiceWithOfficialCli(serviceName)
  if (officialStatus) {
    return 'official'
  }

  return 'none'
}

// 将 IP 最后一段替换为 0（如 192.168.1.5 → 192.168.1.0，用于路由检测/添加）
export const replaceLastWithZero = (ip: string) => {
  return ip.substring(0, ip.lastIndexOf('.') + 1) + '0'
}
/**
 * Windows 检测路由是否存在
 * @param ip
 * @returns
 */
export const checkRouteOnWindows = async (ip: string) => {
  return new Promise(async (resolve) => {
    try {
      const res = await executeCmd('route', ['print', '-4', ip], { encoding: 'gbk' })
      if (res.includes(ip)) {
        resolve(true)
      } else {
        resolve(false)
      }
    } catch (e: any) {
      error('检测路由失败:', e)
      resolve(false)
    }
  })
}

/**
 * Windows 添加路由
 * @param ip
 * @returns
 */
export const addRouteOnWindows = async (ip: string) => {
  return new Promise(async (resolve) => {
    try {
      const res = await executeCmd('route', ['add', ip, 'mask', '255.255.255.255', '0.0.0.0'], {
        encoding: 'gbk'
      })
      if (res.includes('OK!')) {
        resolve(true)
      } else {
        resolve(false)
      }
    } catch (e: any) {
      error('添加路由失败:', e)
      resolve(false)
    }
  })
}

/**
 * Windows 删除路由
 * @param ip
 * @returns
 */
export const delRouteOnWindows = async (ip: string) => {
  return new Promise(async (resolve) => {
    try {
      const res = await executeCmd('route', ['delete', ip], { encoding: 'gbk' })
      if (res.includes('OK!')) {
        resolve(true)
      } else {
        resolve(false)
      }
    } catch (e: any) {
      error('删除路由失败:', e)
      resolve(false)
    }
  })
}

// JSON 安全解析：空串/解析失败时返回 fallback，避免调用方抛错
export const safeJsonParse = (str: string, fallback: any = {}) => {
  try {
    return str && str.trim() ? JSON.parse(str) : fallback
  } catch (e) {
    return fallback
  }
}
