/**
 * 配置域：配置/运行列表、Web 配置服务列表与加载态。
 * 列表加载共享在途任务，避免并发调用拿到写盘前的旧结果。
 */
import { ref } from 'vue'
import { resourceDir } from '@tauri-apps/api/path'
import type { FormWebData } from '@/entities/config/formTypes'
import { useMockData } from '@/shared/platform/mockData'

export function createConfigDomain() {
  const configPath = ref('resource')
  const configList = ref<RunningItem[]>([])
  const configWebList = ref<FormWebData[]>([])
  const runningList = ref<RunningItem[]>([])
  const lastRunConfig = ref<RunningItem>()
  const lastSelectedConfig = ref<RunningItem>()
  const stopLoop = ref(false)
  const stopSetRoute = ref(false)
  // 并发启动串行队列（含执行中项，文件名带 .toml 后缀）
  const startQueue = ref<string[]>([])
  // 配置列表加载状态
  const configListLoaded = ref(false)
  const configListLoading = ref(false)
  const webConfigListLoaded = ref(false)
  const webConfigListLoading = ref(false)

  // 设置配置根路径：显式传参优先，否则取 Tauri resource 目录（安装目录内的资源）
  const setConfigPath = async (path?: string) => {
    if (path) {
      configPath.value = path
      return
    }
    configPath.value = await resourceDir()
  }

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
        configWebList.value = await readWebConfigList()
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
    startQueue,
    configListLoaded,
    configListLoading,
    webConfigListLoaded,
    webConfigListLoading,
    setConfigPath,
    setStartQueue,
    getRunningItem,
    setRunningList,
    addRunningList,
    removeRunningList,
    setLastRunConfigName,
    setLastSelectedConfig,
    getLastRunConfigName,
    loadConfigFiles,
    reloadConfigFiles,
    loadWebConfigFiles
  }
}
