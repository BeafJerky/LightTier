/**
 * 配置目录
 */
export const CONFIG_PATH = 'config'
export const RESOURCE_PATH = 'resource'
export const LOG_PATH = 'logs'
/**
 * 核心（easytier-core/easytier-cli/config-server）的下载与安装目录，
 * 独立于打包资源（nssm、themes 等），避免混放
 */
export const CORE_PATH = 'resource/core'
export const NSSM_NAME = 'nssm'
/**
 * 配置文件名
 */
export const CONFIG_FILE_NAME = 'data.json'
/**
 * LightTier 私有元数据段名（写入用户 TOML 的 [lighttier] 表）。
 * 官方内核会忽略未知顶层表，因此应用私有字段必须放这里；
 * 禁止写入 [flags]——EasyTier v2.7.0+ 对未知 flags 键会直接拒绝启动。
 */
export const LIGHTTIER_CONFIG_SECTION = 'lighttier'
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
// export const MONITOR_LIST = 'https://easytier.linch.eu.org/api/getMonitorList'
export const MONITOR_LIST = 'https://uptime.easytier.cn/api/nodes?page=1&per_page=50'
// LightTier 仓库主页（“关于”页链接）与发布地址（“检查更新”读取 releases）
// 注意：仓库名中 'I' 为大写（LIghtTier），GitHub URL 大小写不敏感，但实际仓库名如此
export const MANAGER_REPO_HOME = 'https://github.com/BeafJerky/LIghtTier'
export const MANAGER_REPO_URL = `${MANAGER_REPO_HOME}/releases`
export const MANAGER_INFO_API = 'https://api.github.com/repos/BeafJerky/LIghtTier/releases'
export const GITHUB_EASYTIER = 'https://github.com/EasyTier/EasyTier'
export const GITHUB_DOWN_URL = '/releases/download'
export const VERSION_PREFIX = 'v'
export const EASYTIER_NAME = '/easytier-<%= osType %>-<%= osArch %>-<%= version %>.zip'
export const PREFIX_SVC = 'easytier-'
export const PREFIX_SVC_WEB = 'easytierweb-'
export const STUN_SERVER_URL =
  'https://ghproxy.vip/https://gist.githubusercontent.com/mondain/b0ec1cf5f60ae726202e/raw/2d2b96b4508a38d342e0228d46eab84dad2398a3/public-stun-list.txt'
export const GITHUB_MIRROR_URL = [
  {
    value: 'https://wget.la/',
    label: 'https://wget.la/',
    latency: null
  },
  {
    value: 'https://gh-proxy.com/',
    label: 'https://gh-proxy.com/',
    latency: null
  },
  {
    value: 'https://gh.monlor.com/',
    label: 'https://gh.monlor.com/',
    latency: null
  },
  {
    value: 'https://github.boki.moe/',
    label: 'https://github.boki.moe/',
    latency: null
  },
  {
    value: 'https://ghfast.top/',
    label: 'https://ghfast.top/',
    latency: null
  },
  {
    value: 'https://gh-proxy.org/',
    label: 'https://gh-proxy.org/',
    latency: null
  },
  {
    value: 'https://ghproxy.net/',
    label: 'https://ghproxy.net/',
    latency: null
  },
  {
    value: 'https://ghproxy.vip/',
    label: 'https://ghproxy.vip/',
    latency: null
  },
  {
    value: 'https://down.npee.cn/',
    label: 'https://down.npee.cn/',
    latency: null
  },
  {
    value: 'https://fastgit.cc/',
    label: 'https://fastgit.cc/',
    latency: null
  },
  {
    value: 'https://ghproxy.1888866.xyz/',
    label: 'https://ghproxy.1888866.xyz/',
    latency: null
  }
]

// 安装包内置的核心版本（resource/core 下预置对应压缩包，首次安装免下载）
// 修改时需同步更新 src-tauri/resource/core/ 下的压缩包
// 可下载版本固定列表见 constants/kernelCompat.ts 的 CORE_VERSION_OPTIONS
export const BUILTIN_CORE_VERSION = 'v2.6.4'

export const DEFAULT_STUN_SERVER = [
  'stun.nas.net:3478',
  'stun.qq.com:3478',
  'stun.miwifi.com:3478',
  'stun.stunprotocol.org:3478'
]
