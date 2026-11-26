/**
 * 鉴权与元信息（Task 7 的登录 / 初始化页依赖这些调用）。
 *
 * 端点：
 * - `GET  /api/v1/meta`           免鉴权
 * - `GET  /api/v1/auth/session`   已登录返回 `{ authenticated: true }`，未登录 401
 * - `POST /api/v1/auth/login`     body `{ password }`
 * - `POST /api/v1/auth/setup`     body `{ token, password }` → 204
 * - `POST /api/v1/auth/logout`    → 204
 * - `POST /api/v1/auth/password`  body `{ password }` → 204（成功后服务端清空全部会话）
 */
import { request } from '../http'
import type { Backend, Meta, Session } from '../types'

type MetaWire = Omit<Meta, 'apiVersion'> & { apiVersion: number | string }

/**
 * 后端 `/meta` 的 `apiVersion` 目前序列化为字符串 `"1"`，而门面契约为 number。
 * 在适配层归一，页面按数字比较最低兼容版本（后端改为数字后此处自动兼容）。
 */
const normalizeMeta = (wire: MetaWire): Meta => {
  const parsed =
    typeof wire.apiVersion === 'number' ? wire.apiVersion : Number.parseInt(wire.apiVersion, 10)
  return { ...wire, apiVersion: Number.isFinite(parsed) ? parsed : 0 }
}

export const agentAuth: Backend['auth'] = {
  meta: async () => normalizeMeta(await request<MetaWire>('/api/v1/meta')),
  // session 的 401 是“尚未登录”的正常信号，不该触发全局会话失效跳转
  session: () => request<Session>('/api/v1/auth/session', { silentAuth: true }),
  login: async (pw) => {
    // 密码错误同样返回 401，但不能触发全局会话失效跳转
    await request('/api/v1/auth/login', {
      method: 'POST',
      body: { password: pw },
      silentAuth: true
    })
  },
  setup: async (token, pw) => {
    // setup 令牌无效 / 已初始化属于表单级错误，同样按 silentAuth 处理
    await request('/api/v1/auth/setup', {
      method: 'POST',
      body: { token, password: pw },
      silentAuth: true
    })
  },
  logout: async () => {
    await request('/api/v1/auth/logout', { method: 'POST' })
  },
  changePassword: async (password) => {
    // 新密码不合规（auth_invalid）属表单级错误，按 silentAuth 抑制全局 401 跳转；
    // 会话失效（auth_required）由调用方按错误码自行处理
    await request('/api/v1/auth/password', {
      method: 'POST',
      body: { password },
      silentAuth: true
    })
  }
}
