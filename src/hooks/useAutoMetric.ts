/**
 * 网卡自动跃点（Automatic Metric）管理
 *
 * 场景：配置启用了 config_exit_nodes_route（接管出口流量）时，启动前将物理上网网卡的
 * 自动跃点关闭并调低 metric，避免出口流量绕行导致断网；实例停止后恢复。
 * 仅 Windows 桌面生效（非 Tauri 环境或 Android 静默跳过）；
 * disabledAutoMetricAdapter 为模块级单例，窗口关闭时尽力恢复。
 */
import { ref } from 'vue'
import { executeCmd } from '@/utils/shellUtil'
import { readFileContent } from '@/utils/fileUtil'
import { CONFIG_PATH } from '@/constants/easytier'
import { isAndroid } from '@/utils/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { PS_ADAPTER_FILTER_CLAUSE } from '@/utils/sysUtil'
import * as toml from 'smol-toml'

// 模块级单例状态 — 跨视图共享
const disabledAutoMetricAdapter = ref<string | null>(null)

// 环境检测（非 Tauri 环境或 Android 静默跳过；自动跃点为 Windows 网卡概念）
// 注：withGlobalTauri 已关闭，统一用 @tauri-apps/api 的 isTauri() 检测（读 __TAURI_INTERNALS__）
const isTauri = (): boolean => {
  try {
    return isTauriRuntime() && !isAndroid()
  } catch {
    return false
  }
}

/** 获取上网网卡名：默认网关所在、非 EasyTier 虚拟网卡、interface metric 最小的适配器 */
const getActiveNetworkAdapter = async (): Promise<string | null> => {
  if (!isTauri()) return null
  try {
    const res = await executeCmd(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        // PS_ADAPTER_FILTER_CLAUSE 统一维护网卡筛选（含 et_* / easytier* 排除，见 sysUtil）
        `Get-NetIPConfiguration | Where-Object {${PS_ADAPTER_FILTER_CLAUSE}} | Sort-Object -Property InterfaceMetric | Select-Object -First 1 -ExpandProperty NetAdapter | Select-Object -ExpandProperty Name`
      ],
      { encoding: 'gbk' }
    )
    const adapterName = typeof res === 'string' ? res.trim() : ''
    return adapterName || null
  } catch (e) {
    console.warn(`[AutoMetric] 获取上网网卡失败: ${String(e)}`)
    return null
  }
}

/** 关闭网卡自动跃点并调低 metric（出口路由接管时避免流量绕行） */
const disableAutoMetric = async (adapterName: string): Promise<boolean> => {
  if (!isTauri()) return true
  try {
    // PowerShell 中双引号的转义：将 " 替换为 `"
    const safeName = adapterName.replace(/"/g, '`"')
    await executeCmd(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Set-NetIPInterface -InterfaceAlias "${safeName}" -AutomaticMetric Disabled -InterfaceMetric 1`
      ],
      { encoding: 'gbk' }
    )
    return true
  } catch (e) {
    console.warn(`[AutoMetric] 关闭网卡自动跃点失败: ${String(e)}`)
    return false
  }
}

/** 恢复网卡自动跃点（实例停止后调用） */
const enableAutoMetric = async (adapterName: string): Promise<boolean> => {
  if (!isTauri()) return true
  try {
    // PowerShell 中双引号的转义：将 " 替换为 `"
    const safeName = adapterName.replace(/"/g, '`"')
    await executeCmd(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Set-NetIPInterface -InterfaceAlias "${safeName}" -AutomaticMetric Enabled`
      ],
      { encoding: 'gbk' }
    )
    return true
  } catch (e) {
    console.warn(`[AutoMetric] 开启网卡自动跃点失败: ${String(e)}`)
    return false
  }
}

export function useAutoMetric() {
  // 启动前钩子：读取 TOML → 检查 config_exit_nodes_route → 禁用跃点
  const beforeStart = async (fileName: string): Promise<void> => {
    if (!isTauri()) return
    try {
      const content = (await readFileContent(`${CONFIG_PATH}/${fileName}`)) as string
      if (!content) return
      const parsed = toml.parse(content) as any
      if (!parsed.config_exit_nodes_route) return
      const adapter = await getActiveNetworkAdapter()
      if (adapter && (await disableAutoMetric(adapter))) {
        disabledAutoMetricAdapter.value = adapter
      }
    } catch {
      /* 静默跳过，不影响启动 */
    }
  }

  // 停止/失败后恢复钩子
  const afterStop = async (): Promise<void> => {
    if (disabledAutoMetricAdapter.value) {
      try {
        await enableAutoMetric(disabledAutoMetricAdapter.value)
      } finally {
        disabledAutoMetricAdapter.value = null
      }
    }
  }

  return { beforeStart, afterStop, disabledAutoMetricAdapter }
}

// 全局 beforeunload 钩子：窗口关闭时尽力恢复网卡自动跃点
// 只在模块首次加载时注册一次
if (typeof window !== 'undefined' && !('__autoMetricUnloadRegistered' in window)) {
  ;(window as any).__autoMetricUnloadRegistered = true
  window.addEventListener('beforeunload', () => {
    const adapter = disabledAutoMetricAdapter.value
    if (adapter) {
      // 触发恢复命令（不等待完成，best-effort）
      const safeName = adapter.replace(/"/g, '`"')
      executeCmd(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Set-NetIPInterface -InterfaceAlias "${safeName}" -AutomaticMetric Enabled`
        ],
        { encoding: 'gbk' }
      ).catch(() => {})
    }
  })
}
