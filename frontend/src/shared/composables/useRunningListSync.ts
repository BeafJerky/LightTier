/**
 * 内核运行列表同步
 *
 * 总览 / 配置管理 / 监控页共用同一条链路：读取当前配置名 → coreApi 扫描运行实例
 * → 写回 store。扫描失败时保留上一份状态：浏览器 Mock 环境静默，真实环境留诊断日志。
 */
import { useEasyTierStore } from '@/shared/store/easytier'
import * as coreApi from '@/shared/platform/coreApi'
import { isTauri } from '@tauri-apps/api/core'

export interface RunningListSyncOptions {
  /** 自定义失败处理（缺省：Tauri 环境 warn，浏览器静默） */
  onError?: (error: unknown) => void
}

export function useRunningListSync(options: RunningListSyncOptions = {}) {
  const easyTierStore = useEasyTierStore()

  const updateRunningList = async (): Promise<void> => {
    try {
      const names = easyTierStore.configList.map((c) => c.configFileName)
      const newList = await coreApi.getRunningList(names)
      easyTierStore.setRunningList(newList)
    } catch (e) {
      if (options.onError) options.onError(e)
      else if (isTauri()) console.warn('[RunningList] 运行态扫描失败，保留上一份状态:', e)
    }
  }

  return { updateRunningList }
}
