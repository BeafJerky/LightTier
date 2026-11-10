/**
 * 页面偏好域：P2P 通知、自动运行、刷新频率、锁屏密码校验串、更新策略等。
 * 整体随 pinia 持久化；isFirstLoad 与 startQueue 由持久化配置排除。
 */
import { ref } from 'vue'

export function createPreferencesDomain() {
  // 是否 通知 全部节点建立 P2P 连接  true:通知  false:不同值
  const p2pNotify = ref(true)
  // P2P 通知设置 true:开启  false:关闭
  const p2pNotifySetting = ref(true)
  // 启动后自动运行网络 true:开启  false:关闭
  const autoRunNetworkSetting = ref(false)
  // 启动后自动运行的网络配置名称
  const autoRunConfigName = ref('')
  // 刷新频率（秒）
  const refreshInterval = ref(3)
  // 是否是首次加载（用于自动运行逻辑）
  const isFirstLoad = ref(true)
  // 锁定密码：加盐 SHA-256 校验串（sha256$salt$hash），旧版明文由启动迁移升级
  const lockPassword = ref('')
  // 启动直接报错提示
  const errRunNotify = ref(true)
  // 检查更新只认正式版（忽略 nightly 等预发布），默认开启
  const updateStableOnly = ref(true)
  // 当前选择的列（存储prop值）
  const selectedColumns = ref(['rx_bytes', 'tx_bytes', 'nat_type'])
  // 默认服务安装方式
  const defaultServiceInstallMethod = ref<'nssm' | 'official'>('nssm')
  // 默认开机自启动
  const defaultEnableAutostart = ref(true)

  const setRefreshInterval = (val: number) => {
    refreshInterval.value = val
  }

  return {
    p2pNotify,
    p2pNotifySetting,
    autoRunNetworkSetting,
    autoRunConfigName,
    refreshInterval,
    isFirstLoad,
    lockPassword,
    errRunNotify,
    updateStableOnly,
    selectedColumns,
    defaultServiceInstallMethod,
    defaultEnableAutostart,
    setRefreshInterval
  }
}
