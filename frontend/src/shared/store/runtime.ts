/**
 * 运行态投影：把运行中实例集合写入 easytier store。
 *
 * - native（Tauri 桌面 / Android）：订阅后端 `runtime:snapshot` 事件，初始化一次后
 *   所有页面共享同一份快照；
 * - agent（HTTP 后端）：同一投影改为 3 秒轮询 `GET /instances`（服务端 1s 缓存兜底），
 *   页面挂载仍然只读投影；`dispose()` 负责清理定时器；
 * - 浏览器 Mock：不初始化，调用方继续使用 mock 扫描。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useEasyTierStore } from '@/shared/store/easytier'
import { backendMode, backendRuntime } from '@/shared/platform/backend'
import {
  getRuntimeSnapshot,
  onRuntimeSnapshot,
  refreshRuntime,
  runtimeAvailable,
  setRuntimeCatalog,
  toRunningItem,
  type RuntimeSnapshot
} from '@/shared/platform/runtimeApi'

const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  revision: 0,
  updatedAt: 0,
  instances: [],
  catalog: []
}

/** agent 运行态轮询间隔（与页面监控轮询一致） */
const AGENT_POLL_MS = 3000

export const useRuntimeStore = defineStore('runtime', () => {
  const available = ref(false)
  const ready = ref(false)
  const snapshot = ref<RuntimeSnapshot>({ ...EMPTY_SNAPSHOT })

  let initTask: Promise<boolean> | null = null
  let catalogKey = ''
  // 应用生命周期内只挂一次监听；dispose 仅用于热重载/测试清理
  let unlisten: UnlistenFn | null = null
  let agentTimer: ReturnType<typeof setInterval> | null = null

  const isAgentMode = (): boolean => backendMode() === 'agent'

  const applySnapshot = (next: RuntimeSnapshot) => {
    snapshot.value = next
    const easyTierStore = useEasyTierStore()
    easyTierStore.setRunningList(next.instances.map(toRunningItem))
  }

  const fetchAgentSnapshot = (): Promise<RuntimeSnapshot> => backendRuntime().instances()

  const stopAgentPolling = () => {
    if (agentTimer) {
      clearInterval(agentTimer)
      agentTimer = null
    }
  }

  /** agent：3 秒轮询运行态；失败保留上一份投影，不打断页面 */
  const startAgentPolling = () => {
    if (agentTimer) return
    agentTimer = setInterval(() => {
      void fetchAgentSnapshot()
        .then(applySnapshot)
        .catch((e) => {
          console.warn('[runtime] agent 运行态轮询失败，保留上一份状态:', e)
        })
    }, AGENT_POLL_MS)
  }

  /** 初始化（幂等）：先挂事件监听再拉快照，避免窗口期丢事件 */
  const init = async (): Promise<boolean> => {
    if (initTask) return initTask
    if (isAgentMode()) {
      initTask = (async () => {
        try {
          applySnapshot(await fetchAgentSnapshot())
          available.value = true
          startAgentPolling()
          return true
        } catch (e) {
          console.warn('[runtime] agent 运行态不可用，保留前端扫描结果:', e)
          // 允许下次挂载重试，不把一次瞬时失败固化为永久降级
          initTask = null
          return false
        } finally {
          ready.value = true
        }
      })()
      return initTask
    }
    if (!runtimeAvailable()) {
      ready.value = true
      return false
    }
    initTask = (async () => {
      try {
        unlisten = await onRuntimeSnapshot(applySnapshot)
        applySnapshot(await getRuntimeSnapshot())
        available.value = true
        return true
      } catch (e) {
        console.warn('[runtime] 后端运行态服务不可用，回退前端扫描:', e)
        // 清理半成品监听并允许下次挂载重试，避免一次瞬时失败永久降级为前端扫描
        unlisten?.()
        unlisten = null
        initTask = null
        return false
      } finally {
        ready.value = true
      }
    })()
    return initTask
  }

  /** 同步配置目录清单；清单变化时后端立即重扫，返回是否发生了变更 */
  const syncCatalog = async (names: string[]): Promise<boolean> => {
    const key = [...names].sort().join('|')
    if (key === catalogKey) return false
    if (isAgentMode()) {
      // agent 的 catalog 随 GET /instances 下发；这里只记录变化，由调用方 refresh
      catalogKey = key
      return true
    }
    // 仅在下发成功后记录，失败时保留旧键以便下次重试
    await setRuntimeCatalog(names)
    catalogKey = key
    return true
  }

  /** 强制扫描并等待结果写回本地投影 */
  const refresh = async (): Promise<void> => {
    if (!available.value) return
    if (isAgentMode()) {
      applySnapshot(await fetchAgentSnapshot())
      return
    }
    await refreshRuntime()
    applySnapshot(await getRuntimeSnapshot())
  }

  const toRunningList = (): RunningItem[] => snapshot.value.instances.map(toRunningItem)

  const dispose = () => {
    stopAgentPolling()
    unlisten?.()
    unlisten = null
  }

  return {
    available,
    ready,
    snapshot,
    init,
    syncCatalog,
    refresh,
    toRunningList,
    dispose
  }
})
