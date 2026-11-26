/**
 * 实例启停（Task 9）。
 *
 * 端点：`POST /api/v1/instances/{id}/start|stop|restart`，成功返回实例快照。
 * 快照本身由运行态查询统一读取，适配器只等待动作完成，避免页面同时维护两份状态。
 * 错误码 `instance_running` / `instance_not_running` / `core_missing` / `port_in_use`
 * 原样抛出 `ApiError`，由页面映射为现有 toast 文案。
 */
import { request } from '../http'
import type { Backend } from '../types'

type InstanceVerb = 'start' | 'stop' | 'restart'

const instancePath = (id: string, verb: InstanceVerb): string =>
  `/api/v1/instances/${encodeURIComponent(id)}/${verb}`

const act = async (id: string, verb: InstanceVerb): Promise<void> => {
  await request(instancePath(id, verb), { method: 'POST' })
}

export const agentRunner: Backend['runner'] = {
  start: (id) => act(id, 'start'),
  stop: (id) => act(id, 'stop'),
  restart: (id) => act(id, 'restart')
}
