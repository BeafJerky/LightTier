import {
  DEFAULT_STUN_SERVER,
  GITHUB_EASYTIER,
  MANAGER_INFO_API,
  MANAGER_INFO_MIRROR_URL,
  MONITOR_LIST,
  STUN_SERVER_URL,
  USER_AGENT,
  getMirrorUrl
} from '@/constants/easytier'
import { useMockData } from '@/hooks/useMockData'
import { parseCoreVersion, resolveCoreCapabilities } from '@/utils/kernelCompatUtil'
import { isTauri } from '@tauri-apps/api/core'
import { resourceDir } from '@tauri-apps/api/path'
import { fetch } from '@tauri-apps/plugin-http'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * 安全读取 localStorage 中的 JSON。
 *
 * 存储内容可能因手动编辑、旧版本残留或写入中断而损坏；
 * 单键解析失败只回退默认值，不能让异常在启动阶段冒泡导致整页白屏。
 */
const readStoredJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`[easytier] localStorage "${key}" 解析失败，已回退默认值`, error)
    return fallback
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
    const fileList = ref<string[]>([])
    const runningList = ref<RunningItem[]>([])
    const lastRunConfig = ref<RunningItem>()
    const lastSelectedConfig = ref<RunningItem>()
    const allConfigOptions = ref<any[]>([])
    // 带有文件后缀
    const fileListNoSuffix = ref<string[]>([])
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
    // Xshell 路径
    const xshellPath = ref('')
    // 是否是首次加载（用于自动运行逻辑）
    const isFirstLoad = ref(true)
    // 锁定密码：加盐 SHA-256 校验串（sha256$salt$hash），旧版明文由启动迁移升级
    const lockPassword = ref('')
    // 启动直接报错提示
    const errRunNotify = ref(true)
    const defaultFormData = ref()
    const os = ref('windows')
    const publicPeerList = ref<any[]>([])
    const stunServerList = ref([])
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
    const setConfigList = (list: RunningItem[]) => {
      configList.value = list
    }
    const setConfigWebList = (list: RunningWebItem[]) => {
      configWebList.value = list
    }
    const setFileList = (list: string[]) => {
      fileList.value = list
    }
    const setFileListNoSuffix = (list: string[]) => {
      fileListNoSuffix.value = list
    }
    // 按配置文件名（不含 .toml 后缀）查运行记录
    const getRunningItem = (configFileName: string) => {
      return runningList.value.find((i) => i.configFileName === configFileName)
    }
    const setRunningList = (list: RunningItem[]) => {
      runningList.value = list
      localStorage.setItem('runningList', JSON.stringify(runningList.value))
    }
    const addRunningList = (configFileName: string, pid: number) => {
      runningList.value.push({ configFileName, pid })
      localStorage.setItem('runningList', JSON.stringify(runningList.value))
    }
    const removeRunningList = (configFileName: string) => {
      runningList.value = runningList.value.filter((i) => i.configFileName !== configFileName)
      localStorage.setItem('runningList', JSON.stringify(runningList.value))
    }
    const setLastRunConfigName = (config: any) => {
      lastRunConfig.value = config
      localStorage.setItem('lastRunConfigName', JSON.stringify(config))
    }
    const setLastSelectedConfig = (config: any) => {
      lastSelectedConfig.value = config
      localStorage.setItem('lastSelectedConfig', JSON.stringify(config))
    }
    // 取「上次运行/选择」的配置名：内存 → lastRunConfigName → lastSelectedConfig → 列表首项 逐级兜底
    const getLastRunConfigName = () => {
      if (lastRunConfig.value) {
        return lastRunConfig.value.configFileName
      }
      const storageConfigName = readStoredJson<RunningItem | null>('lastRunConfigName', null)
      if (storageConfigName?.configFileName) {
        return storageConfigName.configFileName
      }
      const storageSelectedConfig = readStoredJson<RunningItem | null>('lastSelectedConfig', null)
      if (storageSelectedConfig?.configFileName) {
        return storageSelectedConfig.configFileName
      }
      if (configList.value.length > 0) {
        return configList.value[0].configFileName
      }
      return ''
    }
    const setAllConfigOptions = (list: any[]) => {
      allConfigOptions.value = list
    }
    const setStopLoop = (flag: boolean) => {
      stopLoop.value = flag
    }
    const setP2pNotify = (flag: boolean) => {
      p2pNotify.value = flag
    }
    const setP2pNotifySetting = (flag: boolean) => {
      p2pNotifySetting.value = flag
    }
    const setMonitorSummary = (configName: string, summary: MonitorSummary) => {
      monitorSummaryMap.value = { ...monitorSummaryMap.value, [configName]: summary }
    }
    const clearMonitorSummary = (configName: string) => {
      const next = { ...monitorSummaryMap.value }
      delete next[configName]
      monitorSummaryMap.value = next
    }
    const setAutoRunNetworkSetting = (flag: boolean) => {
      autoRunNetworkSetting.value = flag
    }
    const setAutoRunConfigName = (name: string) => {
      autoRunConfigName.value = name
    }
    const setDefaultFormData = (data: any) => {
      defaultFormData.value = data
    }
    const setErrRunNotify = (data: boolean) => {
      errRunNotify.value = data
    }
    const setOs = (data: string) => {
      os.value = data
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
        const { getCoreVersion } = await import('@/utils/coreApi')
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

    // 获取公共共享节点列表（uptime 监控数据）；接口失败时回退本地缓存
    const getPublicPeerList = async () => {
      const response = await fetch(MONITOR_LIST, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          accept: 'application/json, text/plain, */*',
          Referer: 'https://uptime.easytier.cn/'
        },
        connectTimeout: 10000
      })
      const res = await response.json()
      if (res && res.success) {
        publicPeerList.value = res.data.items
        localStorage.setItem('publicPeerList', JSON.stringify(publicPeerList.value))
        return publicPeerList.value
      }
      const cachedPeers = readStoredJson<unknown>('publicPeerList', [])
      publicPeerList.value = Array.isArray(cachedPeers) ? cachedPeers : []
      return publicPeerList.value
    }
    // 清除远端临时缓存后同步重置内存副本（下次使用时会自然重新拉取远端数据）
    const resetRemoteCache = () => {
      publicPeerList.value = []
      stunServerList.value = []
    }
    // 获取 STUN 服务器列表：命中缓存立即返回（后台静默刷新），未命中则同步请求远端
    const getStunServers = async () => {
      // 优先从缓存读取
      const cachedList = localStorage.getItem('stunServerList')
      if (cachedList) {
        try {
          const parsed = JSON.parse(cachedList)
          if (Array.isArray(parsed) && parsed.length > 0) {
            // 排除默认服务器，对剩余部分进行随机排序
            const remoteServers = parsed.filter((s) => !DEFAULT_STUN_SERVER.includes(s))
            const shuffledRemote = remoteServers.sort(() => Math.random() - 0.5)
            // 确保默认服务器在最前面
            const combinedList = [...new Set([...DEFAULT_STUN_SERVER, ...shuffledRemote])]
            // @ts-ignore
            stunServerList.value = combinedList
            // 后台静默更新（不阻塞返回）
            fetchStunServersFromApi()
            return stunServerList.value
          }
        } catch (e) {
          console.error('解析 STUN 缓存失败:', e)
        }
      }

      // 无缓存时，尝试从 API 获取
      await fetchStunServersFromApi()
      // fetchStunServersFromApi 内部已经处理了随机化和合并
      return stunServerList.value
    }

    // 从远端拉取 STUN 列表：过滤空行/注释行，默认服务器置顶去重、远程项随机排序后缓存
    const fetchStunServersFromApi = async () => {
      try {
        const response = await fetch(STUN_SERVER_URL, {
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/plain'
          },
          connectTimeout: 10000
        })

        const res = await response.text()
        if (res && res.trim()) {
          const newList = res
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'))

          if (newList.length > 0) {
            // 排除默认服务器，对远程获取的列表进行随机排序
            const remoteServers = newList.filter((s) => !DEFAULT_STUN_SERVER.includes(s))
            const shuffledRemote = remoteServers.sort(() => Math.random() - 0.5)
            // 确保默认服务器在最前面且不重复
            const combinedList = [...new Set([...DEFAULT_STUN_SERVER, ...shuffledRemote])]
            // @ts-ignore
            stunServerList.value = combinedList
            localStorage.setItem('stunServerList', JSON.stringify(combinedList))
            return combinedList
          }
        }
      } catch (error) {
        console.error('获取 STUN 服务器列表失败:', error)
      }
      return DEFAULT_STUN_SERVER
    }

    // 强制刷新 STUN 服务器列表（供按钮调用）
    const refreshStunServers = async () => {
      await fetchStunServersFromApi()
      // fetchStunServersFromApi 内部已经处理了随机化和合并
      return stunServerList.value
    }

    const setSelectedColumns = (list: string[]) => {
      selectedColumns.value = list
    }
    const setDefaultServiceInstallMethod = (method: 'nssm' | 'official') => {
      defaultServiceInstallMethod.value = method
    }
    const setDefaultEnableAutostart = (enable: boolean) => {
      defaultEnableAutostart.value = enable
    }
    const setRefreshInterval = (val: number) => {
      refreshInterval.value = val
    }

    // ===== 配置列表加载（应用启动时调用一次，带并发保护与加载态） =====
    const loadConfigFiles = async () => {
      if (configListLoading.value) return
      configListLoading.value = true
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
      }
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
      fileList,
      fileListNoSuffix,
      runningList,
      allConfigOptions,
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
      xshellPath,
      isFirstLoad,
      lockPassword,
      defaultFormData,
      errRunNotify,
      os,
      selectedColumns,
      defaultServiceInstallMethod,
      defaultEnableAutostart,
      cachedNodeInfo,
      cachedPeerInfo,
      configListLoaded,
      configListLoading,
      webConfigListLoaded,
      webConfigListLoading,
      setConfigList,
      setConfigWebList,
      setFileList,
      setFileListNoSuffix,
      getRunningItem,
      setRunningList,
      addRunningList,
      removeRunningList,
      setAllConfigOptions,
      setLastRunConfigName,
      setLastSelectedConfig,
      getLastRunConfigName,
      setStopLoop,
      setP2pNotify,
      setP2pNotifySetting,
      setAutoRunNetworkSetting,
      setAutoRunConfigName,
      setDefaultFormData,
      setErrRunNotify,
      setOs,
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
      setSelectedColumns,
      setDefaultServiceInstallMethod,
      setDefaultEnableAutostart,
      setRefreshInterval,
      loadConfigFiles,
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
