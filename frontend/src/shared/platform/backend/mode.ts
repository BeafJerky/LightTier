/**
 * 运行模式判定（启动期唯一一次，模块加载期不发请求）。
 *
 * 顺序（不可调整）：
 * 1. Tauri / Android → `native`，零 HTTP 探测；
 * 2. 浏览器 DEV 且 URL 未带 `?agent=1` → `mock`，零 HTTP 探测（`pnpm dev` 行为不变）；
 * 3. 其余（DEV + `?agent=1` 或生产浏览器）→ 探测 `GET /api/v1/meta`（3s 超时），
 *    可达为 `agent`，不可达为 `offline`（绝不回退 Mock）。
 */
import { isTauri } from '@tauri-apps/api/core'

export type BackendMode = 'native' | 'mock' | 'agent' | 'offline'

/** agent 模式探测端点：免鉴权，仅返回版本与能力位 */
export const META_PROBE_PATH = '/api/v1/meta'

/** 探测超时（毫秒）；导出以便单测锁定 3s 契约 */
export const META_PROBE_TIMEOUT_MS = 3000

/**
 * 探测成功时保留的 `features` 快照：能力位只来自服务端一次真实响应，
 * 前端不另写一份会在版本漂移后说谎的常量表。
 */
let probedFeatures: Record<string, unknown> | null = null

export const agentFeatures = (): Record<string, unknown> | null => probedFeatures

const isTauriRuntime = (): boolean => {
  try {
    return isTauri()
  } catch {
    return false
  }
}

const isAgentRequested = (): boolean => {
  // 门面可能在无 DOM 的单测 / SSR 环境被导入，这里只读不探测
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).get('agent') === '1'
}

/**
 * 校验探测响应体确实是 agent 的 `/meta`。
 *
 * 只看 `response.ok` 不够：SPA 静态托管下任何未知路径都可能回落到
 * `index.html`（200 + HTML），把页面冒充 agent。因此要求 JSON 对象、
 * 数值型 `apiVersion`（兼容后端当前序列化的字符串 `"1"`，按数字归一）
 * 与 `features` 对象同时存在。
 */
const isMetaPayload = (payload: unknown): boolean => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const { apiVersion, features } = payload as Record<string, unknown>
  const version =
    typeof apiVersion === 'number'
      ? apiVersion
      : typeof apiVersion === 'string' && /^\d+$/.test(apiVersion.trim())
        ? Number(apiVersion.trim())
        : Number.NaN
  if (!Number.isFinite(version)) return false
  return features !== null && typeof features === 'object' && !Array.isArray(features)
}

/**
 * 探测 agent 是否可达。
 *
 * 必须校验 `ok`：Vite dev 代理在后端未启动时返回 500 而不是网络错误，
 * 只看“fetch 是否抛错”会把代理错误页误判为 agent；响应体再按 `isMetaPayload`
 * 校验，排除 SPA `index.html` 回落。
 */
const probeAgent = async (): Promise<boolean> => {
  try {
    const response = await fetch(META_PROBE_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(META_PROBE_TIMEOUT_MS)
    })
    if (!response.ok) return false
    const payload: unknown = await response.json()
    if (!isMetaPayload(payload)) return false
    probedFeatures = (payload as { features: Record<string, unknown> }).features
    return true
  } catch {
    return false
  }
}

export const detectBackendMode = async (): Promise<BackendMode> => {
  if (isTauriRuntime()) return 'native'
  if (import.meta.env.DEV && !isAgentRequested()) return 'mock'
  return (await probeAgent()) ? 'agent' : 'offline'
}
