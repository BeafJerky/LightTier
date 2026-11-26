/**
 * 后台门面入口。
 *
 * - `initBackend()`：启动期调用一次（memoized），完成模式判定并装配适配器；
 * - `backendMode()`：同步读取判定结果，页面据此决定是否走 agent 分支；
 * - `backend()` / `backendAuth()` 等：按能力取适配器，非 agent 调用点保持原代码路径。
 *
 * 模块加载期不发起任何请求；未初始化时 `backendMode()` 返回 `native`，
 * `backend()` 明确抛错（避免 agent 模式静默拿到原生桩实现）。
 */
import { createAgentBackend } from './agent'
import { detectBackendMode, type BackendMode } from './mode'
import { createNativeBackend } from './native'
import type { Backend } from './types'

let mode: BackendMode | null = null
let current: Backend | null = null
let initPromise: Promise<BackendMode> | null = null

/**
 * 判定运行模式并装配后端；重复调用返回同一个 Promise（幂等）。
 * 离线（`offline`）时仍装配 native 适配器占位，由调用方切换到离线页。
 *
 * 门面导出的 `resolveBackendMode` 就是本函数（见文件末尾），保证任何调用方
 * 拿到的都是“只探测一次”的 memoized 版本，避免重复打 `/meta`。
 */
export const initBackend = (): Promise<BackendMode> => {
  if (!initPromise) {
    initPromise = detectBackendMode().then((resolved) => {
      mode = resolved
      current = resolved === 'agent' ? createAgentBackend() : createNativeBackend()
      return resolved
    })
  }
  return initPromise
}

/** 当前模式；`initBackend()` 完成前为 `native` */
export const backendMode = (): BackendMode => mode ?? 'native'

/**
 * 当前后端适配器（agent 模式为 HTTP 实现，其余为原生适配器）。
 *
 * 必须在 `initBackend()` 之后调用：初始化前无法同步得知是否为 agent 模式，
 * 若返回原生占位，agent 模式下的调用方会静默拿到桌面桩实现。这里明确抛错，
 * 让“忘了 await 初始化”的问题在开发期立刻暴露（native / mock 页面不走门面）。
 */
export const backend = (): Backend => {
  if (!current) {
    throw new Error(
      'backend() called before initBackend(); await initBackend() during app bootstrap first'
    )
  }
  return current
}

export const backendAuth = (): Backend['auth'] => backend().auth
export const backendConfigs = (): Backend['configs'] => backend().configs
export const backendRunner = (): Backend['runner'] => backend().runner
export const backendRuntime = (): Backend['runtime'] => backend().runtime
export const backendLogs = (): Backend['logs'] => backend().logs
export const backendPackages = (): Backend['packages'] => backend().packages
export const backendSettings = (): Backend['settings'] => backend().settings
export const backendThemes = (): Backend['themes'] => backend().themes
export const backendCapabilities = (): Backend['capabilities'] => backend().capabilities

export * from './types'
export { ApiError, isApiError, onSetupRequired, onUnauthorized, request } from './http'
export { agentCodeI18n, agentErrorI18n } from './errors'
export type { AgentErrorI18n } from './errors'
export type { RequestOptions } from './http'
/** 门面唯一入口：等同 `initBackend()`，调用方无法绕过 memoization 重复探测 */
export const resolveBackendMode = initBackend
export type { BackendMode } from './mode'
