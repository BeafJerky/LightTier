/**
 * 后端运行态服务接口（lighttier-runtime）。
 *
 * 桌面与 Android 均由 Rust 侧单例扫描进程/实例并按订阅采样监控，
 * 前端只消费快照与事件；浏览器无 Tauri 运行时由调用方回退到 mock。
 */
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface RuntimeInstance {
  configFileName: string
  fileName: string
  /** Android 进程内实例无 PID（0） */
  pid: number
  rpcPortal?: string
  instanceId?: string
  virtualIp?: string
}

export interface RuntimeSnapshot {
  revision: number
  updatedAt: number
  instances: RuntimeInstance[]
  catalog: string[]
}

export interface RuntimeMonitorSnapshot {
  configFileName: string
  revision: number
  /** 0 表示从未成功采样（仅失败记录） */
  sampledAt: number
  nodeInfo: Record<string, any>
  peerList: any[]
  failures: number
  stale: boolean
  error?: string
}

/** 后端运行态服务是否可用（Tauri 桌面/Android） */
export const runtimeAvailable = (): boolean => {
  try {
    return isTauri()
  } catch {
    return false
  }
}

export const getRuntimeSnapshot = (): Promise<RuntimeSnapshot> =>
  invoke<RuntimeSnapshot>('runtime_get_snapshot')

export const setRuntimeCatalog = (catalog: string[]): Promise<void> =>
  invoke<void>('runtime_set_catalog', { catalog })

/** 触发一次立即扫描（启动/停止实例后调用） */
export const refreshRuntime = (): Promise<void> => invoke<void>('runtime_refresh')

/** 订阅监控采样，返回该实例上一份快照用于首屏立即渲染 */
export const subscribeMonitor = async (
  instance: RuntimeInstance,
  intervalMs: number
): Promise<RuntimeMonitorSnapshot | null> => {
  const result = await invoke<RuntimeMonitorSnapshot | null>('monitor_subscribe', {
    subscription: { instance, intervalMs }
  })
  return result ?? null
}

export const unsubscribeMonitor = (): Promise<void> => invoke<void>('monitor_unsubscribe')

export const getMonitorSnapshot = async (
  configFileName: string
): Promise<RuntimeMonitorSnapshot | null> => {
  const result = await invoke<RuntimeMonitorSnapshot | null>('monitor_get_snapshot', {
    configFileName
  })
  return result ?? null
}

export const onRuntimeSnapshot = (
  handler: (snapshot: RuntimeSnapshot) => void
): Promise<UnlistenFn> =>
  listen<RuntimeSnapshot>('runtime:snapshot', (event) => handler(event.payload))

export const onMonitorSnapshot = (
  handler: (snapshot: RuntimeMonitorSnapshot) => void
): Promise<UnlistenFn> =>
  listen<RuntimeMonitorSnapshot>('monitor:snapshot', (event) => handler(event.payload))

/** 后端实例 → 前端运行记录（PID 为 0 时视为无 PID，与 Android 一致） */
export const toRunningItem = (instance: RuntimeInstance): RunningItem => ({
  configFileName: instance.configFileName,
  fileName: instance.fileName,
  pid: instance.pid > 0 ? instance.pid : undefined,
  rpcPortal: instance.rpcPortal,
  instanceId: instance.instanceId,
  virtualIp: instance.virtualIp
})

/** 前端运行记录 → 后端订阅参数（仅取后端声明字段） */
export const toRuntimeInstance = (item: RunningItem): RuntimeInstance => ({
  configFileName: item.configFileName,
  fileName: item.fileName || `${item.configFileName}.toml`,
  pid: item.pid ?? 0,
  rpcPortal: item.rpcPortal,
  instanceId: item.instanceId,
  virtualIp: item.virtualIp
})
