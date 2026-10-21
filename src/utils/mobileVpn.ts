/**
 * Android VPN 编排（对标官方 easytier-gui mobile_vpn.ts，单实例模型简化）
 *
 * 启动序列：起实例（进入运行态即成功）→ 后台等虚拟 IPv4/网段 → prepare 授权 → start_vpn → 插件事件回调注入 TUN fd
 * 停止序列：stop_vpn → 停实例
 * 仅在 Android 平台调用（桌面端走子进程模型，见 shellUtil.ts）
 */
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core'
import { error, info, warn } from '@tauri-apps/plugin-log'
import * as toml from 'smol-toml'
import { CONFIG_PATH } from '@/constants/easytier'
import { useCreamToast } from '@/hooks/useCreamToast'
import { useEasyTierStore } from '@/store/modules/easytier'
import { t } from '@/utils/i18nUtil'
import { readFileContent } from './fileUtil'
import { sleep } from './sysUtil'

// 本应用包名（VPN 排除自身流量，避免回环）
const APP_PACKAGE = 'com.lighttier.app'
// magic dns 对内虚拟 DNS 地址
const MAGIC_DNS_IP = '100.100.100.101'
// 与官方移动端一致：TUN MTU 1300（留出外层加密开销）
const VPN_MTU = 1300
// 实例进入运行态的等待窗口（保证启动反馈及时；虚拟 IP 与 VPN 接管在后台进行）
const POLL_INTERVAL = 500
const INSTANCE_READY_TIMEOUT_MS = 15000
// 后台等待虚拟 IP 并接入 VPN（对齐官方 mobile_vpn.ts：DHCP 未就绪时持续重试，不视为启动失败）
const VPN_ATTACH_POLL_INTERVAL = 2000
const VPN_ATTACH_TIMEOUT_MS = 120000
// 等待 VPN 服务起来的事件超时
const VPN_START_TIMEOUT_MS = 3000

/** 与 Rust 侧 list_instances 返回结构一致 */
export interface RunningInstance {
  instance_id: string
  config_file: string | null
  instance_name: string
  network_name: string
  running: boolean
  /** "10.126.126.1/24"，实例未就绪时为 null */
  virtual_ipv4: string | null
  error_msg: string | null
}

/** VPN 运行状态（前端镜像） */
export interface VpnRuntimeStatus {
  running: boolean
  ipv4Addr?: string
  cidr?: number
  routes: string[]
  dns?: string
}

/** 从 TOML 解析出的 VPN 相关字段 */
interface NetworkConfig {
  noTun: boolean
  dhcp: boolean
  magicDns: boolean
  routes: string[]
}

export interface StartMobileVpnResult {
  instanceId: string
  /** 本次调用是否已完成 VPN 接管（no_tun 或后台等待中为 false，后续接入见 getVpnRuntimeStatus） */
  vpnStarted: boolean
}

const curStatus: VpnRuntimeStatus = { running: false, routes: [] }
let pluginListeners: PluginListener[] = []
// 后台 VPN 接管代际：启动/停止配置时自增，使旧的后台等待流程自动退出
let attachGen = 0

// ---------- VPN 服务事件（插件 → 前端） ----------

const onVpnServiceStart = async (payload: any) => {
  info(`VPN 服务已启动:${JSON.stringify(payload)}`)
  curStatus.running = true
  const fd = payload?.fd
  if (fd) {
    try {
      await invoke('set_tun_fd', { fd })
      info(`TUN fd 注入成功:${fd}`)
    } catch (e: any) {
      error(`TUN fd 注入失败:${JSON.stringify(e)}`)
    }
  }
}

const onVpnServiceStop = (payload: any) => {
  info(`VPN 服务已停止:${JSON.stringify(payload)}`)
  curStatus.running = false
  curStatus.ipv4Addr = undefined
  curStatus.cidr = undefined
  curStatus.routes = []
  curStatus.dns = undefined
}

/** 注册插件事件监听（幂等，应用启动时调用一次） */
export const registerMobileVpnListeners = async () => {
  if (pluginListeners.length) return
  pluginListeners.push(
    await addPluginListener('vpnservice', 'vpn_service_start', onVpnServiceStart)
  )
  pluginListeners.push(await addPluginListener('vpnservice', 'vpn_service_stop', onVpnServiceStop))
}

/** 注销插件事件监听（一般无需调用，保留给热重载等场景） */
export const unregisterMobileVpnListeners = async () => {
  for (const listener of pluginListeners) {
    await listener.unregister()
  }
  pluginListeners = []
}

// ---------- VPN 基础调用（插件命令） ----------

/** 申请 VPN 授权（系统弹框），返回是否已授权 */
export const requestVpnPermission = async (): Promise<boolean> => {
  const ret: any = await invoke('plugin:vpnservice|prepare_vpn', {})
  if (ret?.errorMsg) {
    throw new Error(ret.errorMsg)
  }
  return ret?.granted ?? true
}

/** 启动 VPN 服务（内部处理 need_prepare 授权重试；TUN fd 经事件回调注入） */
const doStartVpn = async (ipv4WithCidr: string, routes: string[], dns?: string) => {
  const request = {
    ipv4Addr: ipv4WithCidr,
    routes,
    dns,
    disallowedApplications: [APP_PACKAGE],
    mtu: VPN_MTU
  }
  info(`启动 VPN 服务:${JSON.stringify(request)}`)
  let ret: any = await invoke('plugin:vpnservice|start_vpn', { ...request })
  if (ret?.errorMsg === 'need_prepare') {
    // 未授权：走系统授权流程后重试
    const granted = await requestVpnPermission()
    if (!granted) {
      throw new Error('vpn_permission_denied')
    }
    ret = await invoke('plugin:vpnservice|start_vpn', { ...request })
  }
  if (ret?.errorMsg) {
    throw new Error(ret.errorMsg)
  }
  await waitVpnRunning(VPN_START_TIMEOUT_MS)
}

/** 等待 VPN 服务事件上报 running（超时抛 vpn_start_timeout） */
const waitVpnRunning = async (timeoutMs: number) => {
  const startTime = Date.now()
  while (!curStatus.running) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('vpn_start_timeout')
    }
    await sleep(50)
  }
}

/** 停止 VPN 服务（幂等）；stopInstance 为 true 时同时停掉内核实例（「停止配置」语义） */
export const stopMobileVpn = async (stopInstance = true): Promise<boolean> => {
  attachGen++ // 取消进行中的后台 VPN 接管
  let vpnStopped = true
  try {
    await invoke('plugin:vpnservice|stop_vpn', {})
  } catch (e: any) {
    vpnStopped = false
    warn(`停止 VPN 服务失败:${JSON.stringify(e)}`)
  }
  // 停止失败时保留本地运行态，避免 UI 误报已停止
  if (vpnStopped) onVpnServiceStop({})

  let instanceStopped = true
  if (stopInstance) {
    try {
      await invoke('stop_instance', {})
      info('内核实例已停止')
    } catch (e: any) {
      instanceStopped = false
      warn(`停止内核实例失败:${JSON.stringify(e)}`)
    }
  }
  return vpnStopped && instanceStopped
}

// ---------- 配置与路由组装 ----------

/** 读取配置 TOML 中的 VPN 相关字段（no_tun / dhcp / enable_magic_dns / routes） */
const readNetworkConfig = async (configFileName: string): Promise<NetworkConfig> => {
  const content = (await readFileContent(`${CONFIG_PATH}/${configFileName}`)) as string
  if (!content) {
    throw new Error(`config_not_found:${configFileName}`)
  }
  const config = toml.parse(content) as any
  return {
    // no_tun 属于 EasyTier 的 [flags] 段；顶层字段仅用于兼容历史误写配置
    noTun: config.flags?.no_tun === true || config.no_tun === true,
    dhcp: config.dhcp === true,
    magicDns: config.enable_magic_dns === true,
    routes: Array.isArray(config.routes) ? config.routes : []
  }
}

/**
 * 组装 VPN 路由（对标官方 getRoutesForVpn）：
 * 对端 proxy_cidrs（query_routes 返回的 Route.proxy_cidrs）+ 配置内 routes + magic dns 地址
 */
const buildVpnRoutes = (peerRoutes: any[], config: NetworkConfig): string[] => {
  const routes: string[] = []
  for (const route of peerRoutes) {
    for (let cidr of route?.proxy_cidrs ?? []) {
      if (!cidr.includes('/')) {
        cidr += '/32'
      }
      routes.push(cidr)
    }
  }
  config.routes.forEach((route) => routes.push(route))
  if (config.magicDns) {
    routes.push(`${MAGIC_DNS_IP}/32`)
  }
  return Array.from(new Set(routes)).sort()
}

/** 轮询等待实例进入运行态；实例带 error_msg（已启动失败）时提前返回 */
const waitInstanceRunning = async (
  instanceId: string,
  timeoutMs: number
): Promise<RunningInstance | null> => {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    try {
      const list = (await invoke('list_instances')) as RunningInstance[]
      const instance = list.find((item) => item.instance_id === instanceId)
      if (instance?.error_msg || instance?.running) {
        return instance
      }
    } catch (e: any) {
      // 实例刚启动时查询可能失败，继续等待
      warn(`查询实例状态失败:${JSON.stringify(e)}`)
    }
    await sleep(POLL_INTERVAL)
  }
  return null
}

/** 拿到虚拟 IP 后的 VPN 接管：组装路由 → 申请授权 → 启动 VPN（TUN fd 经事件注入） */
const attachVpn = async (
  instanceId: string,
  virtualIpv4: string,
  config: NetworkConfig
): Promise<void> => {
  let peerRoutes: any[] = []
  try {
    peerRoutes = (await invoke('query_routes', { instance_id: instanceId })) as any[]
  } catch (e: any) {
    warn(`获取对端路由失败（按空处理）:${JSON.stringify(e)}`)
  }
  const routes = buildVpnRoutes(peerRoutes, config)
  const dns = config.magicDns ? MAGIC_DNS_IP : undefined

  await requestVpnPermission()
  await doStartVpn(virtualIpv4, routes, dns)
  curStatus.ipv4Addr = virtualIpv4.split('/')[0]
  curStatus.cidr = parseInt(virtualIpv4.split('/')[1], 10) || undefined
  curStatus.routes = routes
  curStatus.dns = dns
  info(`VPN 已接管流量，虚拟 IP:${virtualIpv4}`)
}

/**
 * 后台等待虚拟 IP 并接入 VPN。
 * 实例运行失败 → 提示真实错误；VPN 接管失败/超时 → 提示检查对等节点与授权；
 * 配置被停止或切换（代际失效）→ 静默退出。
 */
const attachVpnInBackground = (instanceId: string, config: NetworkConfig, gen: number) => {
  const toast = useCreamToast()
  const store = useEasyTierStore()
  const task = async () => {
    const deadline = Date.now() + VPN_ATTACH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (gen !== attachGen) {
        warn('后台 VPN 接管已取消（配置已停止或切换）')
        return
      }
      let instance: RunningInstance | undefined
      try {
        const list = (await invoke('list_instances')) as RunningInstance[]
        instance = list.find((item) => item.instance_id === instanceId)
      } catch (e: any) {
        warn(`查询实例状态失败:${JSON.stringify(e)}`)
      }
      if (instance?.error_msg) {
        error(`实例运行失败，VPN 未接入:${instance.error_msg}`)
        toast.error(`${t('newOverview.startFailAndroid')}（${instance.error_msg}）`, 6000)
        store.triggerPageRefresh()
        return
      }
      if (instance?.running && instance.virtual_ipv4) {
        try {
          await attachVpn(instanceId, instance.virtual_ipv4, config)
          store.triggerPageRefresh()
        } catch (e: any) {
          const msg = typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e))
          warn(`VPN 接管失败:${msg}`)
          toast.info(t('newOverview.androidVpnNotAttached'), 6000)
        }
        return
      }
      await sleep(VPN_ATTACH_POLL_INTERVAL)
    }
    warn(`等待虚拟 IP 超时（${VPN_ATTACH_TIMEOUT_MS / 1000}s），VPN 未接入`)
    toast.info(t('newOverview.androidVpnNotAttached'), 8000)
  }
  task().catch((e) => error(`后台 VPN 接管异常:${JSON.stringify(e)}`))
}

// ---------- 对外主入口 ----------

/**
 * 启动配置并接入 VPN（Android 单实例模型）
 * 1. 启动内核实例（Rust 侧自动停旧实例）——实例进入运行态即视为启动成功
 * 2. no_tun 配置到此为止（不接管流量）
 * 3. 虚拟 IP 与 VPN 接管转入后台（DHCP 未就绪/无对等节点时持续等待，不再误报启动失败）
 */
export const startMobileVpn = async (configFileName: string): Promise<StartMobileVpnResult> => {
  await registerMobileVpnListeners()
  const config = await readNetworkConfig(configFileName)

  const instanceId = await invoke<string>('start_instance', { config_file: configFileName })
  info(`内核实例已启动:${instanceId}`)

  if (config.noTun) {
    info('配置启用 no_tun，跳过 VPN 启动')
    return { instanceId, vpnStarted: false }
  }

  // 等待实例进入运行态：失败时快速给出真实错误，成功则立即反馈（虚拟 IP 转后台等待）
  const gen = ++attachGen
  const instance = await waitInstanceRunning(instanceId, INSTANCE_READY_TIMEOUT_MS)
  if (instance?.error_msg) {
    throw new Error(instance.error_msg)
  }
  if (!instance) {
    warn(`实例在 ${INSTANCE_READY_TIMEOUT_MS / 1000}s 内未进入运行态，转为后台等待`)
  }

  attachVpnInBackground(instanceId, config, gen)
  return { instanceId, vpnStarted: false }
}

/** 同步 VPN 运行状态（应用启动 / 回到前台时调用） */
export const syncMobileVpnStatus = async () => {
  try {
    const status: any = await invoke('plugin:vpnservice|get_vpn_status', {})
    curStatus.running = status?.running ?? false
    if (curStatus.running && status?.ipv4Addr) {
      const [ip, cidr] = String(status.ipv4Addr).split('/')
      curStatus.ipv4Addr = ip
      curStatus.cidr = parseInt(cidr, 10) || undefined
    } else {
      curStatus.ipv4Addr = undefined
      curStatus.cidr = undefined
    }
    curStatus.routes = status?.routes ?? []
    curStatus.dns = status?.dns ?? undefined
  } catch (e: any) {
    warn(`同步 VPN 状态失败:${JSON.stringify(e)}`)
  }
}

/** 当前 VPN 运行状态（UI 展示用） */
export const getVpnRuntimeStatus = (): VpnRuntimeStatus => ({ ...curStatus })
