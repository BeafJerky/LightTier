/**
 * 内核包（Task 10 实现）。
 *
 * 端点：`GET /api/v1/packages`、`POST /api/v1/packages/{version}/install`（202 + taskId）、
 * `GET /api/v1/packages/tasks/{id}`、`POST /api/v1/packages/tasks/{id}/cancel`、
 * `DELETE /api/v1/packages/{version}`。
 * 内置版本不可删除（`builtin: true`），安装由 agent 下载校验，前端只轮询任务。
 *
 * 语义要点：
 * - `installAllowed` 是部署级开关（`LT_CORE_DIR` 覆盖时为 false），缺省按 true
 *   兼容旧 agent；页面必须先看它再决定是否提供安装入口，而不是撞 409；
 * - 安装失败的错误在任务对象里（`state: failed` + `error.code`），HTTP 层仍以
 *   200 返回任务快照；启动前的拒绝（内置/已在装/版本不支持）才抛 ApiError。
 */
import { request } from '../http'
import type { Backend, PackagesInfo, TaskView } from '../types'

const packagePath = (version: string): string => `/api/v1/packages/${encodeURIComponent(version)}`

const taskPath = (id: string): string => `/api/v1/packages/tasks/${encodeURIComponent(id)}`

type PackagesWire = Partial<Omit<PackagesInfo, 'installAllowed'>> & {
  installAllowed?: boolean
}

const normalizeError = (error: unknown): TaskView['error'] => {
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  return {
    code: typeof code === 'string' ? code : 'internal',
    message: typeof message === 'string' ? message : 'install failed'
  }
}

const normalizeTask = (payload: Partial<TaskView>): TaskView => ({
  id: String(payload.id ?? ''),
  version: String(payload.version ?? ''),
  state: String(payload.state ?? 'failed'),
  downloaded: Number(payload.downloaded ?? 0),
  total: payload.total === null || payload.total === undefined ? null : Number(payload.total),
  error: normalizeError(payload.error),
  startedAt: payload.startedAt === undefined ? undefined : Number(payload.startedAt)
})

export const agentPackages: Backend['packages'] = {
  list: async () => {
    const payload = await request<PackagesWire>('/api/v1/packages')
    const installed = Array.isArray(payload?.installed) ? payload.installed : []
    const available = Array.isArray(payload?.available) ? payload.available : []
    return {
      installed: installed.map((item) => ({
        version: String(item.version),
        builtin: item.builtin === true
      })),
      available: available.map((item) => ({
        version: String(item.version),
        channel: item.channel === 'prerelease' ? 'prerelease' : 'stable',
        installed: item.installed === true
      })),
      active: payload?.active ?? null,
      // 缺省视为允许：老 agent 未序列化该字段时不能被误判为只读部署
      installAllowed: payload?.installAllowed !== false
    }
  },

  install: async (version) => {
    const payload = await request<{ taskId?: string }>(`${packagePath(version)}/install`, {
      method: 'POST'
    })
    return String(payload?.taskId ?? '')
  },

  task: async (id) => normalizeTask(await request<Partial<TaskView>>(taskPath(id))),

  cancelTask: async (id) =>
    normalizeTask(await request<Partial<TaskView>>(`${taskPath(id)}/cancel`, { method: 'POST' })),

  remove: async (version) => {
    await request(packagePath(version), { method: 'DELETE' })
  }
}
