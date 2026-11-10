import { defineStore } from 'pinia'
import { createConfigDomain } from './easytier/config'
import { createKernelDomain } from './easytier/kernel'
import { createPreferencesDomain } from './easytier/preferences'
import { createRemoteDomain } from './easytier/remote'
import { createPageRefresh } from './easytier/pageRefresh'

/**
 * EasyTier 全局状态（按领域组合）
 *
 * - config：配置列表 / 运行列表（内核实例、Web 配置服务）
 * - kernel：内核版本探测结果（表单、CLI、服务安装按版本适配的唯一依据）
 * - remote：远端数据缓存（STUN、公共共享节点、监控摘要）
 * - preferences：页面偏好（刷新频率、P2P 通知、锁屏密码校验串等）
 * - pageRefresh：悬浮快捷菜单的页面刷新回调
 *
 * 持久化：除 startQueue（运行时瞬时状态）与 isFirstLoad（必须每进程重置）外
 * 整体持久化到 localStorage；锁屏密码仅存加盐 SHA-256 校验串（见 utils/lockUtil），绝不落明文。
 * 启动自动运行由 overview 页读取 settings.autoRunNetwork 触发（单一编排点）；
 * 桌面服务自启由 nssm 安装项承载，Android 由 VPN 前台服务承载。
 */
export const useEasyTierStore = defineStore(
  'easytier',
  () => {
    return {
      ...createConfigDomain(),
      ...createKernelDomain(),
      ...createRemoteDomain(),
      ...createPreferencesDomain(),
      ...createPageRefresh()
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
