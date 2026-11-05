/**
 * 运行态投影：订阅后端 `runtime:snapshot`，把实例集合写入 easytier store。
 *
 * 初始化一次后所有页面共享同一份快照；页面挂载只读取投影，不再各自触发扫描。
 * 浏览器（无 Tauri）不初始化，调用方继续使用 mock 扫描。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useEasyTierStore } from '@/shared/store/easytier'
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

export const useRuntimeStore = defineStore('runtime', () => {
  const available = ref(false)
  const ready = ref(false)
  const snapshot = ref<RuntimeSnapshot>({ ...EMPTY_SNAPSHOT })

  let initTask: Promise<boolean> | null = null
  let catalogKey = ''
  // 应用生命周期内只挂一次监听；dispose 仅用于热重载/测试清理
  let unlisten: UnlistenFn | null = null

  const applySnapshot = (next: RuntimeSnapshot) => {
    snapshot.value = next
    const easyTierStore = useEasyTierStore()
    easyTierStore.setRunningList(next.instances.map(toRunningItem))
  }

  /** 初始化（幂等）：先挂事件监听再拉快照，避免窗口期丢事件 */
  const init = async (): Promise<boolean> => {
    if (initTask) return initTask
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
    // 仅在下发成功后记录，失败时保留旧键以便下次重试
    await setRuntimeCatalog(names)
    catalogKey = key
    return true
  }

  /** 强制扫描并等待结果写回本地投影 */
  const refresh = async (): Promise<void> => {
    if (!available.value) return
    await refreshRuntime()
    applySnapshot(await getRuntimeSnapshot())
  }

  const toRunningList = (): RunningItem[] => snapshot.value.instances.map(toRunningItem)

  const dispose = () => {
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
