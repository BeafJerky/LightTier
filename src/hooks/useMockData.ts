/**
 * 浏览器 Mock / 真实实现 环境分发层
 *
 * 背景：`pnpm dev` 为浏览器预览模式，无 Tauri API。所有涉及内核 / 文件 / 服务的调用
 * 必须经此层降级：isMock 时用内存 mock，否则动态 import 真实实现
 * （动态导入可避免浏览器环境加载 @tauri-apps 模块时报错）。
 *
 * 约定：对外暴露的 API 与真实实现同构，页面无需感知运行环境。
 */
import { ref } from 'vue'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import type { FormWebData } from '@/types/formTypes'

// ===== Mock 持久化（浏览器预览刷新后保留配置与恢复结果） =====
const MOCK_TOML_FILES_KEY = 'lighttier.mock.tomlFiles'
const MOCK_TOML_CONTENT_KEY = 'lighttier.mock.tomlContent'
const MOCK_WEB_CONFIGS_KEY = 'lighttier.mock.webConfigs'

const loadMockJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const saveMockJson = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage 不可用或超额时仅保留内存态 */
  }
}

const loadMockTomlFiles = (): string[] => {
  const loaded = loadMockJson<unknown>(MOCK_TOML_FILES_KEY, null)
  return Array.isArray(loaded)
    ? loaded.filter((name): name is string => typeof name === 'string')
    : [...DEFAULT_MOCK_TOML_FILES]
}

const loadMockTomlContent = (): Record<string, string> => {
  const loaded = loadMockJson<unknown>(MOCK_TOML_CONTENT_KEY, null)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    return { ...DEFAULT_MOCK_TOML_CONTENT }
  }
  return Object.fromEntries(
    Object.entries(loaded).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

// ===== Mock 运行态数据（内核实例 / Web 配置服务，内存 Map 模拟进程表） =====
const mockRunningMap = ref<Map<string, number>>(new Map())
let mockPidCounter = 1000

// --- Web 配置 Mock 数据 ---
const mockWebRunningMap = ref<Map<string, number>>(new Map())
let mockWebPidCounter = 2000
const DEFAULT_MOCK_WEB_CONFIGS: FormWebData[] = [
  {
    configFileName: '自建中继',
    host: '192.168.1.100',
    port: 22020,
    protocol: 'udp',
    userName: 'relay-admin',
    webStartMethod: 2,
    webUrl: 'http://192.168.1.100:8080',
    status: 'notRunning'
  },
  {
    configFileName: '测试服务器',
    host: '10.0.0.50',
    port: 22020,
    protocol: 'udp',
    userName: 'test-user',
    webStartMethod: 2,
    webUrl: '',
    status: 'notRunning'
  }
]
const loadMockWebConfigs = (): FormWebData[] => {
  const loaded = loadMockJson<unknown>(MOCK_WEB_CONFIGS_KEY, null)
  return Array.isArray(loaded) ? (loaded as FormWebData[]) : [...DEFAULT_MOCK_WEB_CONFIGS]
}
const mockWebConfigList = ref<FormWebData[]>(loadMockWebConfigs())

// Tauri 环境检测：浏览器 dev 模式无 Tauri 运行时，全部走 mock
// 注：withGlobalTauri 已关闭，统一用 @tauri-apps/api 的 isTauri()（读 __TAURI_INTERNALS__）
const isTauriEnv = (): boolean => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
}

// ===== Mock 配置样例（浏览器预览用演示数据） =====
const DEFAULT_MOCK_TOML_FILES: string[] = [
  '东京中继节点.toml',
  '新加坡出口.toml',
  '家庭局域网.toml',
  '办公室组网.toml',
  '移动设备.toml'
]

const DEFAULT_MOCK_TOML_CONTENT: Record<string, string> = {
  东京中继节点: `[network]
instance_name = "tokyo-relay"
hostname = "tokyo-node-01"

[network_identity]
network_name = "global-mesh"
dhcp = true

rpc_portal = "0.0.0.0:15888"
listeners = ["tcp://0.0.0.0:11000"]
routes = ["10.144.0.0/24"]

[[peer]]
uri = "tcp://sgp-relay.example.com:11000"
`,
  新加坡出口: `[network]
instance_name = "sgp-exit"
hostname = "sgp-gateway"

[network_identity]
network_name = "asia-backbone"
dhcp = false

rpc_portal = "0.0.0.0:15888"
listeners = ["tcp://0.0.0.0:11001"]
routes = ["10.145.0.0/24"]
exit_nodes = ["10.145.0.1"]

[[peer]]
uri = "tcp://tokyo-relay.example.com:11000"

[[peer]]
uri = "tcp://home-node.example.com:11000"
`,
  家庭局域网: `[network]
instance_name = "home-intranet"
hostname = "home-server"

[network_identity]
network_name = "home-mesh"
dhcp = true

rpc_portal = "0.0.0.0:15888"
listeners = ["tcp://0.0.0.0:11002"]
routes = ["192.168.1.0/24"]

[[peer]]
uri = "tcp://sgp-relay.example.com:11001"

[flags]
no_proxy = true
no_drop_private = true
`,
  办公室组网: `[network]
instance_name = "office-net"
hostname = "office-gateway"

[network_identity]
network_name = "office-mesh"
dhcp = true

rpc_portal = "0.0.0.0:15888"
listeners = ["tcp://0.0.0.0:11003", "tcp://0.0.0.0:11004"]
routes = ["10.10.0.0/16"]

[[peer]]
uri = "tcp://home-node.example.com:11002"

[[peer]]
uri = "tcp://mobile-dev.example.com:11005"

[flags]
latency_first = true
`,
  移动设备: `[network]
instance_name = "mobile-dev"
hostname = "iphone-14"

[network_identity]
network_name = "mobile-mesh"
dhcp = true

listeners = ["tcp://0.0.0.0:11005"]
routes = ["10.0.0.0/8"]

[[peer]]
uri = "tcp://office-gateway.example.com:11003"
`
}

// 优先使用上次会话持久化的数据（含恢复写入的新配置），无记录时回退演示数据
const mockTomlFiles: string[] = loadMockTomlFiles()
const mockTomlContent: Record<string, string> = loadMockTomlContent()

const persistMockToml = (): void => {
  saveMockJson(MOCK_TOML_FILES_KEY, mockTomlFiles)
  saveMockJson(MOCK_TOML_CONTENT_KEY, mockTomlContent)
}

/**
 * 创建环境感知 API 集合
 * isMock=true 返回内存 mock，否则返回真实 Tauri 实现（同签名）
 */
export const useMockData = () => {
  const isMock = !isTauriEnv()

  const mockListTomlFiles = async (): Promise<string[]> => {
    return [...mockTomlFiles]
  }

  const mockReadFileContent = async (name: string): Promise<string> => {
    // 支持完整路径（config/xxx.toml）与纯名称（xxx.toml / xxx）
    const key = name.replace(/^.*[\\/]/, '').replace(/\.toml$/, '')
    return mockTomlContent[key] || `[network]\ninstance_name = "unknown"\nhostname = "unknown"\n`
  }

  const mockGetRunningProcesses = async (_programName?: string): Promise<any[]> => {
    return Array.from(mockRunningMap.value.entries()).map(([name, pid]) => ({
      name: 'easytier-core',
      commandLine: `easytier-core --config-file ${name}.toml`,
      path: 'C:\\Program Files\\easytier\\easytier-core.exe',
      pid,
      fileName: name
    }))
  }

  // 浏览器 mock：无真实端口占用，启动预检直接放行
  const mockCheckPortConflicts = async (_configFileName: string): Promise<PortConflict[]> => {
    return []
  }

  // 浏览器 mock：由 mockRunningMap 生成运行时列表（与真实 fetchRunningList 结构一致）
  const mockFetchRunningList = async (_configNames?: string[]): Promise<RunningItem[]> => {
    return Array.from(mockRunningMap.value.entries()).map(([name, pid]) => ({
      configFileName: name,
      fileName: name + '.toml',
      pid
    }))
  }

  const mockRunEasyTierCore = async (_configFileName: string): Promise<any> => {
    return new Promise((resolve) => {
      // 模拟启动耗时，便于观察 UI 加载态
      setTimeout(() => {
        const name = _configFileName.replace('.toml', '')
        if (!mockRunningMap.value.has(name)) {
          mockRunningMap.value.set(name, ++mockPidCounter)
        }
        resolve({ code: 0, msg: 'ok' })
      }, 800)
    })
  }

  const mockKillProcess = async (pid: number): Promise<boolean> => {
    for (const [name, p] of mockRunningMap.value.entries()) {
      if (p === pid) {
        mockRunningMap.value.delete(name)
        break
      }
    }
    return true
  }

  const mockWriteFileContent = async (path: string, content: string): Promise<void> => {
    const fileName = path.replace(/^.*[\\/]/, '')
    const isToml = fileName.endsWith('.toml')
    const key = isToml ? fileName.slice(0, -'.toml'.length) : fileName
    mockTomlContent[key] = content
    // 恢复备份或新建配置时补齐文件列表；.toml.bak 等中间文件不进入列表
    if (isToml && !mockTomlFiles.includes(fileName)) mockTomlFiles.push(fileName)
    persistMockToml()
  }

  const mockDeleteFileOrDir = async (path: string): Promise<void> => {
    const key = path.replace(/^.*[\\/]/, '').replace(/\.toml$/, '')
    delete mockTomlContent[key]
    // 从 mockTomlFiles 中也移除
    const idx = mockTomlFiles.indexOf(key + '.toml')
    if (idx !== -1) mockTomlFiles.splice(idx, 1)
    persistMockToml()
  }

  const mockGetHostname = async (): Promise<string> => {
    return 'mock-host'
  }

  // Mock 服务状态存储
  const mockServiceMap = ref<Map<string, string>>(new Map())

  const mockCheckService = async (_configFileName: string): Promise<string> => {
    return mockServiceMap.value.get(_configFileName) || 'notInstalled'
  }

  const mockInstallService = async (_configFileName: string, _options?: any): Promise<boolean> => {
    mockServiceMap.value.set(_configFileName, 'stopped')
    return true
  }

  const mockUninstallService = async (_configFileName: string): Promise<boolean> => {
    mockServiceMap.value.delete(_configFileName)
    return true
  }

  const mockStartService = async (_configFileName: string): Promise<boolean> => {
    if (mockServiceMap.value.has(_configFileName)) {
      mockServiceMap.value.set(_configFileName, 'running')
      return true
    }
    return false
  }

  const mockStopService = async (_configFileName: string): Promise<boolean> => {
    if (mockServiceMap.value.has(_configFileName)) {
      mockServiceMap.value.set(_configFileName, 'stopped')
      return true
    }
    return false
  }

  /**
   * 环境分发器：isMock 时返回 mock，否则返回真实实现包装（保持同签名）
   * 页面中统一调用这些函数，不关心是 mock 还是真实
   */
  const getListTomlFiles = () => {
    if (isMock) return mockListTomlFiles
    return async () => {
      const { listTomlFiles } = await import('@/utils/fileUtil')
      return listTomlFiles()
    }
  }

  const getReadFileContent = () => {
    if (isMock) return mockReadFileContent
    return async (name: string) => {
      const { readFileContent } = await import('@/utils/fileUtil')
      return readFileContent(name) as Promise<string>
    }
  }

  const getRunningProcesses = () => {
    if (isMock) return mockGetRunningProcesses
    return async (name?: string) => {
      const { getRunningProcesses } = await import('@/utils/shellUtil')
      return getRunningProcesses(name)
    }
  }

  const getCheckPortConflicts = () => {
    if (isMock) return mockCheckPortConflicts
    return async (configFileName: string) => {
      const { checkPortConflicts } = await import('@/utils/shellUtil')
      return checkPortConflicts(configFileName)
    }
  }

  const getFetchRunningList = () => {
    if (isMock) return mockFetchRunningList
    return async (configNames: string[]) => {
      const { fetchRunningList } = await import('@/utils/shellUtil')
      return fetchRunningList(configNames)
    }
  }

  const getRunEasyTierCore = () => {
    if (isMock) return mockRunEasyTierCore
    return async (name: string) => {
      const { runEasyTierCore } = await import('@/utils/shellUtil')
      return runEasyTierCore(name)
    }
  }

  const getKillProcess = () => {
    if (isMock) return mockKillProcess
    return async (pid: number) => {
      const { killProcess } = await import('@/utils/shellUtil')
      return killProcess(pid)
    }
  }

  const getWriteFileContent = () => {
    if (isMock) return mockWriteFileContent
    return async (path: string, content: string) => {
      const { writeFileContent } = await import('@/utils/fileUtil')
      return writeFileContent(path, content)
    }
  }

  const getDeleteFileOrDir = () => {
    if (isMock) return mockDeleteFileOrDir
    return async (path: string) => {
      const { deleteFileOrDir } = await import('@/utils/fileUtil')
      return deleteFileOrDir(path)
    }
  }

  const getHostname = () => {
    if (isMock) return mockGetHostname
    return async () => {
      const { getHostname } = await import('@/utils/sysUtil')
      return getHostname()
    }
  }

  const getCheckService = () => {
    if (isMock) return mockCheckService
    return async (configFileName: string) => {
      const { PREFIX_SVC } = await import('@/constants/easytier')
      const { detectServiceInstallMethod, checkServiceOnWindows, checkServiceWithOfficialCli } =
        await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC + configFileName
      const method = await detectServiceInstallMethod(serviceName)
      if (method === 'nssm') {
        const status = await checkServiceOnWindows(serviceName)
        return serviceStatusDict(status as string | boolean)
      } else if (method === 'official') {
        const status = await checkServiceWithOfficialCli(serviceName)
        return serviceStatusDict(status as string | boolean)
      }
      return 'notInstalled'
    }
  }

  // 记录服务安装方式：detectServiceInstallMethod 依据该记录选择启动/停止/卸载实现
  const saveServiceInstallMethod = (configFileName: string, installMethod: 'nssm' | 'official') => {
    try {
      localStorage.setItem(`service-config:${configFileName}`, JSON.stringify({ installMethod }))
    } catch {
      /* localStorage 不可用时忽略（仅影响方式探测） */
    }
  }
  const clearServiceInstallMethod = (configFileName: string) => {
    try {
      localStorage.removeItem(`service-config:${configFileName}`)
    } catch {
      /* ignore */
    }
  }

  const getInstallService = () => {
    if (isMock) return mockInstallService
    return async (configFileName: string, options?: any) => {
      const { PREFIX_SVC } = await import('@/constants/easytier')
      const { join, resourceDir } = await import('@tauri-apps/api/path')
      const { CONFIG_PATH } = await import('@/constants/easytier')
      const configPath = await join(await resourceDir(), CONFIG_PATH, configFileName + '.toml')
      const serviceName = PREFIX_SVC + configFileName
      const installMethod: 'nssm' | 'official' =
        options?.installMethod === 'official' ? 'official' : 'nssm'
      let ok: boolean
      if (installMethod === 'official') {
        const { installServiceWithOfficialCli } = await import('@/utils/shellUtil')
        ok = await installServiceWithOfficialCli(serviceName, configPath, configFileName, {
          description: options?.description,
          displayName: options?.displayName,
          // 未开启开机自启时显式传 --disable-autostart true
          disableAutostart: options?.enableAutostart === false,
          coreVersion: options?.coreVersion
        })
      } else {
        const { installServiceOnWindows, buildCoreArgsWithLogConfig } =
          await import('@/utils/shellUtil')
        const args = await buildCoreArgsWithLogConfig(configFileName + '.toml', configPath)
        const installOptions =
          options?.username && options?.password
            ? { username: options.username, password: options.password }
            : undefined
        ok = await installServiceOnWindows(serviceName, args, installOptions)
      }
      if (ok) saveServiceInstallMethod(configFileName, installMethod)
      return ok
    }
  }

  const getUninstallService = () => {
    if (isMock) return mockUninstallService
    return async (configFileName: string) => {
      const { PREFIX_SVC } = await import('@/constants/easytier')
      const {
        detectServiceInstallMethod,
        uninstallServiceOnWindows,
        uninstallServiceWithOfficialCli
      } = await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC + configFileName
      const method = await detectServiceInstallMethod(serviceName)
      const ok =
        method === 'official'
          ? await uninstallServiceWithOfficialCli(serviceName)
          : await uninstallServiceOnWindows(serviceName)
      if (ok) clearServiceInstallMethod(configFileName)
      return ok
    }
  }

  const getStartService = () => {
    if (isMock) return mockStartService
    return async (configFileName: string) => {
      const { PREFIX_SVC } = await import('@/constants/easytier')
      const { detectServiceInstallMethod, startServiceOnWindows, startServiceWithOfficialCli } =
        await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC + configFileName
      const method = await detectServiceInstallMethod(serviceName)
      if (method === 'official') return startServiceWithOfficialCli(serviceName)
      if (method === 'nssm') return startServiceOnWindows(serviceName)
      return false
    }
  }

  const getStopService = () => {
    if (isMock) return mockStopService
    return async (configFileName: string) => {
      const { PREFIX_SVC } = await import('@/constants/easytier')
      const { detectServiceInstallMethod, stopServiceOnWindows, stopServiceWithOfficialCli } =
        await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC + configFileName
      const method = await detectServiceInstallMethod(serviceName)
      if (method === 'official') return stopServiceWithOfficialCli(serviceName)
      if (method === 'nssm') return stopServiceOnWindows(serviceName)
      return false
    }
  }

  // 服务状态统一映射：Windows 服务状态码 / 布尔值 → 前端状态键
  const serviceStatusDict = (status: string | boolean): string => {
    if (!status) return 'notInstalled'
    switch (status) {
      case 'SERVICE_STOPPED':
        return 'stopped'
      case 'SERVICE_RUNNING':
        return 'running'
      case 'SERVICE_STOP_PENDING':
        return 'stopping'
      case 'uninstalled':
        return 'notInstalled'
      default:
        return 'unknown'
    }
  }

  // ===== Web 配置专属（config-server，仅桌面端） =====

  // --- Mock Web 函数 ---
  const mockReadWebConfigList = async (): Promise<FormWebData[]> => {
    return JSON.parse(JSON.stringify(mockWebConfigList.value))
  }
  const mockWriteWebConfigList = async (list: FormWebData[]): Promise<void> => {
    mockWebConfigList.value = JSON.parse(JSON.stringify(list))
    saveMockJson(MOCK_WEB_CONFIGS_KEY, mockWebConfigList.value)
  }
  const mockGetRunningWebProcesses = async (): Promise<any[]> => {
    return Array.from(mockWebRunningMap.value.entries()).map(([name, pid]) => ({
      name: 'easytier-core',
      commandLine: `easytier-core --config-server udp://mock-host:22020/${name}`,
      path: 'C:\\Program Files\\easytier\\easytier-core.exe',
      pid,
      fileName: name
    }))
  }
  const mockRunEasyTierCoreWeb = async (_url: string): Promise<any> => {
    return new Promise((resolve) => {
      // 模拟启动耗时，便于观察 UI 加载态
      setTimeout(() => {
        const key = _url.split('/').pop() || 'web-config'
        if (!mockWebRunningMap.value.has(key)) {
          mockWebRunningMap.value.set(key, ++mockWebPidCounter)
        }
        resolve(mockWebRunningMap.value.get(key))
      }, 800)
    })
  }

  // --- 环境分发 Web 函数 ---
  const getReadWebConfigList = () => {
    if (isMock) return mockReadWebConfigList
    return async (): Promise<FormWebData[]> => {
      const { readFileContent } = await import('@/utils/fileUtil')
      const { CONFIG_PATH, CONFIG_FILE_NAME } = await import('@/constants/easytier')
      const txt = (await readFileContent(CONFIG_PATH + '/' + CONFIG_FILE_NAME)) as string
      if (!txt) return []
      try {
        return JSON.parse(txt) || []
      } catch {
        return []
      }
    }
  }

  const getWriteWebConfigList = () => {
    if (isMock) return mockWriteWebConfigList
    return async (list: FormWebData[]): Promise<void> => {
      const { writeFileContent } = await import('@/utils/fileUtil')
      const { CONFIG_PATH, CONFIG_FILE_NAME } = await import('@/constants/easytier')
      await writeFileContent(CONFIG_PATH + '/' + CONFIG_FILE_NAME, JSON.stringify(list))
    }
  }

  const getRunningWebProcesses = () => {
    if (isMock) return mockGetRunningWebProcesses
    return async (): Promise<any[]> => {
      const { getRunningProcesses } = await import('@/utils/shellUtil')
      return getRunningProcesses('config-server')
    }
  }

  const getRunEasyTierCoreWeb = () => {
    if (isMock) return mockRunEasyTierCoreWeb
    return async (url: string) => {
      const { runEasyTierCoreWeb } = await import('@/utils/shellUtil')
      return runEasyTierCoreWeb(url)
    }
  }

  const getCheckWebService = () => {
    if (isMock) return mockCheckService
    return async (configFileName: string) => {
      const { PREFIX_SVC_WEB } = await import('@/constants/easytier')
      const { detectServiceInstallMethod, checkServiceOnWindows, checkServiceWithOfficialCli } =
        await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC_WEB + configFileName
      const method = await detectServiceInstallMethod(serviceName)
      if (method === 'nssm') {
        const status = await checkServiceOnWindows(serviceName)
        return serviceStatusDict(status as string | boolean)
      } else if (method === 'official') {
        const status = await checkServiceWithOfficialCli(serviceName)
        return serviceStatusDict(status as string | boolean)
      }
      return 'notInstalled'
    }
  }

  const getInstallWebService = () => {
    if (isMock) return mockInstallService
    return async (configFileName: string, args: string, options?: any) => {
      const { PREFIX_SVC_WEB } = await import('@/constants/easytier')
      const { installServiceOnWindows } = await import('@/utils/shellUtil')
      const serviceName = PREFIX_SVC_WEB + configFileName
      const installOptions =
        options?.username && options?.password
          ? { username: options.username, password: options.password }
          : undefined
      return installServiceOnWindows(serviceName, args, installOptions) as Promise<boolean>
    }
  }

  const getUninstallWebService = () => {
    if (isMock) return mockUninstallService
    return async (configFileName: string) => {
      const { PREFIX_SVC_WEB } = await import('@/constants/easytier')
      const { uninstallServiceOnWindows } = await import('@/utils/shellUtil')
      return uninstallServiceOnWindows(PREFIX_SVC_WEB + configFileName) as Promise<boolean>
    }
  }

  const getStartWebService = () => {
    if (isMock) return mockStartService
    return async (configFileName: string) => {
      const { PREFIX_SVC_WEB } = await import('@/constants/easytier')
      const { startServiceOnWindows } = await import('@/utils/shellUtil')
      return startServiceOnWindows(PREFIX_SVC_WEB + configFileName) as Promise<boolean>
    }
  }

  const getStopWebService = () => {
    if (isMock) return mockStopService
    return async (configFileName: string) => {
      const { PREFIX_SVC_WEB } = await import('@/constants/easytier')
      const { stopServiceOnWindows } = await import('@/utils/shellUtil')
      return stopServiceOnWindows(PREFIX_SVC_WEB + configFileName) as Promise<boolean>
    }
  }

  return {
    isMock,
    mockRunningMap,
    listTomlFiles: getListTomlFiles(),
    readFileContent: getReadFileContent(),
    writeFileContent: getWriteFileContent(),
    deleteFileOrDir: getDeleteFileOrDir(),
    getHostname: getHostname(),
    getRunningProcesses: getRunningProcesses(),
    checkPortConflicts: getCheckPortConflicts(),
    fetchRunningList: getFetchRunningList(),
    runEasyTierCore: getRunEasyTierCore(),
    killProcess: getKillProcess(),
    checkService: getCheckService(),
    installService: getInstallService(),
    uninstallService: getUninstallService(),
    startService: getStartService(),
    stopService: getStopService(),
    // Web 配置专属
    readWebConfigList: getReadWebConfigList(),
    writeWebConfigList: getWriteWebConfigList(),
    getRunningWebProcesses: getRunningWebProcesses(),
    runEasyTierCoreWeb: getRunEasyTierCoreWeb(),
    checkWebService: getCheckWebService(),
    installWebService: getInstallWebService(),
    uninstallWebService: getUninstallWebService(),
    startWebService: getStartWebService(),
    stopWebService: getStopWebService()
  }
}
