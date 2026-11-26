/**
 * agent 设置（Task 10 实现）。
 *
 * 端点：`GET|PUT /api/v1/settings`，字段 `autoStartLastRunning` / `noTun` / `logLevel`。
 * `PUT` 为部分更新：只发送调用方改动的字段，服务端返回完整设置；这里丢弃响应体，
 * 调用方按需重新 `get()`（对应原生路径“写本地后立即生效”的语义）。
 */
import { request } from '../http'
import type { Backend } from '../types'

type SettingsWire = {
  autoStartLastRunning?: unknown
  noTun?: unknown
  logLevel?: unknown
}

export type AgentSettings = Awaited<ReturnType<Backend['settings']['get']>>

const normalize = (payload: SettingsWire | undefined): AgentSettings => ({
  autoStartLastRunning: payload?.autoStartLastRunning === true,
  noTun: payload?.noTun === true,
  logLevel: typeof payload?.logLevel === 'string' && payload.logLevel ? payload.logLevel : 'info'
})

export const agentSettings: Backend['settings'] = {
  get: async () => normalize(await request<SettingsWire>('/api/v1/settings')),

  put: async (patch) => {
    const body: SettingsWire = {}
    if (patch.autoStartLastRunning !== undefined) {
      body.autoStartLastRunning = patch.autoStartLastRunning
    }
    if (patch.noTun !== undefined) body.noTun = patch.noTun
    if (patch.logLevel !== undefined) body.logLevel = patch.logLevel
    await request('/api/v1/settings', { method: 'PUT', body })
  }
}
