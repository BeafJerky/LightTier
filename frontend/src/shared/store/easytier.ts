import {
  GITHUB_EASYTIER,
  MANAGER_INFO_API,
  MANAGER_INFO_MIRROR_URL,
  MONITOR_LIST,
  USER_AGENT,
  getMirrorUrl
} from '@/shared/constants/easytier'
import { useMockData } from '@/shared/platform/mockData'
import { PEER_CACHE_KEY } from '@/shared/lib/cacheUtil'
import { parseCoreVersion, resolveCoreCapabilities } from '@/entities/kernel/kernelCompatUtil'
import {
  clearStunCache,
  mergeStunServers,
  readStunCache,
  requestStunServers,
  writeStunCache
} from '@/shared/platform/stunServerUtil'
import { isTauri } from '@tauri-apps/api/core'
import { resourceDir } from '@tauri-apps/api/path'
import { fetch } from '@tauri-apps/plugin-http'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** 公共共享节点缓存读取（uptime 接口失败时兜底，不参与业务状态持久化） */
const readPeerCache = (): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PEER_CACHE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * EasyTier 全局状态
 *
 * 集中承载：
 * - 配置列表 / 运行列表（内核实例、Web 配置服务）
 * - 内核版本探测结果（表单、CLI、服务安装按版本适配的唯一依据）
 * - 远端数据缓存（STUN 服务器、公共共享节点、监控摘要）
 * - 页面偏好设置（刷新频率、P2P 通知、锁屏密码等）
 *
 * 持久化：除 startQueue（运行时瞬时状态）外整体持久化到 localStorage；
 * 锁屏密码仅存加盐 SHA-256 校验串（见 utils/lockUtil，绝不落明文）。
 * 启动自动运行由 overview 页读取 settings.autoRunNetwork 触发（单一编排点）；
 * 桌面服务自启由 nssm 安装项承载，Android 由 VPN 前台服务承载。
 */
export const useEasyTierStore = defineStore(
  'easytier',
  () => {
    // ===== 配置与运行列表 =====
    const configPath = ref('resource')
    const configList = ref<RunningItem[]>([])
    const configWebList = ref<RunningWebItem[]>([])
    const runningList = ref<RunningItem[]>([])
    const lastRunConfig = ref<RunningItem>()
    const lastSelectedConfig = ref<RunningItem>()
    const stopLoop = ref(false)
    const stopSetRoute = ref(false)
    // ===== 远端数据缓存与页面偏好 =====
    // 是否 通知 全部节点建立 P2P 连接  true:通知  false:不同值
    const p2pNotify = ref(true)
    // P2P 通知设置 true:开启  false:关闭
    const p2pNotifySetting = ref(true)
    // 监控摘要快照：configName → 节点数/平均延迟（monitor 单写，overview 多读，避免复制轮询）
    interface MonitorSummary {
      nodeCount: number
      avgLatency: string
    }
    const monitorSummaryMap = ref<Record<string, MonitorSummary>>({})
    // 启动后自动运行网络 true:开启  false:关闭
    const autoRunNetworkSetting = ref(false)
    // 启动后自动运行的网络配置名称
    const autoRunConfigName = ref('')
    // 刷新频率（秒）
    const refreshInterval = ref(3)
    // 是否是首次加载（用于自动运行逻辑）
    const isFirstLoad = ref(true)
    // 锁定密码：加盐 SHA-256 校验串（sha256$salt$hash），旧版明文由启动迁移升级
    const lockPassword = ref('')
    // 启动直接报错提示
    const errRunNotify = ref(true)
    // 检查更新只认正式版（忽略 nightly 等预发布），默认开启
    const updateStableOnly = ref(true)
    const publicPeerList = ref<any[]>([])
    const stunServerList = ref<string[]>([])
    // 当前选择的列（存储prop值）
    const selectedColumns = ref(['rx_bytes', 'tx_bytes', 'nat_type'])
    // 默认服务安装方式
    const defaultServiceInstallMethod = ref<'nssm' | 'official'>('nssm')
    // 默认开机自启动
    const defaultEnableAutostart = ref(true)
    // 缓存的节点信息（页面切换时保留，避免重新轮询）
    const cachedNodeInfo = ref<any>({})
    // 缓存的 peer 信息（页面切换时保留，避免重新轮询）
    const cachedPeerInfo = ref<PeerInfo[]>([])
    // 配置列表加载状态
    const configListLoaded = ref(false)
    const configListLoading = ref(false)
    const webConfigListLoaded = ref(false)
    const webConfigListLoading = ref(false)
    // 页面刷新回调（悬浮快捷菜单调用）
    const pageRefreshCallback = ref<(() => void) | null>(null)
    const registerPageRefresh = (cb: () => void) => {
      pageRefreshCallback.value = cb
    }
    const clearPageRefresh = () => {
      pageRefreshCallback.value = null
    }
    const triggerPageRefresh = () => {
      pageRefreshCallback.value?.()
    }
    // 并发启动串行队列（含执行中项，文件名带 .toml 后缀）
    const startQueue = ref<string[]>([])
    const setStartQueue = (queue: string[]) => {
      startQueue.value = queue
    }
    // 按配置文件名（不含 .toml 后缀）查运行记录
    const getRunningItem = (configFileName: string) => {
      return runningList.value.find((i) => i.configFileName === configFileName)
    }
    // 运行列表与上次选择由 pinia 持久化插件统一落盘，禁止再手写 localStorage：
    // 两套写入路径会在刷新/恢复时互相覆盖，且旧键无法被备份与清理逻辑识别
    const setRunningList = (list: RunningItem[]) => {
      runningList.value = list
    }
    const addRunningList = (configFileName: string, pid: number) => {
      runningList.value.push({ configFileName, pid })
    }
    const removeRunningList = (configFileName: string) => {
      runningList.value = runningList.value.filter((i) => i.configFileName !== configFileName)
    }
    const setLastRunConfigName = (config: RunningItem | undefined) => {
      lastRunConfig.value = config
    }
    const setLastSelectedConfig = (config: RunningItem | undefined) => {
      lastSelectedConfig.value = config
    }
    // 取「上次运行/选择」的配置名：运行记录 → 选择记录 → 列表首项 逐级兜底
    const getLastRunConfigName = () => {
      if (lastRunConfig.value) return lastRunConfig.value.configFileName
      if (lastSelectedConfig.value) return lastSelectedConfig.value.configFileName
      return configList.value[0]?.configFileName ?? ''
    }
    const setMonitorSummary = (configName: string, summary: MonitorSummary) => {
      monitorSummaryMap.value = { ...monitorSummaryMap.value, [configName]: summary }
    }
    const clearMonitorSummary = (configName: string) => {
      const next = { ...monitorSummaryMap.value }
      delete next[configName]
      monitorSummaryMap.value = next
    }
    // 设置配置根路径：显式传参优先，否则取 Tauri resource 目录（安装目录内的资源）
    const setConfigPath = async (path?: string) => {
      if (path) {
        configPath.value = path
        return
      }
      configPath.value = await resourceDir()
    }
    // ===== 内核版本探测 =====
    // 已安装内核版本（规范化 vX.Y.Z）；null 表示未安装或无法识别。
    // 该值决定表单字段可见性、CLI/服务参数格式等版本适配行为。
    const detectedCoreVersion = ref<string | null>(null)
    // 原始版本输出（如 easytier-cli 2.6.4），用于设置页原样展示
    const coreVersionRaw = ref('')
    const coreVersionDetecting = ref(false)
    const coreCaps = computed(() => resolveCoreCapabilities(detectedCoreVersion.value))

    // 写入探测结果：无法解析时置空（兼容旧版 403 等异常输出）
    const applyCoreVersionRaw = (raw: unknown): string | null => {
      const text = typeof raw === 'string' ? raw.trim() : ''
      coreVersionRaw.value = text
      detectedCoreVersion.value = parseCoreVersion(text)
      return detectedCoreVersion.value
    }

    /**
     * 重新探测已安装内核版本（桌面 easytier-cli -V / Android 编译期版本）。
     * 失败不抛出，返回 null，避免启动流程被内核缺失阻断。
     */
    const detectCoreVersion = async (): Promise<string | null> => {
      if (coreVersionDetecting.value) return detectedCoreVersion.value
      coreVersionDetecting.value = true
      try {
        const { getCoreVersion } = await import('@/shared/platform/coreApi')
        return applyCoreVersionRaw(await getCoreVersion())
      } catch {
        return applyCoreVersionRaw('')
      } finally {
        coreVersionDetecting.value = false
      }
    }

    // 获取管理器（LightTier）发布信息（5.11 检查更新）
    // 桌面端优先走所选加速源，并与官方 API、实测支持 api.github.com 的镜像并发请求，
    // 首个返回有效 releases 数组的源胜出；浏览器预览走原生 fetch（镜像普遍无 CORS）。
    // 10 秒总超时：网络不可用时及时失败，避免“检查中”无限等待。
    const refreshManagerReleaseInfo = async (preferredMirror?: string) => {
      const desktopRuntime = isTauri()
      const bases = desktopRuntime
        ? [preferredMirror, GITHUB_EASYTIER, ...MANAGER_INFO_MIRROR_URL]
        : [GITHUB_EASYTIER]
      // 官方源原样返回 API 地址，镜像源拼成“前缀 + 完整 GitHub URL”；去重避免重复请求
      const urls = Array.from(
        new Set(
          bases
            .filter((base): base is string => Boolean(base))
            .map((base) => getMirrorUrl(base, MANAGER_INFO_API))
        )
      )
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      const request = async (url: string) => {
        const init = {
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/vnd.github+json'
          },
          signal: controller.signal
        }
        // 浏览器预览无 Tauri IPC，走原生 fetch（GitHub API 允许跨域）；
        // 桌面/Android 走 plugin-http，绕过 WebView CORS 限制
        const response = desktopRuntime ? await fetch(url, init) : await window.fetch(url, init)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('empty release list')
        }
        return data
      }
      try {
        return await new Promise((resolve, reject) => {
          let pending = urls.length
          urls.forEach((url) => {
            request(url)
              .then(resolve)
              .catch(() => {
                pending -= 1
                if (pending === 0) reject(new Error('all release sources failed'))
              })
          })
        })
      } finally {
        // 拿到首个结果后终止其余请求，避免后台挂起
        clearTimeout(timer)
        controller.abort()
      }
    }

    // 公共共享节点列表（uptime 监控数据）：成功即更新缓存，失败回退上次成功结果
    const getPublicPeerList = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch(MONITOR_LIST, {
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            accept: 'application/json, text/plain, */*',
            Referer: 'https://uptime.easytier.cn/'
          },
          signal: controller.signal
        })
        const payload = await response.json()
        const items = payload?.success ? payload.data?.items : null
        if (Array.isArray(items)) {
          publicPeerList.value = items
          localStorage.setItem(PEER_CACHE_KEY, JSON.stringify(items))
          return items
        }
      } catch (error) {
        console.warn('[peers] 公共节点拉取失败，使用缓存', error)
      } finally {
        clearTimeout(timer)
      }
      publicPeerList.value = readPeerCache()
      return publicPeerList.value
    }

    // 清除远端临时缓存后同步重置内存副本（下次使用时会自然重新拉取远端数据）
    const resetRemoteCache = () => {
      publicPeerList.value = []
      stunServerList.value = []
      localStorage.removeItem(PEER_CACHE_KEY)
      clearStunCache(localStorage)
    }

    // STUN 列表：缓存命中先返回并后台刷新，未命中则同步拉取；失败只回退默认服务器
    let stunRefreshTask: Promise<string[]> | null = null
    const refreshStunServers = async (): Promise<string[]> => {
      if (stunRefreshTask) return stunRefreshTask
      stunRefreshTask = (async () => {
        const merged = mergeStunServers(await requestStunServers())
        stunServerList.value = merged
        writeStunCache(merged, localStorage)
        return merged
      })().finally(() => {
        stunRefreshTask = null
      })
      return stunRefreshTask
    }
    const getStunServers = async (): Promise<string[]> => {
      const cached = readStunCache(localStorage)
      if (cached.length === 0) return refreshStunServers()
      stunServerList.value = mergeStunServers(cached)
      void refreshStunServers()
      return stunServerList.value
    }

    const setRefreshInterval = (val: number) => {
      refreshInterval.value = val
    }

    // ===== 配置列表加载（带并发保护与加载态） =====
    // 并发调用共享同一任务：早退会让写盘后的调用方直接拿到写盘前启动的旧任务结果，
    // 新配置在列表里“消失”，看起来像保存失败
    let configLoadTask: Promise<void> | null = null
    const loadConfigFiles = async (): Promise<void> => {
      if (configLoadTask) return configLoadTask
      configListLoading.value = true
      configLoadTask = (async () => {
        try {
          const { listTomlFiles } = useMockData()
          const files = await listTomlFiles()
          configList.value = files.map((f: string) => ({
            configFileName: f.replace('.toml', ''),
            fileName: f
          }))
          configListLoaded.value = true
        } catch {
          /* 彻底失败，保持空列表 */
        } finally {
          configListLoading.value = false
          configLoadTask = null
        }
      })()
      return configLoadTask
    }

    // 写盘后刷新：等待写盘前启动的在途加载结束，再重新读取目录
    const reloadConfigFiles = async (): Promise<void> => {
      const pending = configLoadTask
      if (pending) await pending
      return loadConfigFiles()
    }

    // 加载 Web 配置服务列表（config-server 托管的连接信息）
    // 并发调用共享同一任务：早退会让调用方在旧列表上继续做运行态扫描，
    // 随后加载完成又用持久化旧状态覆盖扫描结果，造成状态闪变/卡错
    let webConfigLoadTask: Promise<void> | null = null
    const loadWebConfigFiles = async (): Promise<void> => {
      if (webConfigLoadTask) return webConfigLoadTask
      webConfigListLoading.value = true
      webConfigLoadTask = (async () => {
        try {
          const { readWebConfigList } = useMockData()
          configWebList.value = (await readWebConfigList()) as any
          webConfigListLoaded.value = true
        } catch {
          /* 彻底失败 */
        } finally {
          webConfigListLoading.value = false
          webConfigLoadTask = null
        }
      })()
      return webConfigLoadTask
    }

    return {
      configPath,
      configList,
      configWebList,
      runningList,
      lastRunConfig,
      lastSelectedConfig,
      stopLoop,
      stopSetRoute,
      p2pNotify,
      p2pNotifySetting,
      monitorSummaryMap,
      setMonitorSummary,
      clearMonitorSummary,
      autoRunNetworkSetting,
      autoRunConfigName,
      refreshInterval,
      isFirstLoad,
      lockPassword,
      errRunNotify,
      updateStableOnly,
      selectedColumns,
      defaultServiceInstallMethod,
      defaultEnableAutostart,
      cachedNodeInfo,
      cachedPeerInfo,
      configListLoaded,
      configListLoading,
      webConfigListLoaded,
      webConfigListLoading,
      getRunningItem,
      setRunningList,
      addRunningList,
      removeRunningList,
      setLastRunConfigName,
      setLastSelectedConfig,
      getLastRunConfigName,
      setConfigPath,
      detectedCoreVersion,
      coreVersionRaw,
      coreVersionDetecting,
      coreCaps,
      detectCoreVersion,
      refreshManagerReleaseInfo,
      getPublicPeerList,
      resetRemoteCache,
      getStunServers,
      refreshStunServers,
      setRefreshInterval,
      loadConfigFiles,
      reloadConfigFiles,
      loadWebConfigFiles,
      pageRefreshCallback,
      registerPageRefresh,
      clearPageRefresh,
      triggerPageRefresh,
      startQueue,
      setStartQueue
    }
  },
  {
    persist: {
      key: 'easytier',
      storage: localStorage,
      // 启动队列属于运行时瞬时状态，持久化会导致刷新后出现幽灵队列；
      // isFirstLoad 必须每个进程重新为 true，否则持久化的 false 会让冷启动自动运行永不触发
      omit: ['startQueue', 'isFirstLoad'],
      // 运行列表只作首帧提示：PID 属于上个进程，系统复用后可能误杀无关进程。
      // 清空 PID 后，停止操作会按配置名重新扫描定位真实进程。
      afterHydrate: (ctx) => {
        const store = ctx.store as unknown as { runningList: RunningItem[] }
        store.runningList = (store.runningList || []).map((item) => ({ ...item, pid: undefined }))
      }
    }
  }
)
