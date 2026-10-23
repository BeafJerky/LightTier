/**
 * 内核操作统一抽象层 —— 视图只依赖此层，屏蔽平台差异
 *
 * - 桌面（Windows/Linux/macOS）：easytier-core 子进程 + easytier-cli（shellUtil.ts），行为与改造前一致
 * - Android：easytier 内核进程内运行（android/mod.rs 命令 + mobileVpn.ts VPN 编排）
 * - 浏览器 mock：复用 useMockData 的 mock 实现，pnpm dev 不受影响
 */
import { invoke, isTauri } from '@tauri-apps/api/core'
import { DEFAULT_CORE_VERSION } from '@/constants/kernelCompat'
import { useMockData } from '@/hooks/useMockData'
import { isAndroid } from './platformUtil'
import { startMobileVpn, stopMobileVpn, type RunningInstance } from './mobileVpn'
import { t } from '@/utils/i18nUtil'

/** 非 Android 实现（Tauri 桌面走 shellUtil，浏览器走 mock；由 useMockData 分发） */
let baseImpl: ReturnType<typeof useMockData> | null = null
const base = () => {
  if (!baseImpl) baseImpl = useMockData()
  return baseImpl
}

/** 桌面 CLI 输出为 JSON 字符串，统一解析为对象 */
const parseCliJson = (res: unknown): any => {
  if (typeof res === 'string' && res.trim()) {
    try {
      return JSON.parse(res)
    } catch {
      return null
    }
  }
  return null
}

/** RPC 地址归一：0.0.0.0 是服务端绑定地址，CLI 客户端需连 127.0.0.1 */
const desktopRpcPortal = (item: RunningItem): string =>
  (item.rpcPortal || '127.0.0.1:15888').replace('0.0.0.0', '127.0.0.1')

/** 列出配置文件名（含 .toml 后缀；Tauri 各平台均为 app 数据目录下 config/） */
export const listConfigs = async (): Promise<string[]> => {
  return base().listTomlFiles()
}

/**
 * 启动配置（Android：内核实例 + VPN 接管；桌面：拉起 easytier-core 子进程）
 * Android 单实例约束（停旧起新与二次确认）由调用方负责
 */
export const startConfig = async (fileName: string): Promise<void> => {
  // ?platform=android 浏览器预览无 Tauri 运行时，回退 mock 实现
  if (isAndroid() && isTauri()) {
    await startMobileVpn(fileName)
    return
  }
  const pid = await base().runEasyTierCore(fileName)
  // 桌面实现已校验，这里再兜底一次：无有效 PID 视为启动失败，禁止上层写入运行态
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(t('newCommon.coreStartInvalidPid'))
  }
}

/**
 * 停止配置（Android：停 VPN + 内核实例；桌面：结束子进程）
 * @returns 是否停止成功（无 pid 的残留项视为成功，由调用方清理 UI 状态）
 */
export const stopConfig = async (item: RunningItem): Promise<boolean> => {
  if (isAndroid() && isTauri()) {
    return await stopMobileVpn(true)
  }
  // 持久化恢复的记录会清空 PID（PID 可能已被系统复用）：按配置名重新扫描定位真实进程
  if (!item.pid || !Number.isInteger(item.pid) || item.pid <= 0) {
    const fresh = (await base().fetchRunningList([item.configFileName])).find(
      (i) => i.configFileName === item.configFileName
    )
    if (fresh?.pid) return base().killProcess(fresh.pid)
    // 没有对应进程：视为已停止，由调用方清理 UI 状态
    return true
  }
  return base().killProcess(item.pid)
}

/** 运行中列表（Android 来自进程内实例管理器，含虚拟 IP；桌面来自进程扫描） */
export const getRunningList = async (configNames: string[]): Promise<RunningItem[]> => {
  if (isAndroid() && isTauri()) {
    const list = await invoke<RunningInstance[]>('list_instances')
    return list
      .filter((i) => i.running && i.config_file)
      .map((i) => {
        const fileName = String(i.config_file)
        return {
          configFileName: fileName.replace(/\.toml$/, ''),
          fileName,
          instanceId: i.instance_id,
          virtualIp: i.virtual_ipv4 ? i.virtual_ipv4.split('/')[0] : undefined
        }
      })
  }
  return base().fetchRunningList(configNames)
}

/** 查询节点信息（与 `easytier-cli --output json node` 结构一致） */
export const queryNode = async (item: RunningItem): Promise<any> => {
  if (isAndroid()) {
    // Android 单实例模型：instance_id 可省略（Rust 侧自动选择唯一实例）
    const args = item.instanceId ? { instance_id: item.instanceId } : {}
    return await invoke('query_node', args)
  }
  const { runEasyTierCli } = await import('./shellUtil')
  const res = await runEasyTierCli(['-p', desktopRpcPortal(item), '--output', 'json', 'node'])
  return parseCliJson(res)
}

/**
 * 查询对等节点列表（与 `easytier-cli --output json peer` 结构一致，首项为本地节点）
 * @returns 节点数组；null 表示查询失败（CLI 偶发 RPC 超时），调用方应保留上一份快照
 */
export const queryPeer = async (item: RunningItem): Promise<any[] | null> => {
  if (isAndroid()) {
    const args = item.instanceId ? { instance_id: item.instanceId } : {}
    const res = await invoke('query_peer', args)
    return Array.isArray(res) ? res : null
  }
  const { runEasyTierCli } = await import('./shellUtil')
  const res = await runEasyTierCli(['-p', desktopRpcPortal(item), '--output', 'json', 'peer'])
  const parsed = parseCliJson(res)
  return Array.isArray(parsed) ? parsed : null
}

/** 启动前端口冲突预检（Android 单实例模型无并行配置，恒无冲突） */
export const checkPortConflicts = async (fileName: string): Promise<PortConflict[]> => {
  if (isAndroid()) return []
  return base().checkPortConflicts(fileName)
}

/** 内核版本（Android：内置内核编译版本；桌面：easytier-cli -V；浏览器 mock：默认稳定版本） */
export const getCoreVersion = async (): Promise<string> => {
  // 浏览器（pnpm dev）无 Tauri 运行时：返回默认稳定版本，便于预览版本适配后的表单/提示
  // 必须先于平台分支判断：dev 下 ?platform=android 仅切换布局，Tauri 命令不可用
  if (!isTauri()) return DEFAULT_CORE_VERSION
  if (isAndroid()) {
    return await invoke<string>('get_core_version')
  }
  const { runEasyTierCli } = await import('./shellUtil')
  const res = await runEasyTierCli(['-V'])
  return String(res).trim()
}
