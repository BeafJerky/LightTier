/**
 * 镜像延迟测试与加速源管理（内核下载加速源）
 *
 * 与下载共用 Tauri plugin-http（Rust 发起请求），避免 WebView 全局 fetch 的 CORS
 * 预检导致“能下载却测速全失败”；探测目标是真实资源地址（内核压缩包或应用更新安装包）
 * 而非镜像首页。
 * 单源 8s 超时（含重定向），未显式选择或当前源不可用时自动选用最快可用源，
 * 设置页在打开加速源弹窗或开始下载时自动触发测速；选择结果以 MIRROR_SOURCE_KEY
 * 持久化（设置弹窗下载内核时读取同一状态）。
 *
 * 下载与展示分离：延迟徽标来自 HEAD 探针，但 HEAD 快不等于下载快（存在 HEAD 1s、
 * GET 零字节的镜像）。真正开始下载前会用 GET 采样真实吞吐排序并逐源重试，
 * 停滞/低速/半包自动换下一个源（downloadFromMirrors）。
 *
 * 加速源管理：
 * - 官方源固定保留，不可删除；
 * - 内置镜像可删除（记录到 MIRROR_HIDDEN_KEY，可一键恢复）；
 * - 自定义源持久化到 MIRROR_CUSTOM_KEY，可随时删除。
 *
 * agent 模式：浏览器无法直接 HEAD/GET 镜像（CORS），测速改由服务端代理
 * （packages.probeMirrors）；选择结果持久化到服务端 settings.coreMirror，
 * localStorage 仅作首屏占位与“显式选择”标记。部署方通过 LT_CORE_MIRROR
 * 锁定时（mirrorLocked）选择、增删与测速全部禁用。桌面/Android/Mock 路径不变。
 */
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  GITHUB_EASYTIER,
  GITHUB_MIRROR_URL,
  USER_AGENT,
  getCoreDownloadUrl
} from '@/shared/constants/easytier'
import { measureDownloadSpeed } from '@/shared/platform/fileUtil'
import { normalizeMirrorPrefix, orderMirrorCandidates } from '@/shared/lib/mirrorUtil'
import { backendMode, backendPackages, backendSettings } from '@/shared/platform/backend'
import type { MirrorProbeResult } from '@/shared/platform/backend'
import { useCreamToast } from '@/shared/ui/useCreamToast'

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
const PROBE_TIMEOUT_MS = 8000
/** 下载前吞吐采样：窗口与单源上限（区分“能用/极慢/不通”即可） */
const SPEED_SAMPLE_WINDOW_MS = 1800
const SPEED_SAMPLE_MAX_BYTES = 256 * 1024
const SPEED_SAMPLE_RESPONSE_TIMEOUT_MS = 5000
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
    // 下载只允许 HTTPS：自定义 http 镜像会被静默忽略
    if (!/^https:\/\//i.test(value)) continue
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

/** 测速单个 URL：HEAD 请求真实资源，超时/失败返回 null */
const probeUrl = async (url: string): Promise<number | null> => {
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

/** 内核包测速：按加速源拼出所选版本的真实压缩包地址后测速 */
const probeOne = (base: string, version: string, filename: string): Promise<number | null> =>
  probeUrl(getCoreDownloadUrl(base, version, filename))

/** 服务端单次测速上限（镜像模块 MAX_PROBE_SOURCES），超出会被整单拒绝 */
const AGENT_PROBE_BATCH = 10

/** agent 分批测速：某批失败按该批全部不可达处理，不影响其他批次 */
const probeMirrorsChunked = async (
  values: string[],
  version: string
): Promise<MirrorProbeResult[]> => {
  const results: MirrorProbeResult[] = []
  for (let i = 0; i < values.length; i += AGENT_PROBE_BATCH) {
    const chunk = values.slice(i, i + AGENT_PROBE_BATCH)
    try {
      results.push(...(await backendPackages().probeMirrors(chunk, version)))
    } catch {
      results.push(
        ...chunk.map((source) => ({
          source,
          latencyMs: null,
          speedBytesPerSec: null,
          ok: false
        }))
      )
    }
  }
  return results
}

export const useMirrorProbe = () => {
  const { t } = useI18n()
  const toast = useCreamToast()
  const isAgentMode = backendMode() === 'agent'
  /** 部署方通过 LT_CORE_MIRROR 锁定加速源（仅 agent 会变为 true） */
  const mirrorLocked = ref(false)
  // 选择请求竞态标记：只有最后一次选择允许落盘/回滚
  let selectTicket = 0
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
    if (isAgentMode) {
      if (mirrorLocked.value) return
      const ticket = ++selectTicket
      const previous = selected.value
      // 乐观更新 UI；服务端保存成功后才落 localStorage，失败回滚并提示
      selected.value = value
      const coreMirror = value === GITHUB_EASYTIER ? '' : value
      backendSettings()
        .put({ coreMirror })
        .then(
          () => {
            if (ticket === selectTicket) localStorage.setItem(MIRROR_SOURCE_KEY, value)
          },
          () => {
            if (ticket !== selectTicket) return
            selected.value = previous
            toast.error(t('newSettings.mirrorSaveFail'))
          }
        )
      return
    }
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
    if (mirrorLocked.value) return { ok: false, reason: 'invalid' }
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
    if (mirrorLocked.value) return false
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
    if (mirrorLocked.value) return
    if (!canRestoreDefaults.value) return
    hidden.value = []
    writeStringList(MIRROR_HIDDEN_KEY, hidden.value)
    rebuildSources()
  }

  /** 单源测速（新增后即时反馈），不改变当前选择；agent 下文件名由服务端清单决定 */
  const probeSource = async (
    value: string,
    version: string,
    filename: string
  ): Promise<number | null> => {
    if (probing.value || mirrorLocked.value || !version || (!isAgentMode && !filename)) return null
    const item = sources.value.find((s) => s.value === value)
    if (!item) return null
    probing.value = true
    const task = (async () => {
      try {
        const latency = isAgentMode
          ? await backendPackages()
              .probeMirrors([value], version)
              .then(
                (results) => {
                  const hit = results.find((r) => r.source === value)
                  return hit?.ok ? hit.latencyMs : null
                },
                () => null
              )
          : await probeOne(value, version, filename)
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
   * 目标资源由 buildUrl 按源生成，内核包与应用更新包共用同一选源规则。
   * agent 模式忽略 buildUrl（服务端只把归一化前缀拼到自己的清单地址），需要 version。
   */
  const probeAllWith = async (
    buildUrl: (base: string) => string,
    version?: string
  ): Promise<void> => {
    if (probing.value || mirrorLocked.value) return
    if (isAgentMode && !version) return
    probing.value = true
    const task = (async () => {
      try {
        const snapshot = [...sources.value]
        const results = isAgentMode
          ? (
              await probeMirrorsChunked(
                snapshot.map((s) => s.value),
                version ?? ''
              )
            ).map((r) => ({
              value: r.source,
              latency: r.ok ? r.latencyMs : null
            }))
          : await Promise.all(
              snapshot.map(async (s) => ({
                value: s.value,
                latency: await probeUrl(buildUrl(s.value))
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

  /** 内核包全量测速（保留原签名，设置页与引导页按版本号调用）；agent 无需文件名 */
  const probeAll = (version: string, filename: string): Promise<void> =>
    version && (isAgentMode || filename)
      ? probeAllWith((base) => getCoreDownloadUrl(base, version, filename), version)
      : Promise.resolve()

  /** 等待进行中的测速结束（含单源测速）；无任务时立即返回 */
  const waitForProbe = (): Promise<void> =>
    probeTask
      ? probeTask.then(
          () => undefined,
          () => undefined
        )
      : Promise.resolve()

  /**
   * 下载前按真实吞吐排序：GET 真实资源采样，避免 HEAD 很快但 GET 不动的镜像被选中。
   * 结果同时用于展示（延迟徽标仍为 HEAD 结果，此处只决定下载顺序）。
   */
  const rankByThroughput = async (
    buildUrl: (base: string) => string,
    version?: string
  ): Promise<Array<{ item: MirrorSourceItem; speed: number }>> => {
    const snapshot = [...sources.value]
    probing.value = true
    const task = (async () => {
      if (isAgentMode) {
        // 服务端在同一次探测里给出 HEAD 延迟与 GET 吞吐；锁定/无版本时不测速
        const speeds = new Map<string, number>()
        if (!mirrorLocked.value && version) {
          const results = await probeMirrorsChunked(
            snapshot.map((s) => s.value),
            version
          )
          const latencyMap = new Map(results.map((r) => [r.source, r.ok ? r.latencyMs : null]))
          sources.value.forEach((s) => {
            const next = latencyMap.get(s.value)
            if (next !== undefined) s.latency = next
          })
          results.forEach((r) => speeds.set(r.source, r.ok ? (r.speedBytesPerSec ?? 0) : 0))
        }
        const ordered = orderMirrorCandidates(
          snapshot,
          speeds,
          localStorage.getItem(MIRROR_SOURCE_KEY)
        )
        return ordered.map((item) => ({ item, speed: speeds.get(item.value) ?? 0 }))
      }
      const measured = await Promise.all(
        snapshot.map(async (item) => ({
          item,
          speed: await measureDownloadSpeed(buildUrl(item.value), {
            windowMs: SPEED_SAMPLE_WINDOW_MS,
            maxBytes: SPEED_SAMPLE_MAX_BYTES,
            responseTimeoutMs: SPEED_SAMPLE_RESPONSE_TIMEOUT_MS
          })
        }))
      )
      const speeds = new Map(measured.map((m) => [m.item.value, m.speed]))
      const ordered = orderMirrorCandidates(
        snapshot,
        speeds,
        localStorage.getItem(MIRROR_SOURCE_KEY)
      )
      return ordered.map((item) => ({ item, speed: speeds.get(item.value) ?? 0 }))
    })()
    probeTask = task
    try {
      return await task
    } finally {
      probing.value = false
      probeTask = null
    }
  }

  /**
   * 按实测吞吐排序后逐个尝试下载，失败/停滞自动换下一个源。
   * buildUrl 负责把源前缀拼成完整资源地址；run 执行一次下载并返回是否成功，
   * lastAttempt 为 true 表示最后一个候选（慢速源也允许下完，避免全部失败）。
   * 成功后把可用源记为当前选择，失败源不会覆盖已有选择。
   */
  const downloadFromMirrors = async (
    buildUrl: (base: string) => string,
    run: (url: string, context: { lastAttempt: boolean }) => Promise<boolean>,
    hooks?: { onSwitch?: (from: string, to: string) => void }
  ): Promise<boolean> => {
    const ranked = await rankByThroughput(buildUrl)
    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i].item
      if (i > 0) hooks?.onSwitch?.(ranked[i - 1].item.value, item.value)
      const lastAttempt = i === ranked.length - 1
      if (await run(buildUrl(item.value), { lastAttempt })) {
        if (selected.value !== item.value) selectSource(item.value)
        return true
      }
      console.warn(`加速源下载失败，尝试下一个:${item.value}`)
    }
    return false
  }

  // agent 首屏：localStorage 只是占位，以服务端 settings.coreMirror 为准。
  // coreMirror 为空时清除本地显式选择标记，保持“打开弹窗自动测速”的桌面同款语义。
  if (isAgentMode) {
    void Promise.all([backendSettings().get(), backendPackages().list()]).then(
      ([settings, info]) => {
        mirrorLocked.value = info.mirrorLocked
        // 异步返回前用户已手动选择：不覆盖
        if (selectTicket !== 0) return
        const value = settings.coreMirror || GITHUB_EASYTIER
        if (settings.coreMirror && !sources.value.some((s) => s.value === settings.coreMirror)) {
          custom.value = [...custom.value, settings.coreMirror]
          writeStringList(MIRROR_CUSTOM_KEY, custom.value)
          rebuildSources()
        }
        selected.value = value
        if (settings.coreMirror) localStorage.setItem(MIRROR_SOURCE_KEY, settings.coreMirror)
        else localStorage.removeItem(MIRROR_SOURCE_KEY)
      },
      () => {
        /* 服务端不可达时保留 localStorage 占位选择 */
      }
    )
  }

  return {
    sources,
    probing,
    selected,
    selectedSource,
    mirrorLocked,
    probeAll,
    probeAllWith,
    probeSource,
    waitForProbe,
    rankByThroughput,
    downloadFromMirrors,
    selectSource,
    addSource,
    removeSource,
    canRestoreDefaults,
    restoreDefaults
  }
}
