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
