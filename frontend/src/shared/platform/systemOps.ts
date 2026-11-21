/**
 * 系统操作（Windows 桌面）薄封装。
 *
 * 参数由 Rust 侧二次校验并按固定模板执行；浏览器 Mock 不允许静默降级，
 * 调用方必须先通过 isTauri() 判断运行环境。
 */
import { invoke, isTauri } from '@tauri-apps/api/core'

export interface RouteRow {
  target: string
  mask: string
  gateway: string
  metric: number
}

export interface ProcessInfo {
  name: string
  commandLine: string
  path: string
  pid: number
  memory: number
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface CommandFailure {
  code: number
  msg?: string
  stdout: string
  stderr: string
}

const toExecuteResult = (result: CommandResult): string | CommandFailure => {
  const code = result.code ?? 0
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  if (code !== 0) {
    return {
      code,
      msg: stderr.trim() || stdout.trim() || `退出码 ${code}`,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    }
  }
  return stdout.trim() || { code: 0, stdout: '', stderr: stderr.trim() }
}

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauri()) {
    throw new Error('system operations require desktop runtime')
  }
  return invoke<T>(command, args)
}

export const activeAdapter = (): Promise<string | null> => call('sysops_active_adapter')

export const defaultGateway = (): Promise<string | null> => call('sysops_default_gateway')

export const setAdapterMetric = (name: string, enabled: boolean): Promise<void> =>
  call('sysops_set_adapter_metric', { name, enabled })

export const routeAdd = (
  target: string,
  mask: string,
  gateway: string,
  metric: number
): Promise<void> => call('sysops_route_add', { target, mask, gateway, metric })

export const routeDelete = (target: string, mask: string, gateway: string): Promise<void> =>
  call('sysops_route_delete', { target, mask, gateway })

export const routeChangeDefault = (gateway: string, metric: number): Promise<void> =>
  call('sysops_route_change_default', { gateway, metric })

export const printRoutes = (): Promise<RouteRow[]> => call('sysops_route_print')

export const routeExists = (ip: string): Promise<boolean> => call('sysops_route_exists', { ip })

export const listProcesses = (filter: string): Promise<ProcessInfo[]> =>
  call('sysops_list_processes', { filter })

export const killProcess = (pid: number): Promise<boolean> => call('sysops_kill_process', { pid })

/** 受控执行 nssm：Rust 侧校验动词与 set 键白名单 */
export const runNssmCommand = async (args: string[]): Promise<string | CommandFailure> =>
  toExecuteResult(await call<CommandResult>('sysops_nssm_run', { args }))

/** 受控执行 easytier-cli：仅版本、node/peer 查询与 service 子命令 */
export const runCliCommand = async (args: string[]): Promise<string | CommandFailure> =>
  toExecuteResult(await call<CommandResult>('sysops_cli_run', { args }))

/** Unix 桌面补可执行位；Windows 为 no-op */
export const ensureExecutable = (paths: string[]): Promise<void> =>
  call('sysops_ensure_executable', { paths })

/** 打开本地路径或 http(s) 链接 */
export const openPath = (path: string): Promise<void> => call('open_path', { path })

/** 安装前校验内核包 SHA-256（只接受内置清单内的受支持版本） */
export const verifyCorePackage = (version: string, path: string): Promise<void> =>
  call('sysops_verify_core_package', { version, path })
