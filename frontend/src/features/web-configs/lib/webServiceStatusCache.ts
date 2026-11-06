export const WEB_SERVICE_STATUS_TTL_MS = 60_000

export interface CachedWebServiceStatus {
  status: string
  at: number
}

export interface ResolveWebServiceStatusesOptions {
  /** 服务安装/启停后强制重新检测，忽略 TTL 缓存 */
  force?: boolean
  ttl?: number
  now?: () => number
  /** 同时进行的检测上限：每次检测都会拉起系统查询，避免配置多时瞬时爆发 */
  concurrency?: number
  /** 测试可注入独立缓存；生产使用模块级缓存，跨页面挂载复用 */
  cache?: Map<string, CachedWebServiceStatus>
}

const DEFAULT_CONCURRENCY = 3

const sharedCache = new Map<string, CachedWebServiceStatus>()

/**
 * 先回传 TTL 内的缓存，再限流并发检测缺失/过期项。
 * 不等待检测完成即可返回，调用方可先渲染列表。
 */
export const resolveWebServiceStatuses = async (
  names: readonly string[],
  load: (name: string) => Promise<string>,
  onUpdate: (name: string, status: string) => void,
  options: ResolveWebServiceStatusesOptions = {}
): Promise<void> => {
  const ttl = options.ttl ?? WEB_SERVICE_STATUS_TTL_MS
  const now = options.now ?? Date.now
  const cache = options.cache ?? sharedCache

  const pending: string[] = []
  for (const name of names) {
    if (!options.force) {
      const cached = cache.get(name)
      if (cached && now() - cached.at < ttl) {
        onUpdate(name, cached.status)
        continue
      }
    }
    pending.push(name)
  }

  const queue = [...pending]
  const limit = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY))
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      try {
        const status = await load(name)
        cache.set(name, { status, at: now() })
        onUpdate(name, status)
      } catch {
        // 检测失败不缓存：下次进入页面重试，而不是整个 TTL 内一直显示失败
        onUpdate(name, 'unknown')
      }
    }
  })
  await Promise.all(workers)
}
