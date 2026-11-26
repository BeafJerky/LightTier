/**
 * 日志（Task 10 实现）。
 *
 * 端点：`GET /api/v1/logs`（JSON 清单）、`GET /api/v1/logs/{*name}?tail=N`
 * （`text/plain`，用 `request(..., { text: true })` 读取）、`DELETE /api/v1/logs`。
 * agent 模式不提供“打开目录”（`capabilities.logs` 仅覆盖读取与清空）。
 *
 * 读取名由清单原样拼出：agent 文件为裸文件名（`agent.log`、`audit.log`、
 * `agent.log.<date>`），内核日志为 `core/<id>/<file>`。名称逐段编码但保留
 * 分隔符，服务端 `parse_name` 只接受这两类形状。
 */
import { request } from '../http'
import type { Backend, LogList } from '../types'

/** 逐段 `encodeURIComponent`，保留 `/` 以匹配 `core/<id>/<file>` 通配路由 */
const encodeLogName = (name: string): string =>
  name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

export const agentLogs: Backend['logs'] = {
  list: async () => {
    const payload = await request<Partial<LogList>>('/api/v1/logs')
    return {
      agent: Array.isArray(payload?.agent) ? payload.agent : [],
      core: Array.isArray(payload?.core)
        ? payload.core.map((group) => ({
            id: group.id,
            files: Array.isArray(group.files) ? group.files : []
          }))
        : []
    }
  },

  // 缺省 tail 由服务端按 400 行处理；显式传入时服务端再夹到 1..=2000
  read: (name, tail) =>
    request<string>(`/api/v1/logs/${encodeLogName(name)}`, {
      query: { tail },
      text: true
    }),

  clear: async () => {
    await request('/api/v1/logs', { method: 'DELETE' })
  }
}
