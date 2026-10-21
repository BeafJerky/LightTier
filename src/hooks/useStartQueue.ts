import { computed, ref } from 'vue'
import { useEasyTierStore } from '@/store/modules/easytier'

/**
 * 并发启动串行队列
 *
 * 多个配置排队逐个启动：避免端口抢占与资源争用（规避原项目
 * v3.4.0-pre “同时运行多个配置无法启动成功”的已知问题）。
 * - 队列状态存 store.startQueue（含执行中项），UI 据此渲染 `⟳ 排队中 n`；
 * - 每个入队项保留自己的 executor（闭包内的配置名/自动运行语义互不串用）；
 * - 单次执行失败不阻塞剩余队列，由调用方在 executor 内完成回滚与提示。
 */
export function useStartQueue() {
  const easyTierStore = useEasyTierStore()
  // 队列是否正在执行（组件内只保留一个队列实例）
  const isStarting = ref(false)
  // 当前正在启动的配置文件名（含 .toml 后缀），用于 UI 提示
  const runningFileName = ref('')
  // 文件名 → 本次入队的执行体（同一文件重复入队时复用首个）
  const tasks = new Map<string, (name: string) => Promise<void>>()

  const queueLength = computed(() => easyTierStore.startQueue.length)
  const isQueued = computed(() => isStarting.value || queueLength.value > 0)

  /**
   * 入队并启动
   * @param fileName 配置文件名（含 .toml）
   * @param executor 单次启动执行体：切换失败时抛出异常，队列跳过该配置继续
   * @returns 队列空闲时返回本次 drain 的 Promise，便于调用方等待自动运行完成
   */
  const enqueue = (fileName: string, executor: (name: string) => Promise<void>): Promise<void> => {
    if (easyTierStore.startQueue.includes(fileName)) return Promise.resolve()
    tasks.set(fileName, executor)
    easyTierStore.setStartQueue([...easyTierStore.startQueue, fileName])
    if (!isStarting.value) return drain()
    return Promise.resolve()
  }

  const drain = async (): Promise<void> => {
    isStarting.value = true
    try {
      while (easyTierStore.startQueue.length > 0) {
        const fileName = easyTierStore.startQueue[0]
        runningFileName.value = fileName
        const executor = tasks.get(fileName)
        tasks.delete(fileName)
        try {
          // 刷新后残留的幽灵队列项没有执行体，直接跳过
          if (executor) await executor(fileName)
        } catch {
          // 单次失败已在 executor 内反馈，不阻塞剩余队列
        }
        easyTierStore.setStartQueue(easyTierStore.startQueue.slice(1))
      }
    } finally {
      isStarting.value = false
      runningFileName.value = ''
      // 防御：executor 异常逃逸时兜底清空
      if (easyTierStore.startQueue.length > 0) {
        easyTierStore.setStartQueue([])
        tasks.clear()
      }
    }
  }

  return { isStarting, runningFileName, queueLength, isQueued, enqueue }
}
