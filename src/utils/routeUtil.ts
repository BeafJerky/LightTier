/**
 * 出口节点路由管理（Windows 桌面专属）
 *
 * 核心流程：配置启用出口节点时，setExitRoute 把默认路由改经出口节点，
 * 并为出口节点公网 IP 添加直连路由（避免隧道自环）；停止时 clearExitRoute 反向清理。
 *
 * 可靠性设计：
 * - 命令结果严格校验（executeCmd 非零退出返回对象而非抛错），任一步失败立即回滚；
 * - 路由状态按配置名隔离（Map<configName, RouteEntry[]>），多出口配置互不覆盖；
 * - 原默认路由用 `route change` 改写 metric，清理时恢复原 metric，绝不删除系统默认路由；
 * - 记录落盘（version 2，多配置），崩溃/强杀后可检查残留并在启动时补清。
 */
import { error } from '@tauri-apps/plugin-log'
import { join } from '@tauri-apps/api/path'
import {
  checkRouteOnWindows,
  executeCmd,
  replaceLastWithZero,
  runEasyTierCli
} from '@/utils/shellUtil'
import { extractAllPublicIPs, processPeerData, readTextTail, routeCost } from '@/utils/easyTierUtil'
import {
  deleteFileOrDir,
  readFileContent,
  resolveKernelLogFile,
  writeFileContent
} from '@/utils/fileUtil'
import { PS_ADAPTER_FILTER_CLAUSE } from '@/utils/sysUtil'
import { isAndroid } from '@/utils/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { CONFIG_PATH, RESOURCE_PATH } from '@/constants/easytier'
import { isExitRouteEnabled } from '@/utils/lighttierConfigUtil'
import * as toml from 'smol-toml'

// === 5.9 退出节点路由（配置级开关驱动，迁移自旧版 views/index setExitRoute） ===

// kind: 'add' = 本应用新增、清理时删除；'default' = 原默认路由被 change 改写、清理时恢复 metric
interface RouteEntry {
  target: string
  mask: string
  gateway: string
  metric: number
  kind?: 'add' | 'default'
  originalMetric?: number
}

// 当前进程内各配置持有的路由（停止时只清理该配置自己的条目）
const routeEntriesByConfig = new Map<string, RouteEntry[]>()

// === 5.10 出口路由记录持久化：落盘后供启动补清/残留检查，崩溃或强杀不残留 ===
interface ExitRouteRecord {
  version: number
  configName: string
  entries: RouteEntry[]
  createdAt: number
  updatedAt: number
}

interface ExitRouteRecordFile {
  version: number
  records: ExitRouteRecord[]
}

const ROUTE_RECORD_FILE = 'exit-route-records.json'

const getRouteRecordPath = async () => join(RESOURCE_PATH, ROUTE_RECORD_FILE)

const normalizeEntries = (value: unknown): RouteEntry[] => {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is RouteEntry =>
      !!item &&
      typeof item === 'object' &&
      typeof item.target === 'string' &&
      typeof item.mask === 'string' &&
      typeof item.gateway === 'string' &&
      Number.isFinite(item.metric)
  )
}

const loadExitRouteRecords = async (): Promise<ExitRouteRecord[]> => {
  if (!isTauriEnv()) return []
  try {
    const raw = (await readFileContent(await getRouteRecordPath())) as string
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<ExitRouteRecordFile> & Partial<ExitRouteRecord>
    // version 2：多配置记录
    if (Array.isArray(parsed.records)) {
      return parsed.records
        .filter(
          (record): record is ExitRouteRecord =>
            !!record && typeof record.configName === 'string' && Array.isArray(record.entries)
        )
        .map((record) => ({
          ...record,
          entries: normalizeEntries(record.entries)
        }))
        .filter((record) => record.entries.length > 0)
    }
    // version 1：单条记录，向后兼容
    if (typeof parsed.configName === 'string' && Array.isArray(parsed.entries)) {
      const entries = normalizeEntries(parsed.entries)
      if (entries.length === 0) return []
      return [
        {
          version: 1,
          configName: parsed.configName,
          entries,
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
        }
      ]
    }
    return []
  } catch {
    return []
  }
}

const saveExitRouteRecords = async (records: ExitRouteRecord[]) => {
  if (!isTauriEnv()) return
  try {
    if (records.length === 0) {
      await clearExitRouteRecordFile()
      return
    }
    const payload: ExitRouteRecordFile = { version: 2, records }
    await writeFileContent(await getRouteRecordPath(), JSON.stringify(payload, null, 2))
  } catch (e) {
    error(`写入出口路由记录失败:${String(e)}`)
  }
}

const clearExitRouteRecordFile = async () => {
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

// 读取配置最新日志文本（供公网 IP 提取；优先新布局按配置隔离目录，回退旧版共享目录）
const readConfigLog = async (configName: string): Promise<string> => {
  try {
    const location = await resolveKernelLogFile(configName)
    if (!location) return ''
    return (await readFileContent(`${location.dir}/${location.file}`)) as string
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
      const res = await extractAllPublicIPs(readTextTail(log, i * 200))
      if (res && res.length > 0) return res
    }
    await sleep(2000)
  }
  return null
}

// executeCmd 成功返回 stdout 字符串，或空输出时返回 { code: 0 }；非零退出返回 { code: 非 0 }
const isCmdSuccess = (res: unknown): boolean => {
  if (typeof res === 'string') return true
  return !!res && typeof res === 'object' && (res as { code?: number }).code === 0
}

const toCmdError = (res: unknown): string => {
  if (res && typeof res === 'object') {
    const { msg, stderr, code } = res as { msg?: string; stderr?: string; code?: number }
    return msg || stderr || `退出码 ${code ?? '未知'}`
  }
  return String(res)
}

// 执行单条 route 命令；非零退出直接抛错（由调用方回滚）
const runRoute = async (args: string[]) => {
  const res = await executeCmd('route', args, { encoding: 'gbk' })
  if (!isCmdSuccess(res)) {
    throw new Error(`route ${args[0]} 失败：${toCmdError(res)}`)
  }
  return res
}

// 路由不存在 / 已被外部删除：删除命令会返回非零，但结果上已达成“清除”
const isMissingRouteError = (message: string): boolean =>
  /not\s*found|element\s*not\s*found|找不到|不存在|无法找到/i.test(message)

export interface ExitRouteResult {
  ok: boolean
  reason?: 'non-tauri' | 'no-exit' | 'precondition' | 'command' | 'read-failed' | 'disabled'
  message?: string
}

export interface ExitRouteClearResult {
  ok: boolean
  cleared: number
  failed: number
  failedEntries: RouteEntry[]
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

  // 同一配置重复启动：先清掉上一轮持有的路由，避免重复 add 与记录叠加
  const existing = await getEntriesForConfig(configName)
  if (existing.length > 0) {
    const cleared = await clearExitRoute(configName)
    if (!cleared.ok) {
      return { ok: false, reason: 'command', message: '清理旧出口路由失败' }
    }
  }

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

  // 记录原默认路由 metric：清理时用 route change 恢复，而不是 route delete
  const defaultRoute = (await listSystemRoutes()).find(
    (r) => r.target === '0.0.0.0' && r.mask === '0.0.0.0' && r.gateway === gateway
  )
  if (!defaultRoute) {
    error(`未找到默认路由快照（gateway=${gateway}），跳过出口路由改写以避免无法恢复`)
    return { ok: false, reason: 'precondition' }
  }

  const attempted: RouteEntry[] = []
  const systemRoutes = await listSystemRoutes()
  const hasExactRoute = (target: string, mask: string, routeGateway: string) =>
    systemRoutes.some((r) => r.target === target && r.mask === mask && r.gateway === routeGateway)

  try {
    // 1) 降低原默认路由优先级（保留原 metric，供停止时恢复）
    await runRoute(['change', '0.0.0.0', 'mask', '0.0.0.0', gateway, 'metric', '30'])
    attempted.push({
      target: '0.0.0.0',
      mask: '0.0.0.0',
      gateway,
      metric: 30,
      kind: 'default',
      originalMetric: defaultRoute.metric
    })

    // 2) 出口节点公网 IP 直连（避免隧道自环）
    for (const publicIp of publicIps) {
      if (hasExactRoute(publicIp, '255.255.255.255', gateway)) continue
      await runRoute(['add', publicIp, 'mask', '255.255.255.255', gateway, 'metric', '1'])
      attempted.push({
        target: publicIp,
        mask: '255.255.255.255',
        gateway,
        metric: 1,
        kind: 'add'
      })
    }

    // 3) 默认流量改走出口节点
    if (!hasExactRoute('0.0.0.0', '0.0.0.0', exitNodeIp)) {
      await runRoute(['add', '0.0.0.0', 'mask', '0.0.0.0', exitNodeIp, 'metric', '5'])
      attempted.push({
        target: '0.0.0.0',
        mask: '0.0.0.0',
        gateway: exitNodeIp,
        metric: 5,
        kind: 'add'
      })
    }
  } catch (e) {
    error(`添加出口路由失败，开始回滚：${String(e)}`)
    await rollbackEntries(attempted)
    return {
      ok: false,
      reason: 'command',
      message: e instanceof Error ? e.message : String(e)
    }
  }

  routeEntriesByConfig.set(
    configName,
    attempted.map((r) => ({ ...r }))
  )
  const records = await loadExitRouteRecords()
  const now = Date.now()
  const nextRecords = records.filter((r) => r.configName !== configName)
  nextRecords.push({
    version: 2,
    configName,
    entries: attempted.map((r) => ({ ...r })),
    createdAt: now,
    updatedAt: now
  })
  await saveExitRouteRecords(nextRecords)
  return { ok: true }
}

interface RouteDeleteResult {
  cleared: number
  failed: number
  failedEntries: RouteEntry[]
}

// 精确清理一批条目：新增路由按网关删除；被改写的默认路由只恢复原 metric
const deleteRouteEntries = async (entries: RouteEntry[]): Promise<RouteDeleteResult> => {
  let cleared = 0
  let failed = 0
  const failedEntries: RouteEntry[] = []
  for (const r of [...entries].reverse()) {
    try {
      if (r.kind === 'default') {
        if (typeof r.originalMetric !== 'number') {
          throw new Error('缺少原默认路由 metric，拒绝删除系统默认路由')
        }
        await runRoute([
          'change',
          '0.0.0.0',
          'mask',
          '0.0.0.0',
          r.gateway,
          'metric',
          String(r.originalMetric)
        ])
      } else {
        try {
          await runRoute(['delete', r.target, 'mask', r.mask, r.gateway])
        } catch (e) {
          if (isMissingRouteError(e instanceof Error ? e.message : String(e))) {
            cleared++
            continue
          }
          throw e
        }
      }
      cleared++
    } catch (e) {
      error(`删除路由失败:${String(e)}`)
      failed++
      failedEntries.push(r)
    }
  }
  return { cleared, failed, failedEntries }
}

// 启动中途失败：按已执行条目反向回滚（默认路由恢复 metric）
const rollbackEntries = async (entries: RouteEntry[]): Promise<void> => {
  if (entries.length === 0) return
  const { failed } = await deleteRouteEntries(entries)
  if (failed > 0) error(`出口路由回滚未完全成功：剩余 ${failed} 条`)
}

// 读取某配置当前持有的条目（先查内存，再回退持久化记录）
const getEntriesForConfig = async (configName: string): Promise<RouteEntry[]> => {
  const inMemory = routeEntriesByConfig.get(configName)
  if (inMemory && inMemory.length > 0) return inMemory
  const record = (await loadExitRouteRecords()).find((r) => r.configName === configName)
  return record?.entries ?? []
}

/**
 * 清除指定配置的退出节点路由（不传 configName 时清理所有记录，供升级/强停场景使用）。
 * 清理失败时保留失败条目，便于用户重试或残留检查。
 */
export const clearExitRoute = async (configName?: string): Promise<ExitRouteClearResult> => {
  if (!isTauriEnv()) return { ok: false, cleared: 0, failed: 0, failedEntries: [] }
  const records = await loadExitRouteRecords()
  const targetNames = configName
    ? [configName]
    : [...new Set([...routeEntriesByConfig.keys(), ...records.map((r) => r.configName)])]
  if (targetNames.length === 0) {
    return { ok: true, cleared: 0, failed: 0, failedEntries: [] }
  }

  let cleared = 0
  let failed = 0
  const failedEntries: RouteEntry[] = []
  const nextRecords = [...records]

  for (const name of targetNames) {
    const recordIndex = nextRecords.findIndex((r) => r.configName === name)
    const entries = routeEntriesByConfig.get(name) ?? nextRecords[recordIndex]?.entries ?? []
    if (entries.length === 0) {
      routeEntriesByConfig.delete(name)
      if (recordIndex >= 0) nextRecords.splice(recordIndex, 1)
      continue
    }
    const result = await deleteRouteEntries(entries)
    cleared += result.cleared
    failed += result.failed
    failedEntries.push(...result.failedEntries)
    if (result.failedEntries.length > 0) {
      routeEntriesByConfig.set(name, result.failedEntries)
      if (recordIndex >= 0) {
        nextRecords[recordIndex] = {
          ...nextRecords[recordIndex],
          entries: result.failedEntries,
          updatedAt: Date.now()
        }
      } else {
        nextRecords.push({
          version: 2,
          configName: name,
          entries: result.failedEntries,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
    } else {
      routeEntriesByConfig.delete(name)
      if (recordIndex >= 0) nextRecords.splice(recordIndex, 1)
    }
  }

  await saveExitRouteRecords(nextRecords)
  return { ok: failed === 0, cleared, failed, failedEntries }
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
  const exitEntry = record.entries.find(
    (e) => e.kind !== 'default' && e.target === '0.0.0.0' && e.metric === 5
  )
  if (!exitEntry) return false
  const inUse = await checkRouteOnWindows(replaceLastWithZero(exitEntry.gateway))
  return inUse === true
}

/**
 * 按条目精确比对系统路由表（纯函数，便于单测）：
 * - 目标/掩码之外必须网关与 metric 都一致才算“仍在使用”；
 * - 默认路由（kind=default）是原路由改 metric，恢复后同网关但 metric 回到 originalMetric，
 *   应归为已清理，不能因为系统里还有同目标路由就报“可疑”；
 * - 新增路由同目标同网关但 metric 不同，说明被外部改过，归为可疑。
 */
export const classifyRouteResidue = (
  records: ExitRouteRecord[],
  sys: RouteEntry[]
): ExitRouteCheckResult => {
  const result: ExitRouteCheckResult = { active: [], missing: [], suspicious: [] }
  for (const record of records) {
    for (const r of record.entries) {
      const exact = sys.find(
        (s) =>
          s.target === r.target &&
          s.mask === r.mask &&
          s.gateway === r.gateway &&
          s.metric === r.metric
      )
      if (exact) {
        result.active.push(r)
        continue
      }
      const sameGateway = sys.find(
        (s) => s.target === r.target && s.mask === r.mask && s.gateway === r.gateway
      )
      if (!sameGateway) {
        result.missing.push(r)
      } else if (r.kind === 'default' && sameGateway.metric === r.originalMetric) {
        result.missing.push(r)
      } else {
        result.suspicious.push(r)
      }
    }
  }
  return result
}

/**
 * 残留检查：对比持久化记录与系统路由表。
 * 只报告本应用添加/改写过的条目；系统表中记录外的路由不归属本应用，一律不动。
 */
export const checkExitRouteResidue = async (): Promise<ExitRouteCheckResult> => {
  const empty: ExitRouteCheckResult = { active: [], missing: [], suspicious: [] }
  if (!isTauriEnv()) return empty
  const records = await loadExitRouteRecords()
  if (records.length === 0) return empty
  return classifyRouteResidue(records, await listSystemRoutes())
}

/**
 * 按持久化记录精确清理残留，成功后清空记录。
 * force=false（启动补清）：先验证 exit 网段路由已消失——仍在则说明节点/虚拟网卡还在，路由可能被使用，跳过；
 * force=true（用户确认清理）：跳过该判据，直接按记录清理。
 */
export const cleanExitRouteResidue = async (
  force = false
): Promise<{ skipped: boolean; cleared: number; failed: number }> => {
  if (!isTauriEnv()) return { skipped: true, cleared: 0, failed: 0 }
  const records = await loadExitRouteRecords()
  if (records.length === 0) return { skipped: true, cleared: 0, failed: 0 }

  let cleared = 0
  let failed = 0
  let skippedCount = 0
  const nextRecords: ExitRouteRecord[] = []

  for (const record of records) {
    if (!force && (await isExitRouteInUse(record))) {
      skippedCount++
      nextRecords.push(record)
      continue
    }
    const result = await deleteRouteEntries(record.entries)
    cleared += result.cleared
    failed += result.failed
    routeEntriesByConfig.delete(record.configName)
    if (result.failedEntries.length > 0) {
      nextRecords.push({
        ...record,
        entries: result.failedEntries,
        updatedAt: Date.now()
      })
      routeEntriesByConfig.set(record.configName, result.failedEntries)
    }
  }

  await saveExitRouteRecords(nextRecords)
  return {
    skipped: skippedCount === records.length,
    cleared,
    failed
  }
}

/**
 * 启动成功后按配置文件内容应用出口路由（概览页 / 配置页共用）。
 * @param configName 配置名（不带 .toml，作为路由归属键）
 * @param fileName 配置文件名（带 .toml；缺省按 configName 推导）
 */
export const applyExitRouteFromFile = async (
  configName: string,
  fileName?: string
): Promise<ExitRouteResult> => {
  if (!isTauriEnv()) return { ok: false, reason: 'non-tauri' }
  try {
    const raw = (await readFileContent(
      `${CONFIG_PATH}/${fileName || `${configName}.toml`}`
    )) as string
    if (!raw) return { ok: false, reason: 'read-failed' }
    const cfg = toml.parse(raw) as Record<string, any>
    if (!isExitRouteEnabled(cfg)) return { ok: false, reason: 'disabled' }
    return await setExitRoute(cfg, configName)
  } catch (e) {
    error(`读取配置出口路由标记失败:${String(e)}`)
    return { ok: false, reason: 'read-failed' }
  }
}
