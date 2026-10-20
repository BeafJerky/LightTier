/**
 * 镜像延迟测试（内核下载加速源）
 *
 * 与下载共用 Tauri plugin-http（Rust 发起请求），避免 WebView 全局 fetch 的 CORS
 * 预检导致“能下载却测速全失败”；探测目标是所选版本的真实内核压缩包而非镜像首页。
 * 单源 8s 超时（含重定向），未显式选择或当前源不可用时自动选用最快可用源，
 * 选择结果以 MIRROR_SOURCE_KEY 持久化（设置弹窗下载内核时读取同一状态）。
 */
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { computed, ref } from 'vue'
import {
  GITHUB_EASYTIER,
  GITHUB_MIRROR_URL,
  USER_AGENT,
  getCoreDownloadUrl
} from '@/constants/easytier'

/** 镜像源条目（latency 为测速结果，null 表示未测/失败） */
export interface MirrorSourceItem {
  value: string
  label: string
  latency: number | null
}

/** 选择结果持久化键（handleDownloadCore 使用同一条目） */
export const MIRROR_SOURCE_KEY = 'mirror-source'
/** 单源测速超时（ms）：需覆盖 DNS/TLS、镜像重定向与 GitHub 资源跳转 */
export const PROBE_TIMEOUT_MS = 8000
/** 延迟徽标阈值：<100ms 优、≥200ms 劣 */
export const LATENCY_GOOD = 100
export const LATENCY_BAD = 200

/** Tauri 运行时判定（浏览器预览回退全局 fetch，仅供 Mock 模式展示） */
const isTauriEnv = (): boolean => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
}

/** 测速单个源：HEAD 请求真实内核包，超时/失败返回 null */
const probeOne = async (
  base: string,
  version: string,
  filename: string
): Promise<number | null> => {
  const url = getCoreDownloadUrl(base, version, filename)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const init: RequestInit & { connectTimeout?: number; maxRedirections?: number } = {
    method: 'HEAD',
    headers: {
      'User-Agent': USER_AGENT,
      'Cache-Control': 'no-cache',
      Accept: '*/*'
    },
    connectTimeout: PROBE_TIMEOUT_MS,
    // GitHub release 会重定向到资源域名，镜像也可能二次跳转
    maxRedirections: 5,
    signal: controller.signal
  }
  try {
    const start = performance.now()
    // 桌面/Android 走 plugin-http，绕过 CORS；浏览器预览仅用于 Mock 展示
    const res = isTauriEnv() ? await tauriFetch(url, init) : await fetch(url, init as RequestInit)
    if (!res.ok) return null
    return Math.round(performance.now() - start)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const useMirrorProbe = () => {
  const sources = ref<MirrorSourceItem[]>([
    { value: GITHUB_EASYTIER, label: '', latency: null },
    ...GITHUB_MIRROR_URL.map((m) => ({ ...m, latency: null }))
  ])
  const probing = ref(false)
  // 已下线的镜像（如版本升级后移除的源）回退官方，避免继续用失效前缀下载
  const stored = localStorage.getItem(MIRROR_SOURCE_KEY)
  const storedKnown = !!stored && sources.value.some((s) => s.value === stored)
  if (stored && !storedKnown) localStorage.removeItem(MIRROR_SOURCE_KEY)
  const selected = ref<string>(storedKnown ? (stored as string) : GITHUB_EASYTIER)
  const selectedSource = computed(
    () => sources.value.find((s) => s.value === selected.value) || sources.value[0]
  )

  /** 显式选择镜像源并持久化（后续下载优先使用该源） */
  const selectSource = (value: string): void => {
    selected.value = value
    localStorage.setItem(MIRROR_SOURCE_KEY, value)
  }

  /**
   * 并发测速全部源；未显式选择、或当前源不可达时自动选用最快可用源。
   * 显式选择且可用的源不会被更快的源覆盖。
   */
  const probeAll = async (version: string, filename: string): Promise<void> => {
    if (probing.value || !version || !filename) return
    probing.value = true
    try {
      const results = await Promise.all(
        sources.value.map(async (s) => ({
          ...s,
          latency: await probeOne(s.value, version, filename)
        }))
      )
      sources.value = results
      const current = results.find((s) => s.value === selected.value)
      const hasExplicitChoice = Boolean(localStorage.getItem(MIRROR_SOURCE_KEY))
      if (!hasExplicitChoice || !current || current.latency === null) {
        const fastest = results
          .filter((s) => s.latency !== null)
          .sort((a, b) => (a.latency as number) - (b.latency as number))[0]
        if (fastest) selectSource(fastest.value)
      }
    } finally {
      probing.value = false
    }
  }

  return { sources, probing, selected, selectedSource, probeAll, selectSource }
}
