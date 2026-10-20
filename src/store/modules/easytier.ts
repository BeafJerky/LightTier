import {
  CORE_INFO_API,
  DEFAULT_STUN_SERVER,
  DEFAULT_VER_OPTIONS,
  MANAGER_INFO_API,
  MONITOR_LIST,
  STUN_SERVER_URL,
  USER_AGENT
} from '@/constants/easytier'
import { useMockData } from '@/hooks/useMockData'
import { resourceDir } from '@tauri-apps/api/path'
import { fetch } from '@tauri-apps/plugin-http'
import dayjs from 'dayjs'
import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * EasyTier 全局状态
 *
 * 集中承载：
 * - 配置列表 / 运行列表（内核实例、Web 配置服务）
 * - 远端数据缓存（内核版本、STUN 服务器、公共共享节点、监控摘要）
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
    const releaseInfo = ref([])
    const publicPeerList = ref([])
    const stunServerList = ref([])
    const defaultStatus = JSON.stringify({
      status: 'true',
      date: dayjs().format('YYYYMMDD').toString()
    })
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
    const loadRunningList = () => {
      const runningListStr = localStorage.getItem('runningList')
      runningList.value = JSON.parse(runningListStr || '[]')
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
      const storageConfigName = JSON.parse(localStorage.getItem('lastRunConfigName') || '{}')
      if (Object.keys(storageConfigName).length !== 0) {
        return storageConfigName.configFileName
      }
      const storageSelectedConfig = JSON.parse(localStorage.getItem('lastSelectedConfig') || '{}')
      if (Object.keys(storageSelectedConfig).length !== 0) {
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
    // 获取内核版本列表：本地缓存按天有效，过期或为空时请求 GitHub Releases（失败回退默认版本）
    const getCoreReleaseInfo = async () => {
      const localRes = JSON.parse(localStorage.getItem('releaseInfo') || '[]')
      const isGet = JSON.parse(localStorage.getItem('releaseInfoIsGet') || defaultStatus)
      const date = dayjs().format('YYYYMMDD').toString()

      if ((isGet.data !== date && isGet.status === 'false') || releaseInfo.value.length === 0) {
        try {
          const response = await fetch(CORE_INFO_API, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
            connectTimeout: 6000
          })
          if (response.ok) {
            const text = await response.text()
            releaseInfo.value = text ? JSON.parse(text) : []
            // 如果成功获取到新数据，更新本地存储
            localStorage.setItem('releaseInfo', JSON.stringify(releaseInfo.value))
            localStorage.setItem(
              'releaseInfoIsGet',
              JSON.stringify({
                status: 'true',
                date
              })
            )
          } else {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
        } catch (error) {
          console.error('获取发布信息失败:', error)
          console.error('DEFAULT_VER_OPTIONS:', DEFAULT_VER_OPTIONS)
          releaseInfo.value = localRes.length > 0 ? localRes : DEFAULT_VER_OPTIONS
          return releaseInfo.value
        }
      } else {
        releaseInfo.value = localRes
      }

      return releaseInfo.value
    }

    // 强制刷新版本信息（供按钮调用）
    const refreshCoreReleaseInfo = async () => {
      try {
        const response = await fetch(CORE_INFO_API, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT },
          connectTimeout: 10000
        })
        releaseInfo.value = await response.json()
        const date = dayjs().format('YYYYMMDD').toString()
        localStorage.setItem('releaseInfo', JSON.stringify(releaseInfo.value))
        localStorage.setItem(
          'releaseInfoIsGet',
          JSON.stringify({
            status: 'true',
            date
          })
        )
        return releaseInfo.value
      } catch (error) {
        console.error('刷新版本信息失败:', error)
        return releaseInfo.value.length > 0 ? releaseInfo.value : DEFAULT_VER_OPTIONS
      }
    }

    // 获取管理器（LightTier）发布信息（5.11 检查更新）
    const refreshManagerReleaseInfo = async () => {
      const response = await fetch(MANAGER_INFO_API, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        connectTimeout: 10000
      })
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return await response.json()
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
      publicPeerList.value = JSON.parse(localStorage.getItem('publicPeerList') || '[]')
      return publicPeerList.value
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
    const loadWebConfigFiles = async () => {
      if (webConfigListLoading.value) return
      webConfigListLoading.value = true
      try {
        const { readWebConfigList } = useMockData()
        configWebList.value = (await readWebConfigList()) as any
        webConfigListLoaded.value = true
      } catch {
        /* 彻底失败 */
      } finally {
        webConfigListLoading.value = false
      }
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
      loadRunningList,
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
      getCoreReleaseInfo,
      refreshCoreReleaseInfo,
      refreshManagerReleaseInfo,
      getPublicPeerList,
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
      // 启动队列属于运行时瞬时状态，持久化会导致刷新后出现幽灵队列
      omit: ['startQueue']
    }
  }
)
