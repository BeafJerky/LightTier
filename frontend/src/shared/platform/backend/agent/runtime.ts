/**
 * 运行态快照与监控（Task 9）。
 *
 * 端点：
 * - `GET /api/v1/instances` → `{ instances: InstanceSnapshot[], catalog: string[] }`
 *   （catalog 为配置目录中的全部合法 id，含已停止配置）
 * - `GET /api/v1/instances/{id}/monitor` → `{ node: {stale,data,error?}, peers: {...} }`
 *   两侧已是服务端封装的监控值（采样失败/超时返回上一份数据 + stale）。
 * - `GET /api/v1/instances/health` → `RuntimeHealthSnapshot` 同形（灵动岛按需采样）。
 *
 * 适配器把 HTTP 形状转成 `runtimeApi.RuntimeSnapshot` 同形对象，页面侧的类型与
 * 转换函数（`toRunningItem` / `toRuntimeInstance`）保持不变；轮询由调用方按 3s
 * 节奏驱动（服务端另有 1s 采样缓存兜底）。
 */
import type {
  RuntimeHealthSample,
  RuntimeHealthSnapshot,
  RuntimeInstance,
  RuntimeSnapshot
} from '../../runtimeApi'
import { isApiError, request } from '../http'
import type { Backend, MonitorValue } from '../types'

interface InstanceSnapshotWire {
  id: string
  running?: boolean
  pid?: number | null
  startedAt?: number | null
  rpcPortal?: string | null
  lastExit?: unknown
}

interface InstanceListWire {
  instances?: InstanceSnapshotWire[]
  catalog?: string[]
}

interface MonitorSideWire {
  stale?: boolean
  data?: unknown
  error?: string | null
}

interface MonitorWire {
  node?: MonitorSideWire
  peers?: MonitorSideWire
}

interface HealthSampleWire {
  configFileName?: string
  ok?: boolean
  avgLatencyMs?: number
  lossRate?: number
  peerCount?: number
}

interface HealthWire {
  revision?: number
  sampledAt?: number
  instances?: HealthSampleWire[]
}

/** 客户端单调递增版本号：每次成功拉取快照 +1，页面据此判定是否为新数据 */
let revisionSeq = 0

const instancePath = (id: string): string => `/api/v1/instances/${encodeURIComponent(id)}/monitor`

const isSnapshot = (value: InstanceSnapshotWire | null | undefined): boolean =>
  typeof value?.id === 'string' && value.id.length > 0

const toRuntimeInstance = (snapshot: InstanceSnapshotWire): RuntimeInstance => ({
  configFileName: snapshot.id,
  // 运行态契约沿用配置文件名口径；agent 侧 id 即配置名（不含 .toml）
  fileName: `${snapshot.id}.toml`,
  pid: typeof snapshot.pid === 'number' && Number.isFinite(snapshot.pid) ? snapshot.pid : 0,
  rpcPortal: typeof snapshot.rpcPortal === 'string' ? snapshot.rpcPortal : undefined,
  instanceId: snapshot.id
})

const catalogFrom = (wire: InstanceListWire): string[] => {
  const source = Array.isArray(wire.catalog)
    ? wire.catalog
    : (wire.instances ?? []).map((entry) => entry.id)
  // 去重并保持服务端顺序（服务端已按 id 排序）
  return [...new Set(source.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

const toMonitorValue = (side: MonitorSideWire | null | undefined): MonitorValue | null => {
  if (!side || typeof side !== 'object') return null
  return {
    stale: side.stale === true,
    data: (side.data ?? null) as MonitorValue['data'],
    error: typeof side.error === 'string' ? side.error : null
  }
}

const EMPTY_SIDE: MonitorValue = { stale: true, data: null, error: null }

/** 每个实例最后一次带数据的监控值：HTTP/服务端失败时用它回填 stale 数据 */
const lastNodeValues = new Map<string, MonitorValue>()
const lastPeerValues = new Map<string, MonitorValue>()

const remember = (cache: Map<string, MonitorValue>, id: string, value: MonitorValue): void => {
  if (value.data !== null) cache.set(id, value)
}

const fallbackSide = (
  cache: Map<string, MonitorValue>,
  id: string,
  error: string
): MonitorValue => {
  const previous = cache.get(id)
  return previous ? { ...previous, stale: true, error } : { ...EMPTY_SIDE, stale: true, error }
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const optionalFinite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const isHealthSample = (
  value: HealthSampleWire | null | undefined
): value is HealthSampleWire & { configFileName: string } =>
  typeof value?.configFileName === 'string' && value.configFileName.length > 0

const EMPTY_HEALTH: RuntimeHealthSnapshot = { revision: 0, sampledAt: 0, instances: [] }

export const agentRuntime: Backend['runtime'] = {
  instances: async () => {
    const payload = await request<InstanceListWire>('/api/v1/instances')
    const wire = payload ?? {}
    const snapshots = Array.isArray(wire.instances) ? wire.instances.filter(isSnapshot) : []
    // 服务端 instances 覆盖全部配置（含已停止项，用 running 标记）；
    // 这里的 running === true 过滤是适配器的防御性投影，不是服务端契约保证。
    const instances = snapshots
      .filter((snapshot) => snapshot.running === true)
      .map(toRuntimeInstance)
    const snapshot: RuntimeSnapshot = {
      revision: ++revisionSeq,
      updatedAt: Date.now(),
      instances,
      catalog: catalogFrom(wire)
    }
    return snapshot
  },

  monitor: async (id) => {
    try {
      const payload = await request<MonitorWire>(instancePath(id))
      const node = toMonitorValue(payload?.node) ?? EMPTY_SIDE
      const peers = toMonitorValue(payload?.peers) ?? EMPTY_SIDE
      remember(lastNodeValues, id, node)
      remember(lastPeerValues, id, peers)
      return { node, peers }
    } catch (error) {
      // 401 交给全局会话失效流程；其余失败按“数据过期”返回，监控页展示 stale/空态
      if (isApiError(error) && error.status === 401) throw error
      const message = error instanceof Error ? error.message : String(error)
      return {
        node: fallbackSide(lastNodeValues, id, message),
        peers: fallbackSide(lastPeerValues, id, message)
      }
    }
  },

  health: async () => {
    try {
      const payload = await request<HealthWire>('/api/v1/instances/health')
      const wire = payload ?? {}
      const instances: RuntimeHealthSample[] = (Array.isArray(wire.instances) ? wire.instances : [])
        .filter(isHealthSample)
        .map((item) => ({
          configFileName: item.configFileName,
          ok: item.ok === true,
          avgLatencyMs: optionalFinite(item.avgLatencyMs),
          lossRate: optionalFinite(item.lossRate),
          peerCount: finiteOr(item.peerCount, 0)
        }))
      return {
        revision: finiteOr(wire.revision, 0),
        sampledAt: finiteOr(wire.sampledAt, 0),
        instances
      }
    } catch (error) {
      // 401 交给全局会话失效流程；其余失败返回空快照，调用方静默跳过本轮
      if (isApiError(error) && error.status === 401) throw error
      return { ...EMPTY_HEALTH }
    }
  }
}

/** 仅用于测试隔离：清空监控缓存与版本号（不参与生产逻辑） */
export const __resetAgentRuntimeState = (): void => {
  revisionSeq = 0
  lastNodeValues.clear()
  lastPeerValues.clear()
}
