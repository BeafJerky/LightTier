/**
 * 镜像延迟测试与加速源管理（内核下载加速源）
 *
 * 与下载共用 Tauri plugin-http（Rust 发起请求），避免 WebView 全局 fetch 的 CORS
 * 预检导致“能下载却测速全失败”；探测目标是所选版本的真实内核压缩包而非镜像首页。
 * 单源 8s 超时（含重定向），未显式选择或当前源不可用时自动选用最快可用源，
 * 设置页在打开加速源弹窗或开始下载时自动触发测速；选择结果以 MIRROR_SOURCE_KEY
 * 持久化（设置弹窗下载内核时读取同一状态）。
 *
 * 加速源管理：
 * - 官方源固定保留，不可删除；
 * - 内置镜像可删除（记录到 MIRROR_HIDDEN_KEY，可一键恢复）；
 * - 自定义源持久化到 MIRROR_CUSTOM_KEY，可随时删除。
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
import { normalizeMirrorPrefix } from '@/utils/mirrorUtil'

/** 镜像源条目（latency 为测速结果，null 表示未测/失败） */
export interface MirrorSourceItem {
  value: string
  label: string
  latency: number | null
  /** 内置源（官方或预置镜像） */
  builtin: boolean
  /** GitHub 官方源，不可删除 */
  official: boolean
  /** 用户新增的源 */
  custom: boolean
}

export type AddMirrorResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid' | 'duplicate' }

/** 选择结果持久化键（handleDownloadCore 使用同一条目） */
export const MIRROR_SOURCE_KEY = 'mirror-source'
/** 自定义加速源列表持久化键 */
export const MIRROR_CUSTOM_KEY = 'mirror-custom-sources'
/** 被删除的内置加速源持久化键（可恢复） */
export const MIRROR_HIDDEN_KEY = 'mirror-hidden-sources'
/** 单源测速超时（ms）：需覆盖 DNS/TLS、镜像重定向与 GitHub 资源跳转 */
export const PROBE_TIMEOUT_MS = 8000
/** 延迟徽标阈值：<100ms 优、≥200ms 劣 */
export const LATENCY_GOOD = 100
export const LATENCY_BAD = 200

const OFFICIAL_PREFIX = `${GITHUB_EASYTIER.replace(/\/+$/, '')}/`
const BUILTIN_MIRROR_VALUES = new Set(GITHUB_MIRROR_URL.map((m) => m.value))

/** Tauri 运行时判定（浏览器预览回退全局 fetch，仅供 Mock 模式展示） */
const isTauriEnv = (): boolean => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
}

/** 读取 localStorage 字符串数组；损坏/非数组内容按空处理 */
const readStringList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const writeStringList = (key: string, values: string[]): void => {
  try {
    if (values.length) localStorage.setItem(key, JSON.stringify(values))
    else localStorage.removeItem(key)
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
}

/** 载入自定义源：归一化、去重，并排除内置源（内置源应通过“恢复默认”管理） */
const loadCustomSources = (): string[] => {
  const result: string[] = []
  for (const raw of readStringList(MIRROR_CUSTOM_KEY)) {
    const value = normalizeMirrorPrefix(raw)
    if (!value || value === OFFICIAL_PREFIX || BUILTIN_MIRROR_VALUES.has(value)) continue
    if (!result.includes(value)) result.push(value)
  }
  return result
}

/** 载入被删除的内置源，仅保留仍存在于内置列表中的值 */
const loadHiddenSources = (): string[] =>
  Array.from(
    new Set(readStringList(MIRROR_HIDDEN_KEY).filter((value) => BUILTIN_MIRROR_VALUES.has(value)))
  )

/** 按“官方 → 内置镜像（排除已删除） → 自定义”的顺序构建列表 */
const buildSources = (custom: string[], hidden: string[]): MirrorSourceItem[] => {
  const hiddenSet = new Set(hidden)
  return [
    {
      value: GITHUB_EASYTIER,
      label: '',
      latency: null,
      builtin: true,
      official: true,
      custom: false
    },
    ...GITHUB_MIRROR_URL.filter((m) => !hiddenSet.has(m.value)).map((m) => ({
      value: m.value,
      label: m.label,
      latency: null,
      builtin: true,
      official: false,
      custom: false
    })),
    ...custom.map((value) => ({
      value,
      label: value,
      latency: null,
      builtin: false,
      official: false,
      custom: true
    }))
  ]
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
  const custom = ref<string[]>(loadCustomSources())
  const hidden = ref<string[]>(loadHiddenSources())
  const sources = ref<MirrorSourceItem[]>(buildSources(custom.value, hidden.value))
  const probing = ref(false)
  // 当前测速任务（单源或全量）：下载前可等待自动测速完成，避免半途改用旧源
  let probeTask: Promise<unknown> | null = null
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

  /** 重建列表并尽量保留已有测速结果（恢复/新增内置源时使用） */
  const rebuildSources = (): void => {
    const latencies = new Map(sources.value.map((s) => [s.value, s.latency]))
    sources.value = buildSources(custom.value, hidden.value).map((s) => ({
      ...s,
      latency: latencies.get(s.value) ?? null
    }))
  }

  /**
   * 新增自定义加速源（若是被删除的内置源则直接恢复）。
   * 成功后自动选中新源，便于立即用于下载；调用方可再测速校验。
   */
  const addSource = (raw: string): AddMirrorResult => {
    const value = normalizeMirrorPrefix(raw)
    if (!value) return { ok: false, reason: 'invalid' }
    if (value === OFFICIAL_PREFIX || sources.value.some((s) => s.value === value)) {
      return { ok: false, reason: 'duplicate' }
    }

    if (BUILTIN_MIRROR_VALUES.has(value)) {
      hidden.value = hidden.value.filter((item) => item !== value)
      writeStringList(MIRROR_HIDDEN_KEY, hidden.value)
    } else {
      custom.value = [...custom.value, value]
      writeStringList(MIRROR_CUSTOM_KEY, custom.value)
    }
    rebuildSources()
    selectSource(value)
    return { ok: true, value }
  }

  /** 删除加速源：官方源不可删除；内置源记入隐藏列表，自定义源直接移除 */
  const removeSource = (value: string): boolean => {
    if (value === GITHUB_EASYTIER) return false
    if (!sources.value.some((s) => s.value === value)) return false

    if (BUILTIN_MIRROR_VALUES.has(value)) {
      hidden.value = [...hidden.value.filter((item) => item !== value), value]
      writeStringList(MIRROR_HIDDEN_KEY, hidden.value)
    } else {
      custom.value = custom.value.filter((item) => item !== value)
      writeStringList(MIRROR_CUSTOM_KEY, custom.value)
    }
    sources.value = sources.value.filter((s) => s.value !== value)
    if (selected.value === value) selectSource(GITHUB_EASYTIER)
    return true
  }

  /** 是否还有被删除、可恢复的内置源 */
  const canRestoreDefaults = computed(() => hidden.value.length > 0)

  /** 恢复全部内置镜像（保留自定义源与已有测速结果） */
  const restoreDefaults = (): void => {
    if (!canRestoreDefaults.value) return
    hidden.value = []
    writeStringList(MIRROR_HIDDEN_KEY, hidden.value)
    rebuildSources()
  }

  /** 单源测速（新增后即时反馈），不改变当前选择 */
  const probeSource = async (
    value: string,
    version: string,
    filename: string
  ): Promise<number | null> => {
    if (probing.value || !version || !filename) return null
    const item = sources.value.find((s) => s.value === value)
    if (!item) return null
    probing.value = true
    const task = (async () => {
      try {
        const latency = await probeOne(value, version, filename)
        item.latency = latency
        return latency
      } finally {
        probing.value = false
        probeTask = null
      }
    })()
    probeTask = task
    return task
  }

  /**
   * 并发测速全部源；未显式选择、或当前源不可达时自动选用最快可用源。
   * 显式选择且可用的源不会被更快的源覆盖。
   */
  const probeAll = async (version: string, filename: string): Promise<void> => {
    if (probing.value || !version || !filename) return
    probing.value = true
    const task = (async () => {
      try {
        const snapshot = [...sources.value]
        const results = await Promise.all(
          snapshot.map(async (s) => ({
            value: s.value,
            latency: await probeOne(s.value, version, filename)
          }))
        )
        // 逐项回写，避免测速期间新增/删除的源被旧快照覆盖
        const latencyMap = new Map(results.map((r) => [r.value, r.latency]))
        sources.value.forEach((s) => {
          const next = latencyMap.get(s.value)
          if (next !== undefined) s.latency = next
        })
        const current = sources.value.find((s) => s.value === selected.value)
        const hasExplicitChoice = Boolean(localStorage.getItem(MIRROR_SOURCE_KEY))
        // 测速期间新增的源不在本次结果内（latency 未测而非不可达），不因此切走用户刚加入的选择
        const currentProbed = current ? latencyMap.has(current.value) : false
        if (!hasExplicitChoice || !current || (currentProbed && current.latency === null)) {
          const fastest = sources.value
            .filter((s) => s.latency !== null)
            .sort((a, b) => (a.latency as number) - (b.latency as number))[0]
          if (fastest) selectSource(fastest.value)
        }
      } finally {
        probing.value = false
        probeTask = null
      }
    })()
    probeTask = task
    await task
  }

  /** 等待进行中的测速结束（含单源测速）；无任务时立即返回 */
  const waitForProbe = (): Promise<void> =>
    probeTask
      ? probeTask.then(
          () => undefined,
          () => undefined
        )
      : Promise.resolve()

  return {
    sources,
    probing,
    selected,
    selectedSource,
    probeAll,
    probeSource,
    waitForProbe,
    selectSource,
    addSource,
    removeSource,
    canRestoreDefaults,
    restoreDefaults
  }
}
