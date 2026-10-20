/**
 * 出口节点路由管理（Windows 桌面专属）
 *
 * 核心流程：配置启用出口节点时，setExitRoute 把默认路由改经出口节点，
 * 并为出口节点公网 IP 添加直连路由（避免隧道自环）；停止时 clearExitRoute 反向删除。
 *
 * 可靠性设计（5.10）：
 * - 添加的路由条目落盘持久化，崩溃/强杀后可
 *   checkExitRouteResidue 检查残留、cleanExitRouteResidue 启动补清
 * - 删除时带网关匹配，避免误删同目标的其他路由；0.0.0.0/0 绝不裸删
 */
import { error } from '@tauri-apps/plugin-log'
import { join } from '@tauri-apps/api/path'
import {
  checkRouteOnWindows,
  executeCmd,
  replaceLastWithZero,
  runEasyTierCli
} from '@/utils/shellUtil'
import {
  extractAllPublicIPs,
  processPeerData,
  readTextReverse,
  routeCost
} from '@/utils/easyTierUtil'
import { deleteFileOrDir, listFiles, readFileContent, writeFileContent } from '@/utils/fileUtil'
import { pickLogTarget } from '@/utils/coreLogUtil'
import { PS_ADAPTER_FILTER_CLAUSE } from '@/utils/sysUtil'
import { isAndroid } from '@/utils/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { LOG_PATH, RESOURCE_PATH } from '@/constants/easytier'

// === 5.9 退出节点路由（配置级开关驱动，迁移自旧版 views/index setExitRoute） ===

// 最近一次 setExitRoute 添加的路由（停止时反向删除，不残留）
interface RouteEntry {
  target: string
  mask: string
  gateway: string
  metric: number
}
let lastAdded: RouteEntry[] = []

// === 5.10 出口路由记录持久化：落盘后供启动补清/残留检查，崩溃或强杀不残留 ===
interface ExitRouteRecord {
  version: number
  configName: string
  entries: RouteEntry[]
  createdAt: number
  updatedAt: number
}

const ROUTE_RECORD_FILE = 'exit-route-records.json'

const getRouteRecordPath = async () => join(RESOURCE_PATH, ROUTE_RECORD_FILE)

const loadExitRouteRecord = async (): Promise<ExitRouteRecord | null> => {
  if (!isTauriEnv()) return null
  try {
    const raw = (await readFileContent(await getRouteRecordPath())) as string
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.entries)) return null
    return parsed as ExitRouteRecord
  } catch {
    return null
  }
}

const saveExitRouteRecord = async (record: ExitRouteRecord) => {
  if (!isTauriEnv()) return
  try {
    await writeFileContent(await getRouteRecordPath(), JSON.stringify(record, null, 2))
  } catch (e) {
    error(`写入出口路由记录失败:${String(e)}`)
  }
}

const clearExitRouteRecord = async () => {
  if (!isTauriEnv()) return
  try {
    await deleteFileOrDir(await getRouteRecordPath())
  } catch {
    /* 文件不存在等，忽略 */
  }
}

// 出口节点路由为 Windows 桌面专属能力（route 命令 / PowerShell / Winsock），Android 一律视为非适用环境
// withGlobalTauri 已关闭，统一用 @tauri-apps/api 的 isTauri() 检测
const isTauriEnv = () => {
  try {
    return isTauriRuntime() && !isAndroid()
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 轮询重试：直到 fn 返回真值或达到重试上限（上限后返回 null）
const retryGet = async (fn: () => Promise<string | boolean | null>, maxRetry = 10) => {
  for (let i = 0; i < maxRetry; i++) {
    const res = await fn()
    if (res) return res
    await sleep(2000)
  }
  return null
}

// 读取配置最新日志文本（供公网 IP 提取；目标文件选择与 LogViewer 同源，详见 coreLogUtil）
const readConfigLog = async (configName: string): Promise<string> => {
  try {
    const files = await listFiles(LOG_PATH)
    const target = pickLogTarget(files, configName)
    return (await readFileContent(`${LOG_PATH}/${target}`)) as string
  } catch {
    return ''
  }
}

const getDefaultGateway = async (): Promise<string | null> => {
  try {
    const res = await executeCmd('powershell', [
      '-NoProfile',
      '-Command',
      `Get-NetIPConfiguration | Where-Object {${PS_ADAPTER_FILTER_CLAUSE}} | Sort-Object -Property InterfaceMetric | Select-Object -First 1 -ExpandProperty IPv4DefaultGateway | Select-Object -ExpandProperty NextHop`
    ])
    const match = typeof res === 'string' ? res.match(/\d+\.\d+\.\d+\.\d+/) : null
    return match ? match[0] : null
  } catch (e) {
    error(`获取网关失败:${String(e)}`)
    return null
  }
}

// 从日志提取公网 IP（重试 5 次，读取窗口逐次放大）
const getPublicIps = async (configName: string): Promise<string[] | null> => {
  for (let i = 1; i <= 5; i++) {
    const log = await readConfigLog(configName)
    if (log) {
      const res = await extractAllPublicIPs(readTextReverse(log, i * 200))
      if (res && res.length > 0) return res
    }
    await sleep(2000)
  }
  return null
}

// 执行单条 route 命令（method：change 改默认路由 / add 增补路由）
const addRouteSeq = async (
  method: string,
  target: string,
  mask: string,
  gateway: string,
  metric: number
) => {
  await executeCmd('route', [method, target, 'mask', mask, gateway, 'metric', String(metric)], {
    encoding: 'gbk'
  })
}

export interface ExitRouteResult {
  ok: boolean
  reason?: 'non-tauri' | 'no-exit' | 'precondition'
}

/**
 * 设置退出节点路由（配置级开关驱动）：
 * 网关检测 + 打洞等待 + 公网 IP 提取均保留旧版语义；peers 获取失败时跳过打洞等待直接尝试。
 */
export const setExitRoute = async (
  config: Record<string, any>,
  configName: string
): Promise<ExitRouteResult> => {
  if (!isTauriEnv()) return { ok: false, reason: 'non-tauri' }
  const exitNodes = config.exit_nodes
  if (!Array.isArray(exitNodes) || exitNodes.length === 0) return { ok: false, reason: 'no-exit' }
  const exitNodeIp = String(exitNodes[0] || '').split('/')[0]
  if (!exitNodeIp) return { ok: false, reason: 'no-exit' }

  // 获取 peers（尽力而为；失败时后续跳过打洞等待）
  let peers: any[] = []
  try {
    const portal = config.rpc_portal || '0.0.0.0:15888'
    const res = await runEasyTierCli(['-p', portal, '--output', 'json', 'peer'])
    const parsed = typeof res === 'string' ? JSON.parse(res) : res
    if (Array.isArray(parsed)) peers = processPeerData(parsed)
  } catch {
    /* peers 不可用 */
  }

  const localNode = peers.find((v) => v.cost === routeCost('Local'))
  const gatewayResult = await retryGet(getDefaultGateway)
  const gateway = typeof gatewayResult === 'string' ? gatewayResult : null

  const waitHolePunching = async (): Promise<boolean> => {
    if (peers.length === 0) return true // 无 peer 信息时直接尝试
    const hp = config.flags?.disable_udp_hole_punching
    const exitNode = peers.find((v) => v.ipv4 === exitNodeIp)
    if (!hp && exitNode?.cost === routeCost('p2p')) return true
    if (hp && exitNode?.cost === routeCost('relay')) return true
    return false
  }
  const waitHole = await retryGet(waitHolePunching)
  const publicIps = await getPublicIps(configName)

  const canSet = Boolean(
    exitNodeIp &&
    gateway &&
    publicIps?.length &&
    waitHole === true &&
    (!localNode || (await checkRouteOnWindows(localNode.ipv4)))
  )
  // 显式收窄类型（Boolean() 检查不会缩小 TS 类型）
  if (!canSet || !gateway || !publicIps) return { ok: false, reason: 'precondition' }

  // 等待退出网段路由出现（最长 20s）
  let exitRouteExists = false
  for (let i = 0; i < 10; i++) {
    if (await checkRouteOnWindows(replaceLastWithZero(exitNodeIp))) {
      exitRouteExists = true
      break
    }
    await sleep(2000)
  }
  if (!exitRouteExists) return { ok: false, reason: 'precondition' }

  // 按顺序添加路由（之间不跳过）
  lastAdded = []
  await addRouteSeq('change', '0.0.0.0', '0.0.0.0', gateway, 30)
  lastAdded.push({ target: '0.0.0.0', mask: '0.0.0.0', gateway, metric: 30 })
  for (const publicIp of publicIps) {
    await addRouteSeq('add', publicIp, '255.255.255.255', gateway, 1)
    lastAdded.push({ target: publicIp, mask: '255.255.255.255', gateway, metric: 1 })
  }
  await addRouteSeq('add', '0.0.0.0', '0.0.0.0', exitNodeIp, 5)
  lastAdded.push({ target: '0.0.0.0', mask: '0.0.0.0', gateway: exitNodeIp, metric: 5 })
  // 5.10：落盘记录，供重启后残留检查与启动补清
  await saveExitRouteRecord({
    version: 1,
    configName,
    entries: lastAdded.map((r) => ({ ...r })),
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  return { ok: true }
}

// 精确删除一批路由（带网关匹配，避免误删同目标的其他路由；0.0.0.0/0 绝不裸删）
const deleteRouteEntries = async (
  entries: RouteEntry[]
): Promise<{ cleared: number; failed: number }> => {
  let cleared = 0
  let failed = 0
  for (const r of [...entries].reverse()) {
    try {
      await executeCmd('route', ['delete', r.target, 'mask', r.mask, r.gateway], {
        encoding: 'gbk'
      })
      cleared++
    } catch (e) {
      error(`删除路由失败:${String(e)}`)
      failed++
    }
  }
  return { cleared, failed }
}

/**
 * 清除退出节点路由：按最近一次添加的条目反向删除，不残留。
 */
export const clearExitRoute = async (): Promise<boolean> => {
  if (!isTauriEnv()) return false
  const { failed } = await deleteRouteEntries(lastAdded)
  lastAdded = []
  await clearExitRouteRecord()
  return failed === 0
}

// === 5.10 残留检查与启动补清 ===

export interface ExitRouteCheckResult {
  active: RouteEntry[] // 记录条目仍精确存在于系统路由表（可能正在使用）
  missing: RouteEntry[] // 记录条目已不在系统路由表（已清除/手动删除）
  suspicious: RouteEntry[] // 系统表中目标相同但网关/metric 与记录不符（被外部修改）
}

// 读取系统 IPv4 路由表（route print -4，取四段 IP + 跃点数行；"在链路上"行自然跳过）
const listSystemRoutes = async (): Promise<RouteEntry[]> => {
  try {
    const res = await executeCmd('route', ['print', '-4'], { encoding: 'gbk' })
    if (typeof res !== 'string') return []
    const entries: RouteEntry[] = []
    const linePattern =
      /^\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+\d+\.\d+\.\d+\.\d+\s+(\d+)\s*$/
    for (const line of res.split(/\r?\n/)) {
      const m = line.match(linePattern)
      if (m) {
        entries.push({ target: m[1], mask: m[2], gateway: m[3], metric: parseInt(m[4], 10) })
      }
    }
    return entries
  } catch {
    return []
  }
}

// 出口路由是否仍在使用：exit 节点网段路由由 wintun 驱动托管，存在即虚拟网卡/核心仍在
const isExitRouteInUse = async (record: ExitRouteRecord): Promise<boolean> => {
  const exitEntry = record.entries.find((e) => e.target === '0.0.0.0' && e.metric === 5)
  if (!exitEntry) return false
  const inUse = await checkRouteOnWindows(replaceLastWithZero(exitEntry.gateway))
  return inUse === true
}

/**
 * 残留检查：对比持久化记录与系统路由表。
 * 只报告本应用添加过的条目；系统表中记录外的路由不归属本应用，一律不动。
 */
export const checkExitRouteResidue = async (): Promise<ExitRouteCheckResult> => {
  const empty: ExitRouteCheckResult = { active: [], missing: [], suspicious: [] }
  if (!isTauriEnv()) return empty
  const record = await loadExitRouteRecord()
  if (!record || record.entries.length === 0) return empty
  const sys = await listSystemRoutes()
  const active: RouteEntry[] = []
  const missing: RouteEntry[] = []
  const suspicious: RouteEntry[] = []
  for (const r of record.entries) {
    const match = sys.find((s) => s.target === r.target && s.mask === r.mask)
    if (!match) {
      missing.push(r)
    } else if (match.gateway === r.gateway && match.metric === r.metric) {
      active.push(r)
    } else {
      suspicious.push(r)
    }
  }
  return { active, missing, suspicious }
}

/**
 * 按持久化记录精确清理残留，成功后清空记录。
 * force=false（启动补清）：先验证 exit 网段路由已消失——仍在则说明节点/虚拟网卡还在，路由可能被使用，跳过；
 * force=true（用户确认清理）：跳过该判据，直接按记录删除。
 */
export const cleanExitRouteResidue = async (
  force = false
): Promise<{ skipped: boolean; cleared: number; failed: number }> => {
  if (!isTauriEnv()) return { skipped: true, cleared: 0, failed: 0 }
  const record = await loadExitRouteRecord()
  if (!record || record.entries.length === 0) return { skipped: true, cleared: 0, failed: 0 }
  if (!force && (await isExitRouteInUse(record))) {
    return { skipped: true, cleared: 0, failed: 0 }
  }
  const { cleared, failed } = await deleteRouteEntries(record.entries)
  lastAdded = []
  await clearExitRouteRecord()
  return { skipped: false, cleared, failed }
}
