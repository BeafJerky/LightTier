/**
 * agent HTTP 客户端。
 *
 * 统一约定：
 * - 同源 Cookie 会话（`credentials: 'same-origin'`），默认 15s 超时；
 * - 204 / 205 与空响应体解析为 `undefined`；
 * - 非 2xx 抛出 `ApiError(code, message, status, params)`，payload 取自后端
 *   `{"error":{"code","message","params"}}`，缺失时 code 退化为 `http_<status>`；
 * - 401 触发 `onUnauthorized`，428 触发 `onSetupRequired`（本任务只登记回调，
 *   跳转由 Task 7 注册）；登录 / 会话来这类“401 属于预期结果”的调用用
 *   `silentAuth` 抑制 401 通知，428 仍然照常通知。
 */

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** 查询参数；`null` / `undefined` 会被省略 */
  query?: Record<string, QueryValue>
  /** JSON 请求体（自动序列化并带 content-type） */
  body?: unknown
  /** 调用方信号；缺省时使用 15s 超时信号 */
  signal?: AbortSignal
  /** 响应体按纯文本读取（日志端点 text/plain），默认按 JSON 解析 */
  text?: boolean
  /** 覆盖默认 15s 超时 */
  timeoutMs?: number
  /**
   * 抑制本次调用的 401 `onUnauthorized` 通知。
   *
   * 用于 401 是预期结果的调用：登录密码错误、setup 令牌无效、`GET /auth/session`
   * 的“未登录”信号。428 `onSetupRequired` 不受此开关影响——它表示实例尚未初始化，
   * 与本次调用的会话状态无关，仍需通知页面跳转初始化页。
   */
  silentAuth?: boolean
}

export const DEFAULT_TIMEOUT_MS = 15000

/** 后端标准错误对象；`status` 便于页面按 404 / 409 / 428 分支 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  /** 后端 `error.params`（端口占用 `{port, owner}`、限流 `{seconds}` 等），无则为 undefined */
  readonly params: Record<string, unknown> | undefined

  constructor(code: string, message: string, status: number, params?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.params = params
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError

type Handler = () => void

let unauthorizedHandler: Handler | null = null
let setupRequiredHandler: Handler | null = null

/**
 * 注册 401 处理器（会话失效）；返回注销函数，重复注册以最后一次为准。
 * 本任务不在这里跳转路由，Task 7 在启动时注册。
 */
export const onUnauthorized = (handler: Handler): (() => void) => {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

/** 注册 428 处理器（尚未初始化）；返回注销函数 */
export const onSetupRequired = (handler: Handler): (() => void) => {
  setupRequiredHandler = handler
  return () => {
    if (setupRequiredHandler === handler) setupRequiredHandler = null
  }
}

const notify = (handler: Handler | null): void => {
  if (!handler) return
  try {
    handler()
  } catch (cause) {
    // 回调异常不能掩盖原始 HTTP 错误
    console.error('backend handler failed:', cause)
  }
}

const buildUrl = (path: string, query?: Record<string, QueryValue>): string => {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

const readErrorBody = async (
  response: Response
): Promise<{ code: string; message: string; params?: Record<string, unknown> }> => {
  const fallback = {
    code: `http_${response.status}`,
    message: response.statusText || `request failed with status ${response.status}`
  }
  try {
    const raw = await response.text()
    if (!raw.trim()) return fallback
    const parsed = JSON.parse(raw) as {
      error?: { code?: unknown; message?: unknown; params?: unknown }
    }
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : fallback.code
    const message =
      typeof parsed.error?.message === 'string' ? parsed.error.message : fallback.message
    const rawParams = parsed.error?.params
    const params =
      rawParams !== null && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? (rawParams as Record<string, unknown>)
        : undefined
    return { code, message, params }
  } catch {
    return fallback
  }
}

const toApiError = async (response: Response, silentAuth = false): Promise<ApiError> => {
  const { code, message, params } = await readErrorBody(response)
  // 428 表示实例尚未初始化，与会话失效无关，即使 silentAuth 也要通知
  if (response.status === 401 && !silentAuth) notify(unauthorizedHandler)
  if (response.status === 428) notify(setupRequiredHandler)
  return new ApiError(code, message, response.status, params)
}

/**
 * 发起一次 agent API 请求。
 *
 * @example
 * const meta = await request<Meta>('/api/v1/meta')
 * await request('/api/v1/auth/login', { method: 'POST', body: { password } })
 * const text = await request<string>('/api/v1/logs/agent/agent.log', { text: true })
 */
export const request = async <T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const { method = 'GET', query, body, text = false } = options
  const headers: Record<string, string> = {}
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers,
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const response = await fetch(buildUrl(path, query), init)

  if (response.status === 204 || response.status === 205) return undefined as T
  if (!response.ok) throw await toApiError(response, options.silentAuth)
  if (text) return (await response.text()) as T

  // 200 也可能是空体（例如 200 + 空 JSON），按 undefined 处理而不是抛解析错误
  const raw = await response.text()
  if (!raw.trim()) return undefined as T
  return JSON.parse(raw) as T
}
