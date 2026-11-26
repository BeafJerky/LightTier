/**
 * Web 配置能力（连接远程 config-server 的客户端进程）。
 *
 * 端点：`GET|PUT /api/v1/web-configs`、`POST /api/v1/web-configs/{configFileName}/start|stop`。
 *
 * 契约要点：
 * - 整表读写用 `{ items: [...] }` 包裹；`GET` 结果可直接 `PUT` 回去，
 *   `status` / `pid` 由服务端忽略，运行态永远以服务端返回为准；
 * - `status` 只可能是 `running` / `notRunning`，`runningService` 是 Windows 服务专用；
 * - `configFileName` 允许空格等字符，路径参数统一编码；
 * - 启停幂等（已在目标状态仍返回 204），失败错误码由调用方按通用文案提示。
 */
import type { FormWebData } from '@/entities/config/formTypes'
import { request } from '../http'
import type { Backend } from '../types'

type WebConfigListWire = { items?: FormWebData[] }

const webConfigPath = (configFileName: string): string =>
  `/api/v1/web-configs/${encodeURIComponent(configFileName)}`

export const agentWeb: Backend['web'] = {
  list: async () => {
    const payload = await request<WebConfigListWire>('/api/v1/web-configs')
    return Array.isArray(payload?.items) ? payload.items : []
  },

  // 整表替换可能先停掉被删除/改地址的运行记录（SIGTERM 5s + SIGKILL 2s），放宽超时
  replace: async (items) => {
    const payload = await request<WebConfigListWire>('/api/v1/web-configs', {
      method: 'PUT',
      body: { items },
      timeoutMs: 30000
    })
    return Array.isArray(payload?.items) ? payload.items : []
  },

  start: async (configFileName) => {
    await request(`${webConfigPath(configFileName)}/start`, { method: 'POST' })
  },

  stop: async (configFileName) => {
    await request(`${webConfigPath(configFileName)}/stop`, { method: 'POST' })
  }
}
