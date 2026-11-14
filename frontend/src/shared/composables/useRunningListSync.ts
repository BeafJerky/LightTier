/**
 * 内核运行列表同步
 *
 * Tauri（桌面/Android）：读取后端运行态快照（`lighttier-runtime` 单例扫描），
 * 仅在配置清单变化或显式强制刷新时触发一次扫描；页面挂载本身不再扫描。
 * 浏览器 Mock：沿用 coreApi mock 扫描。
 * 扫描失败时保留上一份状态：真实环境留诊断日志，浏览器静默。
 */
import { useEasyTierStore } from '@/shared/store/easytier'
import * as coreApi from '@/shared/platform/coreApi'
import { isTauri } from '@tauri-apps/api/core'

export interface RunningListSyncOptions {
  /** 自定义失败处理（缺省：Tauri 环境 warn，浏览器静默） */
  onError?: (error: unknown) => void
  /** 每次成功写回运行列表后调用 */
  onSuccess?: () => void
}

export interface RunningListSyncRequest {
  /** 启动/停止实例后强制重扫，避免等待后端扫描周期 */
  force?: boolean
}

export function useRunningListSync(options: RunningListSyncOptions = {}) {
  const easyTierStore = useEasyTierStore()

  const handleError = (error: unknown) => {
    if (options.onError) options.onError(error)
    else if (isTauri()) console.warn('[RunningList] 运行态扫描失败，保留上一份状态:', error)
  }

  const updateRunningList = async (request: RunningListSyncRequest = {}): Promise<void> => {
    const names = easyTierStore.configList.map((c) => c.configFileName)

    if (isTauri()) {
      const { useRuntimeStore } = await import('@/shared/store/runtime')
      const runtime = useRuntimeStore()
      try {
        if (await runtime.init()) {
          const changed = await runtime.syncCatalog(names)
          if (changed || request.force) await runtime.refresh()
          else easyTierStore.setRunningList(runtime.toRunningList())
          options.onSuccess?.()
          return
        }
      } catch (error) {
        handleError(error)
      }
    }

    try {
      const newList = await coreApi.getRunningList(names)
      easyTierStore.setRunningList(newList)
      options.onSuccess?.()
    } catch (error) {
      handleError(error)
    }
  }

  return { updateRunningList }
}
