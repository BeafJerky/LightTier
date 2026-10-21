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
/**
 * 生成内核压缩包文件名（纯字符串拼接）。
 * 禁止改用 lodash.template：其编译依赖 new Function，会被生产包严格 CSP（script-src 'self'）拦截，
 * 且异常会导致文件名恒为空，下载/安装内核全部失效。
 */
export const getCoreFileName = (osType: string, osArch: string, version: string): string =>
  `easytier-${osType}-${osArch}-${version}.zip`
/**
 * 将 GitHub 原始地址包装为镜像加速地址。
 * 镜像源只存前缀（如 https://ghfast.top/），实际请求需在其后拼接完整 GitHub URL；
 * 官方源（含尾部斜杠）原样返回，空值回退官方地址。
 */
export const getMirrorUrl = (base: string, githubUrl: string): string => {
  const normalized = (base || GITHUB_EASYTIER).replace(/\/+$/, '')
  if (!normalized || normalized === GITHUB_EASYTIER) return githubUrl
  return `${normalized}/${githubUrl}`
}
/** 内核压缩包下载地址：按所选加速源拼出真实资源地址（官方直链或镜像前缀 + GitHub URL） */
export const getCoreDownloadUrl = (base: string, version: string, filename: string): string =>
  getMirrorUrl(base, `${GITHUB_EASYTIER}${GITHUB_DOWN_URL}/${version}/${filename}`)
export const PREFIX_SVC = 'easytier-'
export const PREFIX_SVC_WEB = 'easytierweb-'
export const STUN_SERVER_URL =
  'https://ghproxy.vip/https://gist.githubusercontent.com/mondain/b0ec1cf5f60ae726202e/raw/2d2b96b4508a38d342e0228d46eab84dad2398a3/public-stun-list.txt'
/**
 * GitHub 加速镜像前缀（下载时需拼接完整 GitHub URL，见 getMirrorUrl）。
 * 仅保留实测可获取内核压缩包的源；已移除 gh.monlor.com（DNS 失效）、
 * down.npee.cn（TLS 握手失败）、ghproxy.1888866.xyz（HTTP 525）。
 */
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
    value: 'https://fastgit.cc/',
    label: 'https://fastgit.cc/',
    latency: null
  }
]

// 可下载版本固定列表见 constants/kernelCompat.ts 的 CORE_VERSION_OPTIONS。
// 桌面内核安装包不再随应用内置，由用户在设置页按需下载到 resource/core。

/**
 * “检查更新”可用的 GitHub API 加速前缀（2026-10-21 实测可返回 releases JSON）。
 * 内核下载镜像多数只代理 release 资源与 github.com 页面，不代理 api.github.com，
 * 因此不能直接复用 GITHUB_MIRROR_URL，仅保留实测支持 API 的源。
 * 桌面端由 WebView 直接 fetch，必须带 CORS 响应头；ghproxy.vip 可返回 JSON
 * 但缺少 Access-Control-Allow-Origin，浏览器侧会被拦截，故不纳入。
 */
export const MANAGER_INFO_MIRROR_URL = [
  'https://wget.la/',
  'https://gh-proxy.com/',
  'https://gh-proxy.org/'
]

export const DEFAULT_STUN_SERVER = [
  'stun.nas.net:3478',
  'stun.qq.com:3478',
  'stun.miwifi.com:3478',
  'stun.stunprotocol.org:3478'
]
