/**
 * 后台门面类型定义（agent 模式的任务契约）。
 *
 * 页面只依赖本文件的 `Backend` 接口：native / mock 模式返回原生适配器，
 * agent 模式返回 HTTP 适配器。字段口径以本文件为准，后续任务按此实现，
 * 不在适配器内部发明新形状。
 */
import type { RuntimeHealthSnapshot, RuntimeSnapshot } from '../runtimeApi'

export type BackendKind = 'native' | 'agent'

/** agent 响应中未建模的自由结构（实例快照等由后续任务收窄） */
export type UnknownRecord = Record<string, unknown>

export interface Meta {
  apiVersion: number
  agentVersion: string
  setupRequired: boolean
  tunAvailable: boolean
  tunReason?: string
  features: Record<
    | 'routes'
    | 'services'
    | 'metrics'
    | 'tray'
    | 'themes'
    | 'update'
    | 'login'
    | 'kernel'
    | 'logs'
    | 'defaultRouteChange',
    boolean
  >
  coreVersions: { version: string; channel: 'stable' | 'prerelease' }[]
}

export interface Session {
  authenticated: boolean
}

export interface ConfigMeta {
  id: string
  hash: string
  size: number
  modifiedAt: number
}

export interface TaskView {
  id: string
  version: string
  state: string
  downloaded: number
  total?: number | null
  error?: { code: string; message: string } | null
  /** Unix 秒；服务端在任务创建时记录 */
  startedAt?: number
}

export interface PackagesInfo {
  installed: { version: string; builtin: boolean }[]
  available: { version: string; channel: 'stable' | 'prerelease'; installed: boolean }[]
  active?: string | null
  /**
   * 当前部署是否允许安装（`LT_CORE_DIR` 覆盖时服务端返回 false）。
   * native 适配器无此概念，默认 true；页面必须先消费该位再提供安装入口。
   */
  installAllowed: boolean
  /**
   * 加速源是否被部署方通过 `LT_CORE_MIRROR` 锁定（native 恒为 false）。
   * 锁定时选择、增删与测速入口必须禁用。
   */
  mirrorLocked: boolean
}

/** `POST /api/v1/packages/mirror-probe` 的单源结果（source 为归一化前缀回显） */
export interface MirrorProbeResult {
  source: string
  latencyMs: number | null
  speedBytesPerSec: number | null
  ok: boolean
}

/** 日志文件元信息（`GET /api/v1/logs` 的条目） */
export interface LogFile {
  name: string
  size: number
  /** Unix 秒；平台无法提供时为 0 */
  modifiedAt: number
}

export interface LogList {
  agent: LogFile[]
  core: { id: string; files: LogFile[] }[]
}

/**
 * 监控值：`data` 为节点 / 对等体原始载荷，`stale` 表示服务端采样已过期。
 * 精确形状由 Task 9 从现有 runtimeApi / useMonitorQuery 类型收窄。
 */
export interface MonitorValue {
  stale: boolean
  data: UnknownRecord | UnknownRecord[] | null
  error?: string | null
}

export interface Capabilities {
  routes: boolean
  services: boolean
  themes: boolean
  update: boolean
  tray: boolean
  kernel: boolean
  logs: boolean
  mirror: boolean
}

export interface Backend {
  kind: BackendKind
  auth: {
    meta(): Promise<Meta>
    session(): Promise<Session>
    login(pw: string): Promise<void>
    setup(token: string, pw: string): Promise<void>
    logout(): Promise<void>
    changePassword(password: string): Promise<void>
  }
  configs: {
    list(): Promise<ConfigMeta[]>
    read(id: string): Promise<{ toml: string; hash: string }>
    write(id: string, toml: string, expectedHash?: string): Promise<string>
    remove(id: string): Promise<void>
    rename(id: string, to: string): Promise<void>
    importToml(filename: string, toml: string): Promise<string>
    exportToml(id: string): Promise<{ filename: string; toml: string }>
  }
  runner: {
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    restart(id: string): Promise<void>
  }
  runtime: {
    instances(): Promise<RuntimeSnapshot>
    monitor(id: string): Promise<{ node: MonitorValue; peers: MonitorValue }>
    health(): Promise<RuntimeHealthSnapshot>
  }
  logs: {
    list(): Promise<LogList>
    read(name: string, tail?: number): Promise<string>
    clear(): Promise<void>
  }
  themes: {
    /** 服务端存储的全部外部主题（名称 + 完整 CSS），用于列表与预览 */
    list(): Promise<{ name: string; cssText: string }[]>
    read(name: string): Promise<string>
    save(name: string, cssText: string): Promise<void>
    remove(name: string): Promise<void>
  }
  packages: {
    list(): Promise<PackagesInfo>
    install(version: string): Promise<string>
    task(id: string): Promise<TaskView>
    cancelTask(id: string): Promise<TaskView>
    remove(version: string): Promise<void>
    /** 服务端代理测速（HEAD 延迟 + GET 吞吐采样）；native 无此能力 */
    probeMirrors(sources: string[], version: string): Promise<MirrorProbeResult[]>
  }
  settings: {
    get(): Promise<{
      autoStartLastRunning: boolean
      noTun: boolean
      logLevel: string
      coreMirror: string
    }>
    put(
      patch: Partial<{
        autoStartLastRunning: boolean
        noTun: boolean
        logLevel: string
        coreMirror: string
      }>
    ): Promise<void>
  }
  capabilities: Capabilities
}
