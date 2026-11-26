import type { FormWebData } from '@/entities/config/formTypes'
import { backendMode, backendWeb } from '@/shared/platform/backend'
import { useMockData } from './mockData'

let writeQueue: Promise<unknown> = Promise.resolve()
let tomlQueue: Promise<unknown> = Promise.resolve()

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(task, task)
  writeQueue = run.catch(() => {})
  return run
}

const enqueueToml = <T>(task: () => Promise<T>): Promise<T> => {
  const run = tomlQueue.then(task, task)
  tomlQueue = run.catch(() => {})
  return run
}

/** TOML 普通写入与恢复规划/应用共用的轻量串行边界；完整读写组必须在回调内完成 */
export const runTomlTransaction = <T>(transaction: () => Promise<T>): Promise<T> =>
  enqueueToml(transaction)

export interface WebConfigTransactionOps {
  /** 在队列内读取严格快照；读取失败直接抛出，不降级为空表 */
  snapshot: () => Promise<FormWebData[]>
  /** 在队列内覆盖整表；应用与回滚共用，避免回滚绕队列 */
  replace: (list: FormWebData[]) => Promise<void>
}

/** 在共享写队列内执行完整 Web 配置事务，快照、应用与回滚期间其它写入保持等待 */
export const runWebConfigTransaction = async <T>(
  transaction: (ops: WebConfigTransactionOps) => Promise<T>
): Promise<T> =>
  enqueue(async () => {
    // agent：整表由服务端托管，读写都走门面；串行队列语义保持不变
    if (backendMode() === 'agent') {
      return transaction({
        snapshot: () => backendWeb().list(),
        replace: async (list) => {
          await backendWeb().replace(list)
        }
      })
    }
    const { readWebConfigList, writeWebConfigList } = useMockData()
    return transaction({
      snapshot: () => readWebConfigList(),
      replace: (list) => writeWebConfigList(list)
    })
  })

export const mutateWebConfigList = async (
  mutate: (list: FormWebData[]) => void | Promise<void>
): Promise<void> => {
  await runWebConfigTransaction(async ({ snapshot, replace }) => {
    const list = await snapshot()
    await mutate(list)
    await replace(list)
  })
}

export const replaceWebConfigList = async (list: FormWebData[]): Promise<void> => {
  await runWebConfigTransaction(async ({ replace }) => {
    await replace(list)
  })
}
