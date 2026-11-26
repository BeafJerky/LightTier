/**
 * native 适配器（Tauri 桌面 / Android / 浏览器 Mock）。
 *
 * 说明：页面目前只在 agent 模式下经门面取数；native / mock 继续走各自原有代码路径。
 * 因此这里只把签名能一一对应的调用委托给既有模块（`coreApi`、`runtimeApi`），
 * 其余能力明确抛错而不是伪造返回结构——任何非 agent 调用点一旦误用都会立刻暴露，
 * 不会静默改变桌面行为。
 *
 * 委托模块用动态 import：`coreApi` / `runtimeApi` 会连带加载 Tauri 文件/日志模块
 * （`fileUtil` 在模块加载期调用 `attachConsole()`）。门面被页面（store / 组合式函数）
 * 静态引用时，不能让这些副作用进入只做模式判定与 agent 配置访问的调用链。
 */
import type { Backend, Meta } from './types'

/** 返回 rejected Promise（而不是同步 throw），调用方可以统一按异步错误处理 */
const unsupported = (method: string): Promise<never> =>
  Promise.reject(new Error(`native backend: ${method} is not part of the desktop data path`))

/**
 * 桌面 / Android / Mock 的静态元信息。
 *
 * 共享守卫会按“session → meta”顺序调用，任何一步 reject 都会让桌面误入
 * agent 错误路径，因此 `meta()` 必须永远成功：原生端天然已初始化、TUN 可用，
 * 能力位全部为 true，内核版本列表为空（由既有内核管理模块负责）。
 */
const NATIVE_META: Meta = {
  apiVersion: 1,
  agentVersion: 'native',
  setupRequired: false,
  tunAvailable: true,
  features: {
    routes: true,
    services: true,
    metrics: true,
    tray: true,
    themes: true,
    update: true,
    login: true,
    kernel: true,
    logs: true,
    defaultRouteChange: true
  },
  coreVersions: []
}

export const createNativeBackend = (): Backend => ({
  kind: 'native',
  auth: {
    meta: async () => ({ ...NATIVE_META, features: { ...NATIVE_META.features } }),
    // 桌面 / Android / Mock 没有会话概念：页面视为已登录，登录/登出为空操作
    session: async () => ({ authenticated: true }),
    login: async () => {},
    setup: async () => {},
    logout: async () => {}
  },
  configs: {
    list: () => unsupported('configs.list'),
    read: () => unsupported('configs.read'),
    write: () => unsupported('configs.write'),
    remove: () => unsupported('configs.remove'),
    rename: () => unsupported('configs.rename'),
    importToml: () => unsupported('configs.importToml'),
    exportToml: () => unsupported('configs.exportToml')
  },
  runner: {
    start: async (id) => {
      const { startConfig } = await import('@/shared/platform/coreApi')
      await startConfig(id)
    },
    stop: async (id) => {
      const { getRunningList, stopConfig } = await import('@/shared/platform/coreApi')
      // 门面只拿得到配置 id，PID / rpcPortal 由运行态扫描补齐
      const [running] = await getRunningList([id])
      if (!running) return
      await stopConfig(running)
    },
    restart: async (id) => {
      const { getRunningList, startConfig, stopConfig } = await import('@/shared/platform/coreApi')
      const [running] = await getRunningList([id])
      if (running) await stopConfig(running)
      await startConfig(id)
    }
  },
  runtime: {
    instances: async () => {
      const { getRuntimeSnapshot } = await import('@/shared/platform/runtimeApi')
      // 原生后端本身就是运行态来源：原样返回同形快照，不做二次转换
      return getRuntimeSnapshot()
    },
    monitor: () => unsupported('runtime.monitor')
  },
  logs: {
    list: () => unsupported('logs.list'),
    read: () => unsupported('logs.read'),
    clear: () => unsupported('logs.clear')
  },
  packages: {
    list: () => unsupported('packages.list'),
    install: () => unsupported('packages.install'),
    task: () => unsupported('packages.task'),
    cancelTask: () => unsupported('packages.cancelTask'),
    remove: () => unsupported('packages.remove')
  },
  settings: {
    get: () => unsupported('settings.get'),
    put: () => unsupported('settings.put')
  },
  capabilities: {
    routes: true,
    services: true,
    themes: true,
    update: true,
    tray: true,
    kernel: true,
    logs: true,
    mirror: true
  }
})
