/**
 * 配置能力（Task 8）。
 *
 * 端点：`GET /api/v1/configs`、`GET|PUT|DELETE /api/v1/configs/{id}`、
 * `POST /api/v1/configs/{id}/rename`、`POST /api/v1/configs/import`、
 * `GET /api/v1/configs/{id}/export`。
 *
 * 契约要点：
 * - id 是服务端配置名（不含 `.toml`），允许字符有限，路径仍统一编码；
 * - `PUT` 在调用方提供基线 hash 时必带 `expectedHash`，409 `conflict_hash` 原样抛出，
 *   由页面提示“配置已被修改，请刷新后重试”；
 * - 所有请求都是同源 Cookie 会话，401 交给全局会话失效流程（不做 silentAuth）。
 */
import { request } from '../http'
import type { Backend, ConfigMeta } from '../types'

type ConfigListWire = { configs?: ConfigMeta[] }

const configPath = (id: string): string => `/api/v1/configs/${encodeURIComponent(id)}`

export const agentConfigs: Backend['configs'] = {
  list: async () => {
    const payload = await request<ConfigListWire>('/api/v1/configs')
    return Array.isArray(payload?.configs) ? payload.configs : []
  },

  read: (id) => request<{ toml: string; hash: string }>(configPath(id)),

  write: async (id, toml, expectedHash) => {
    const body: { toml: string; expectedHash?: string } = { toml }
    // 只有调用方读到过基线 hash 才做乐观并发校验；新增配置不带 expectedHash
    if (expectedHash) body.expectedHash = expectedHash
    const result = await request<{ id: string; hash: string }>(configPath(id), {
      method: 'PUT',
      body
    })
    return result.hash
  },

  remove: async (id) => {
    await request(configPath(id), { method: 'DELETE' })
  },

  // 服务端以 `to` 作为新 id（见 config_routes::rename），门面契约保持 void；
  // 需要新 id 的调用方已知目标名，无需回读。
  rename: async (id, to) => {
    await request(`${configPath(id)}/rename`, { method: 'POST', body: { to } })
  },

  importToml: async (filename, toml) => {
    const entry = await request<ConfigMeta>('/api/v1/configs/import', {
      method: 'POST',
      body: { filename, toml }
    })
    return entry.id
  },

  exportToml: (id) => request<{ filename: string; toml: string }>(`${configPath(id)}/export`)
}
