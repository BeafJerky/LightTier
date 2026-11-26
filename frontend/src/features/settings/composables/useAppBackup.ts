/**
 * 备份与恢复的应用层
 *
 * - 采集：网络配置（config/*.toml）、Web 配置列表（config/data.json）、应用偏好、
 *   外观与语言、锁屏密码校验串、加速源；全部序列化为可移植的 JSON 清单。
 * - 导出：桌面走 Tauri 保存对话框；浏览器 Mock 走 Blob 下载（便于 pnpm dev 验证）。
 * - 导入：桌面走 Tauri 打开对话框；浏览器由组件读取 <input type="file"> 文本后传入。
 * - 恢复：按用户逐项选择写回配置与设置，随后由界面重新加载应用使设置生效。
 *
 * 配置读写复用 useMockData 的分发层，浏览器预览下同样可用；外部主题 CSS 不随备份
 * 迁移，恢复时若主题文件不存在则回退为跟随系统主题。
 */
import pkg from '../../../../../package.json'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { CONFIG_PATH, GITHUB_EASYTIER } from '@/shared/constants/easytier'
import {
  MIRROR_CUSTOM_KEY,
  MIRROR_HIDDEN_KEY,
  MIRROR_SOURCE_KEY
} from '@/shared/composables/useMirrorProbe'
import { loadThemeCss } from '@/shared/composables/useExternalThemes'
import { normalizeMirrorPrefix as normalizeServerMirrorPrefix } from '@/shared/lib/mirrorUtil'
import { useMockData } from '@/shared/platform/mockData'
import {
  runTomlTransaction,
  runWebConfigTransaction,
  type WebConfigTransactionOps
} from '@/shared/platform/webConfigStorage'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandStore } from '@/shared/store/island'
import type { FormWebData } from '@/entities/config/formTypes'
import {
  buildBackupFileName,
  buildBackupManifest,
  buildRestorePlan,
  createBackupItem,
  extractLegacyAutoRunSettings,
  isValidBackupConfigName,
  LEGACY_AUTO_RUN_LOCAL_KEYS,
  parseWebConfigValue,
  RESTORABLE_PREFERENCE_LOCAL_KEYS,
  runRestoreTransaction,
  sanitizeAppearancePayload,
  sanitizeMirrorPayload,
  sanitizePreferencesPayload,
  type AppearancePayload,
  type BackupCategory,
  type BackupItem,
  type BackupManifest,
  type BackupMode,
  type MirrorPayload,
  type PreferencesPayload,
  type RestoreChoice,
  type RestorePlan,
  type ServerSettingsPayload
} from '@/features/settings/lib/backupUtil'
import {
  isServiceConfigStorageName,
  SERVICE_CONFIG_PREFIX
} from '@/shared/platform/serviceInstallRecord'
import { migrateLockPassword, sha256Hex } from '@/shared/platform/lockUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getAppVersion } from '@/shared/platform/sysUtil'
import {
  backendCapabilities,
  backendConfigs,
  backendMode,
  backendPackages,
  backendSettings,
  backendWeb,
  isApiError
} from '@/shared/platform/backend'

const THEME_KEY = 'theme'
const LANG_KEY = 'lang'

const SUPPORTED_LANGS = ['zh-CN', 'en'] as const
const THEME_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const URL_PATTERN = /^https?:\/\/\S+$/i

const runtimeIsTauri = (): boolean => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
}

const isDesktopRuntime = (): boolean => runtimeIsTauri() && !isAndroid()

const isAgentMode = (): boolean => backendMode() === 'agent'

/** 当前形态不支持恢复的分类：agent 没有桌面本机锁屏，security 不适用 */
export const unsupportedBackupCategories = (): BackupCategory[] =>
  isAgentMode() ? ['security'] : []

/** agent 服务端设置的完整快照，用于恢复失败时精确回滚 */
interface ServerSettingsSnapshot {
  autoStartLastRunning: boolean
  noTun: boolean
  logLevel: string
  coreMirror: string
}

/** agent 加速源状态：locked 来自 LT_CORE_MIRROR 环境变量 */
interface AgentMirrorState {
  locked: boolean
  coreMirror: string
}

/** 恢复过程中的非致命提示（由界面转成 i18n 文案） */
export type RestoreWarning = 'mirror-locked'

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const PREFERENCE_LOCAL_SNAPSHOT_KEYS = [
  ...RESTORABLE_PREFERENCE_LOCAL_KEYS,
  ...LEGACY_AUTO_RUN_LOCAL_KEYS
] as const
type RawPreferenceLocalSnapshot = Record<
  (typeof PREFERENCE_LOCAL_SNAPSHOT_KEYS)[number],
  string | null
>

/** 偏好回滚快照保留原始值及缺失状态，不经过备份载荷清洗。 */
const collectRawPreferenceLocal = (): RawPreferenceLocalSnapshot =>
  Object.fromEntries(
    PREFERENCE_LOCAL_SNAPSHOT_KEYS.map((key) => [key, localStorage.getItem(key)])
  ) as RawPreferenceLocalSnapshot

// 语言由 useStorage 以 JSON 字符串写入（"zh-CN"），同时兼容旧备份恢复出的裸值
const readLangStorage = (): string => {
  const raw = readStorage(LANG_KEY)
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
  } catch {
    /* 裸值 */
  }
  return raw
}

const readJsonStorage = (key: string): unknown => {
  const raw = readStorage(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const getBackupAppVersion = async (): Promise<string> => {
  if (!runtimeIsTauri()) return pkg.version
  try {
    return await getAppVersion()
  } catch {
    return pkg.version
  }
}

const normalizeMirrorPrefix = (value: string): string => value.replace(/\/+$/, '') + '/'

const normalizeMirrorStorageSource = (value: string): string => {
  const normalized = normalizeMirrorPrefix(value)
  // useMirrorProbe 的官方源不带尾部斜杠，保持原值避免恢复后被判定为未知源
  return normalized === `${GITHUB_EASYTIER}/` ? GITHUB_EASYTIER : normalized
}

const readMirrorList = (key: string): string[] => {
  const parsed = readJsonStorage(key)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item): item is string => typeof item === 'string' && URL_PATTERN.test(item))
    .map(normalizeMirrorPrefix)
    .filter((item, index, list) => list.indexOf(item) === index)
}

/** agent 服务端设置快照：只在 agent 采集时写入偏好载荷的 server 段 */
const collectServerSettings = async (): Promise<ServerSettingsSnapshot> => {
  const settings = await backendSettings().get()
  return {
    autoStartLastRunning: settings.autoStartLastRunning,
    noTun: settings.noTun,
    logLevel: settings.logLevel,
    coreMirror: settings.coreMirror ? (normalizeServerMirrorPrefix(settings.coreMirror) ?? '') : ''
  }
}

/** 采集应用偏好：easytier 持久化字段 + settings.* 独立键 + 服务安装方式（agent 另有服务端段） */
const collectPreferencesPayload = async (
  serverSettings?: ServerSettingsPayload
): Promise<PreferencesPayload> => {
  const store = useEasyTierStore()
  const local: Record<string, string> = {}
  for (const key of RESTORABLE_PREFERENCE_LOCAL_KEYS) {
    const value = readStorage(key)
    if (value !== null) local[key] = value
  }

  const serviceConfigs: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(SERVICE_CONFIG_PREFIX)) continue
      const name = key.slice(SERVICE_CONFIG_PREFIX.length)
      if (!isServiceConfigStorageName(name)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        const method = (parsed as Record<string, unknown>).installMethod
        if (method !== 'nssm' && method !== 'official') continue
        serviceConfigs[name] = raw
      } catch {
        /* 损坏的服务安装记录不进入备份 */
      }
    }
  } catch {
    /* localStorage 不可用时仅备份内存设置 */
  }
  const orderedServiceConfigs: Record<string, string> = {}
  Object.keys(serviceConfigs)
    .sort()
    .forEach((name) => {
      orderedServiceConfigs[name] = serviceConfigs[name]
    })

  const island = useIslandStore()
  const payload: PreferencesPayload = {
    version: 1,
    store: {
      p2pNotifySetting: store.p2pNotifySetting,
      refreshInterval: store.refreshInterval,
      selectedColumns: [...store.selectedColumns],
      defaultServiceInstallMethod: store.defaultServiceInstallMethod,
      defaultEnableAutostart: store.defaultEnableAutostart,
      autoRunNetworkSetting: store.autoRunNetworkSetting,
      autoRunConfigName: store.autoRunConfigName,
      islandSettings: {
        ...island.settings,
        types: { ...island.settings.types }
      }
    },
    local,
    serviceConfigs: orderedServiceConfigs
  }
  // 桌面 / Android 的备份不写 server 段：本机没有这些概念
  if (isAgentMode()) payload.server = serverSettings ?? (await collectServerSettings())
  return payload
}

/** 回滚快照不做业务清洗：前缀键的原始值（含空串/损坏 JSON/异常名称）都必须精确保留 */
const collectRawServiceConfigs = (): Record<string, string> => {
  const configs: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(SERVICE_CONFIG_PREFIX)) continue
    const value = localStorage.getItem(key)
    if (value === null) throw new Error('service config snapshot changed during enumeration')
    configs[key] = value
  }
  return configs
}

/** 采集外观：主题与语言（明暗由主题自身的色板决定） */
const collectAppearancePayload = (): AppearancePayload => {
  const rawTheme = readStorage(THEME_KEY) || ''
  const rawLang = readLangStorage()
  return {
    version: 1,
    theme: THEME_ID_PATTERN.test(rawTheme) ? rawTheme : '',
    lang: (SUPPORTED_LANGS as readonly string[]).includes(rawLang) ? rawLang : ''
  }
}

/** 采集加速源：选择结果与自定义/隐藏列表（agent 的生效源以服务端设置为准） */
const collectMirrorPayload = async (): Promise<MirrorPayload> => {
  // 服务端空串代表官方直连，恢复时必须能表达这个确定状态
  const storedSource = isAgentMode()
    ? (await backendSettings().get()).coreMirror || GITHUB_EASYTIER
    : readStorage(MIRROR_SOURCE_KEY)
  const payload: MirrorPayload = { version: 1 }
  if (storedSource && URL_PATTERN.test(storedSource)) {
    payload.source = normalizeMirrorStorageSource(storedSource)
  }
  payload.custom = readMirrorList(MIRROR_CUSTOM_KEY)
  payload.hidden = readMirrorList(MIRROR_HIDDEN_KEY)
  return payload
}

const collectWebValue = async (): Promise<string> =>
  runWebConfigTransaction(async ({ snapshot }) => JSON.stringify(await snapshot()))

const collectConfigItems = async (): Promise<BackupItem[]> => {
  if (backendMode() === 'agent') {
    // agent 模式：配置由服务端托管，按 id 读取；条目名沿用 `<id>.toml` 与本机文件口径一致
    const metas = await backendConfigs().list()
    const items: BackupItem[] = []
    for (const meta of metas) {
      const { toml } = await backendConfigs().read(meta.id)
      if (!toml.trim()) continue
      items.push(createBackupItem('configs', `${meta.id}.toml`, toml))
    }
    return items
  }
  const { listTomlFiles, readFileContent } = useMockData()
  const files = (await listTomlFiles({ throwOnError: true })).filter((name) =>
    name.endsWith('.toml')
  )
  const items: BackupItem[] = []
  for (const file of files) {
    const content = (await readFileContent(`${CONFIG_PATH}/${file}`, {
      throwOnError: true
    })) as string
    if (!content.trim()) continue
    items.push(createBackupItem('configs', file, content))
  }
  return items
}

/** 按所选分类采集全部备份条目（固定分类始终各一个条目） */
export const collectBackupItems = async (categories: BackupCategory[]): Promise<BackupItem[]> => {
  const selected = new Set(categories)
  const items: BackupItem[] = []
  if (selected.has('configs')) items.push(...(await collectConfigItems()))
  if (selected.has('web')) {
    items.push(createBackupItem('web', '', await collectWebValue()))
  }
  if (selected.has('preferences')) {
    items.push(
      createBackupItem('preferences', '', JSON.stringify(await collectPreferencesPayload()))
    )
  }
  if (selected.has('appearance')) {
    items.push(createBackupItem('appearance', '', JSON.stringify(collectAppearancePayload())))
  }
  if (selected.has('security')) {
    items.push(createBackupItem('security', '', useEasyTierStore().lockPassword))
  }
  if (selected.has('mirror')) {
    items.push(createBackupItem('mirror', '', JSON.stringify(await collectMirrorPayload())))
  }
  return items
}

export interface BackupContentCounts {
  configs: number
  web: number
}

/** 分类内容数量（仅用于创建页展示，配置与 Web 配置为动态数量） */
export const getBackupContentCounts = async (): Promise<BackupContentCounts> => {
  if (isAgentMode()) {
    // agent：配置与 Web 配置都由服务端托管，统计不得读浏览器 Mock
    const [metas, web] = await Promise.all([
      backendConfigs().list(),
      backendCapabilities().web ? backendWeb().list() : Promise.resolve([])
    ])
    return {
      configs: metas.length,
      web: web.length
    }
  }
  const { listTomlFiles, readWebConfigList } = useMockData()
  const [files, web] = await Promise.all([
    listTomlFiles({ throwOnError: true }),
    readWebConfigList()
  ])
  return {
    configs: files.filter((name) => name.endsWith('.toml')).length,
    web: Array.isArray(web) ? web.length : 0
  }
}

export type ExportBackupResult =
  | { ok: true; fileName: string; itemCount: number; mode: BackupMode }
  | {
      ok: false
      reason: 'cancelled' | 'empty' | 'nothing-changed' | 'save-failed' | 'error'
    }

/** 创建并导出备份文件（完整或差量） */
export const exportBackup = async (options: {
  mode: BackupMode
  categories: BackupCategory[]
  base?: BackupManifest
}): Promise<ExportBackupResult> => {
  if (options.categories.length === 0) return { ok: false, reason: 'empty' }
  try {
    const items = await collectBackupItems(options.categories)
    const manifest = buildBackupManifest({
      mode: options.mode,
      categories: options.categories,
      items,
      appVersion: await getBackupAppVersion(),
      base: options.base
    })
    if (manifest.items.length === 0) {
      return { ok: false, reason: options.mode === 'diff' ? 'nothing-changed' : 'empty' }
    }
    const fileName = buildBackupFileName(manifest.mode)
    const text = JSON.stringify(manifest, null, 2)

    if (isDesktopRuntime()) {
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: 'LightTier Backup', extensions: ['json'] }]
      })
      if (!path) return { ok: false, reason: 'cancelled' }
      await writeTextFile(path, text)
    } else {
      if (typeof document === 'undefined') return { ok: false, reason: 'save-failed' }
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }

    return {
      ok: true,
      fileName,
      itemCount: manifest.items.length,
      mode: manifest.mode
    }
  } catch (error) {
    console.error('导出备份失败:', error)
    return { ok: false, reason: 'error' }
  }
}

export type PickBackupResult =
  | { ok: true; text: string; fileName: string }
  | { ok: false; reason: 'cancelled' | 'read-failed' | 'unsupported' }

/** 桌面端选择并读取备份文件；浏览器端由组件使用 file input 读取 */
export const pickBackupFile = async (): Promise<PickBackupResult> => {
  if (!isDesktopRuntime()) return { ok: false, reason: 'unsupported' }
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'LightTier Backup', extensions: ['json'] }]
    })
    if (!selected) return { ok: false, reason: 'cancelled' }
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return { ok: false, reason: 'cancelled' }
    const text = await readTextFile(path)
    const fileName = path.split(/[\\/]/).pop() || path
    return { ok: true, text, fileName }
  } catch (error) {
    console.error('读取备份文件失败:', error)
    return { ok: false, reason: 'read-failed' }
  }
}

/** 采集本地当前值，用于导入时逐项比较（未提供的条目按本地不存在处理） */
export const collectLocalBackupValues = async (
  manifest: BackupManifest,
  webTransaction?: WebConfigTransactionOps
): Promise<Record<string, string | null>> => {
  const selected = new Set(manifest.categories)
  const values: Record<string, string | null> = {}
  if (selected.has('configs')) {
    if (backendMode() === 'agent') {
      const metas = await backendConfigs().list()
      for (const meta of metas) {
        const { toml } = await backendConfigs().read(meta.id)
        values[`config:${meta.id}.toml`] = toml
      }
    } else {
      const { listTomlFiles, readFileContent } = useMockData()
      const files = (await listTomlFiles({ throwOnError: true })).filter((name) =>
        name.endsWith('.toml')
      )
      for (const file of files) {
        values[`config:${file}`] = (await readFileContent(`${CONFIG_PATH}/${file}`, {
          throwOnError: true
        })) as string
      }
    }
  }
  if (selected.has('web')) {
    values.web = webTransaction
      ? JSON.stringify(await webTransaction.snapshot())
      : await collectWebValue()
  }
  if (selected.has('preferences')) {
    values.preferences = JSON.stringify(await collectPreferencesPayload())
  }
  if (selected.has('appearance')) {
    values.appearance = JSON.stringify(collectAppearancePayload())
  }
  if (selected.has('security')) values.security = useEasyTierStore().lockPassword
  if (selected.has('mirror')) values.mirror = JSON.stringify(await collectMirrorPayload())
  return values
}

/** 读取本地当前值并生成恢复计划（含冲突检测与内容校验） */
export const createRestorePlan = async (manifest: BackupManifest): Promise<RestorePlan> =>
  runTomlTransaction(async () => {
    const localValues = await collectLocalBackupValues(manifest)
    return buildRestorePlan(manifest, localValues, unsupportedBackupCategories())
  })

export class RestorePlanChangedError extends Error {
  readonly code = 'restore_plan_changed'

  constructor() {
    super('restore_plan_changed')
    this.name = 'RestorePlanChangedError'
  }
}

/** 计划只描述生成时的本地状态；应用前重新读取并比较全部可恢复条目，任一漂移都需重新规划 */
const assertRestorePlanUnchanged = async (
  plan: RestorePlan,
  webTransaction?: WebConfigTransactionOps
): Promise<void> => {
  const currentValues = await collectLocalBackupValues(plan.manifest, webTransaction)
  for (const entry of plan.entries) {
    if (entry.status === 'invalid') continue
    const currentValue = currentValues[entry.item.id] ?? null
    const currentHash = currentValue === null ? null : sha256Hex(currentValue)
    if (currentHash !== entry.localHash) throw new RestorePlanChangedError()
  }
}

/** 外部主题 CSS 不随备份迁移：文件不存在时回退为跟随系统主题 */
const resolveRestorableTheme = async (theme: string): Promise<string> => {
  if (!theme) return ''
  if (theme === 'cream' || theme === 'dark') return theme
  if (!THEME_ID_PATTERN.test(theme)) return ''
  try {
    return (await loadThemeCss(theme)) ? theme : ''
  } catch {
    return ''
  }
}

const applyPreferencesPayload = async (
  payload: PreferencesPayload,
  options: {
    replaceServiceConfigs?: boolean
    rawServiceConfigs?: Record<string, string>
    rawPreferenceLocal?: RawPreferenceLocalSnapshot
    rawServerSettings?: ServerSettingsSnapshot | null
  } = {}
): Promise<void> => {
  if (options.rawPreferenceLocal) {
    for (const key of PREFERENCE_LOCAL_SNAPSHOT_KEYS) {
      const value = options.rawPreferenceLocal[key]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  } else {
    for (const key of RESTORABLE_PREFERENCE_LOCAL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(payload.local, key)) {
        localStorage.setItem(key, payload.local[key])
      } else {
        localStorage.removeItem(key)
      }
    }
  }
  // 旧备份可能只带 settings.autoRun* 本地键：迁移进 store（单一真源）后清理残留
  const legacy = extractLegacyAutoRunSettings(payload.local)
  const patch: PreferencesPayload['store'] = { ...payload.store }
  delete patch.islandSettings
  if (patch.autoRunNetworkSetting === undefined && legacy.autoRunNetworkSetting !== undefined) {
    patch.autoRunNetworkSetting = legacy.autoRunNetworkSetting
  }
  if (patch.autoRunConfigName === undefined && legacy.autoRunConfigName !== undefined) {
    patch.autoRunConfigName = legacy.autoRunConfigName
  }
  if (!options.rawPreferenceLocal) {
    for (const key of LEGACY_AUTO_RUN_LOCAL_KEYS) localStorage.removeItem(key)
  }
  // 回滚需要精确还原：先清空本地服务安装记录，再写回快照；正常恢复按“合并”处理，
  // 不删除本地其它配置的记录，避免已有服务失去方式识别。
  if (options.replaceServiceConfigs) {
    const tracked: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(SERVICE_CONFIG_PREFIX)) tracked.push(key)
    }
    for (const key of tracked) localStorage.removeItem(key)
  }
  const serviceConfigs = options.rawServiceConfigs ?? payload.serviceConfigs
  for (const [key, value] of Object.entries(serviceConfigs)) {
    localStorage.setItem(key, value)
  }
  // store 已由 pinia 持久化插件管理，$patch 会同步写回 localStorage
  useEasyTierStore().$patch(patch)
  if (payload.store.islandSettings) {
    useIslandStore().restoreSettings(payload.store.islandSettings)
  }
  if (!isAgentMode()) return
  // 回滚：服务端设置按快照整份写回，避免留下“本地已回滚、服务端还是新值”
  if (options.rawServerSettings) {
    await backendSettings().put({ ...options.rawServerSettings })
    return
  }
  const serverPatch: ServerSettingsPayload = {}
  // 自动运行设置以本地 store 的恢复值为准（旧备份的 legacy 键也已并入 patch），
  // 备份里没有该值时退回 server 段记录的值
  const autoRun = patch.autoRunNetworkSetting ?? payload.server?.autoStartLastRunning
  if (autoRun !== undefined) serverPatch.autoStartLastRunning = autoRun
  if (payload.server?.noTun !== undefined) serverPatch.noTun = payload.server.noTun
  if (payload.server?.logLevel !== undefined) serverPatch.logLevel = payload.server.logLevel
  if (payload.server?.coreMirror !== undefined) serverPatch.coreMirror = payload.server.coreMirror
  if (Object.keys(serverPatch).length) await backendSettings().put(serverPatch)
}

const applyPreferences = async (item: BackupItem): Promise<void> => {
  const payload = sanitizePreferencesPayload(item.value)
  if (!payload) throw new Error('invalid preferences payload')
  await applyPreferencesPayload(payload)
}

const applyAppearance = async (item: BackupItem): Promise<void> => {
  const payload = sanitizeAppearancePayload(item.value)
  if (!payload) throw new Error('invalid appearance payload')
  if (payload.theme !== undefined) {
    const theme = await resolveRestorableTheme(payload.theme)
    if (theme) localStorage.setItem(THEME_KEY, theme)
    else localStorage.removeItem(THEME_KEY)
  }
  if (payload.lang !== undefined) {
    // 与 useStorage 保持一致写入 JSON 字符串，避免下次采集/刷新读不到
    if (payload.lang) localStorage.setItem(LANG_KEY, JSON.stringify(payload.lang))
    else localStorage.removeItem(LANG_KEY)
  }
}

const applySecurity = (item: BackupItem): void => {
  const value = migrateLockPassword(item.value)
  useEasyTierStore().$patch({ lockPassword: value })
}

/** 读 agent 加速源状态：locked 为部署方环境变量锁定，coreMirror 为服务端生效源 */
const readAgentMirrorState = async (): Promise<AgentMirrorState> => {
  const [info, settings] = await Promise.all([backendPackages().list(), backendSettings().get()])
  return { locked: info.mirrorLocked, coreMirror: settings.coreMirror }
}

/** 服务端 coreMirror 口径：官方源存空串（与 useMirrorProbe 的选择语义一致） */
const toServerMirror = (source: string): string => (source === `${GITHUB_EASYTIER}/` ? '' : source)

const applyMirrorLocal = (payload: MirrorPayload): void => {
  if (payload.source !== undefined) {
    if (!payload.source) {
      localStorage.removeItem(MIRROR_SOURCE_KEY)
    } else {
      localStorage.setItem(
        MIRROR_SOURCE_KEY,
        payload.source === `${GITHUB_EASYTIER}/` ? GITHUB_EASYTIER : payload.source
      )
    }
  }
  if (payload.custom !== undefined) {
    if (payload.custom.length)
      localStorage.setItem(MIRROR_CUSTOM_KEY, JSON.stringify(payload.custom))
    else localStorage.removeItem(MIRROR_CUSTOM_KEY)
  }
  if (payload.hidden !== undefined) {
    if (payload.hidden.length)
      localStorage.setItem(MIRROR_HIDDEN_KEY, JSON.stringify(payload.hidden))
    else localStorage.removeItem(MIRROR_HIDDEN_KEY)
  }
}

const applyMirror = async (
  item: BackupItem,
  options: { restore?: AgentMirrorState | null; warnings?: RestoreWarning[] } = {}
): Promise<void> => {
  const payload = sanitizeMirrorPayload(item.value)
  if (!payload) throw new Error('invalid mirror payload')
  applyMirrorLocal(payload)
  if (!isAgentMode()) return
  if (options.restore) {
    if (options.restore.locked) return
    await backendSettings().put({ coreMirror: options.restore.coreMirror })
    return
  }
  if (payload.source === undefined) return
  const state = await readAgentMirrorState()
  if (state.locked) {
    // 环境变量锁定：服务端拒绝写入，保留部署方选择并明确提示而不是静默失败
    options.warnings?.push('mirror-locked')
    return
  }
  await backendSettings().put({ coreMirror: toServerMirror(payload.source) })
}

const applyEntry = async (
  item: BackupItem,
  webTransaction?: WebConfigTransactionOps,
  warnings?: RestoreWarning[]
): Promise<void> => {
  switch (item.category) {
    case 'configs':
      if (!isValidBackupConfigName(item.name)) throw new Error('invalid config name')
      if (backendMode() === 'agent') {
        // agent 模式：备份条目名 `<id>.toml`，写回时还原为服务端配置 id
        await backendConfigs().write(item.name.replace(/\.toml$/i, ''), item.value)
      } else {
        await useMockData().writeFileContent(`${CONFIG_PATH}/${item.name}`, item.value)
      }
      return
    case 'web': {
      const list = parseWebConfigValue(item.value)
      if (!list) throw new Error('invalid web config payload')
      if (!webTransaction) throw new Error('web restore requires queue transaction')
      await webTransaction.replace(list as unknown as FormWebData[])
      return
    }
    case 'preferences':
      await applyPreferences(item)
      return
    case 'appearance':
      await applyAppearance(item)
      return
    case 'security':
      // agent 没有桌面本机锁屏：恢复计划已判为不支持，这里再拦一次防止误写
      if (isAgentMode()) throw new Error('security backup is not supported in agent mode')
      applySecurity(item)
      return
    case 'mirror':
      await applyMirror(item, { warnings })
      return
    default:
      throw new Error(`unknown backup category: ${(item as BackupItem).category}`)
  }
}

export interface ApplyRestoreResult {
  applied: number
  failed: string[]
  /** 中途失败后已回滚到操作前状态；回滚自身失败时为 false */
  rolledBack: boolean
  /** 非致命提示（仅成功路径返回）：目前只有加速源被环境变量锁定 */
  warnings?: RestoreWarning[]
}

type RestoreSnapshot =
  | { kind: 'config-file'; path: string; existed: boolean; value: string }
  | { kind: 'web-list'; value: string }
  | {
      kind: 'preferences'
      value: string
      rawServiceConfigs: Record<string, string>
      rawPreferenceLocal: RawPreferenceLocalSnapshot
      /** agent 才采集：服务端设置原值，回滚时整份写回 */
      rawServerSettings: ServerSettingsSnapshot | null
    }
  | { kind: 'appearance'; value: string }
  | { kind: 'security'; value: string }
  | { kind: 'mirror'; value: string; agentMirror: AgentMirrorState | null }

/** 采集恢复目标的当前状态；任何一步失败都中止恢复，不产生部分写入 */
const captureRestoreSnapshot = async (
  item: BackupItem,
  webTransaction?: WebConfigTransactionOps
): Promise<RestoreSnapshot> => {
  switch (item.category) {
    case 'configs': {
      if (backendMode() === 'agent') {
        const id = item.name.replace(/\.toml$/i, '')
        const metas = await backendConfigs().list()
        const existed = metas.some((meta) => meta.id === id)
        const value = existed ? (await backendConfigs().read(id)).toml : ''
        return { kind: 'config-file', path: id, existed, value }
      }
      const path = `${CONFIG_PATH}/${item.name}`
      const files = await useMockData().listTomlFiles({ throwOnError: true })
      const existed = files.includes(item.name)
      const value = existed
        ? ((await useMockData().readFileContent(path, { throwOnError: true })) as string)
        : ''
      return { kind: 'config-file', path, existed, value }
    }
    case 'web': {
      if (!webTransaction) throw new Error('web restore requires queue transaction')
      const list = await webTransaction.snapshot()
      return { kind: 'web-list', value: JSON.stringify(list) }
    }
    case 'preferences': {
      // agent 先取一次服务端快照：既写进 value 参与冲突比较，也供回滚原样写回
      const rawServerSettings = isAgentMode() ? await collectServerSettings() : null
      return {
        kind: 'preferences',
        value: JSON.stringify(await collectPreferencesPayload(rawServerSettings ?? undefined)),
        rawServiceConfigs: collectRawServiceConfigs(),
        rawPreferenceLocal: collectRawPreferenceLocal(),
        rawServerSettings
      }
    }
    case 'appearance':
      return { kind: 'appearance', value: JSON.stringify(collectAppearancePayload()) }
    case 'security':
      return { kind: 'security', value: useEasyTierStore().lockPassword }
    case 'mirror':
      return {
        kind: 'mirror',
        value: JSON.stringify(await collectMirrorPayload()),
        agentMirror: isAgentMode() ? await readAgentMirrorState() : null
      }
    default:
      throw new Error(`unknown backup category: ${(item as BackupItem).category}`)
  }
}

const rollbackRestoreEntry = async (
  item: BackupItem,
  snapshot: unknown,
  webTransaction?: WebConfigTransactionOps
): Promise<void> => {
  const snap = snapshot as RestoreSnapshot
  if (snap.kind === 'config-file') {
    if (backendMode() === 'agent') {
      // agent 模式：path 为配置 id；已存在则覆盖，否则删除（已被其他会话删除视为成功）
      if (snap.existed) {
        await backendConfigs().write(snap.path, snap.value)
      } else {
        try {
          await backendConfigs().remove(snap.path)
        } catch (error) {
          if (!(isApiError(error) && error.status === 404)) throw error
        }
      }
      return
    }
    if (snap.existed) await useMockData().writeFileContent(snap.path, snap.value)
    else await useMockData().deleteFileOrDir(snap.path)
    return
  }
  if (snap.kind === 'web-list') {
    const list = parseWebConfigValue(snap.value)
    if (!list) throw new Error('invalid web snapshot')
    if (!webTransaction) throw new Error('web restore requires queue transaction')
    // 缺失与空列表在读路径上等价，统一在队列内写回快照（包括空数组），不直接删除文件
    await webTransaction.replace(list as unknown as FormWebData[])
    return
  }
  if (snap.kind !== item.category) throw new Error('restore snapshot mismatch')
  switch (snap.kind) {
    case 'preferences': {
      // 本地键可能含空串/损坏值，不能用整份载荷反清洗；store 仍按原快照策略恢复。
      const snapshotPayload = JSON.parse(snap.value) as { store?: unknown }
      const payload = sanitizePreferencesPayload(
        JSON.stringify({ version: 1, store: snapshotPayload.store })
      )
      if (!payload) throw new Error('invalid preferences snapshot')
      await applyPreferencesPayload(payload, {
        replaceServiceConfigs: true,
        rawServiceConfigs: snap.rawServiceConfigs,
        rawPreferenceLocal: snap.rawPreferenceLocal,
        rawServerSettings: snap.rawServerSettings
      })
      return
    }
    case 'appearance':
      await applyAppearance({ ...item, value: snap.value })
      return
    case 'security':
      useEasyTierStore().$patch({ lockPassword: snap.value })
      return
    case 'mirror':
      await applyMirror({ ...item, value: snap.value }, { restore: snap.agentMirror })
      return
  }
}

/** 按逐项选择应用恢复；无效项与“保留本地”项跳过，任一失败则整体回滚 */
export const applyRestore = async (
  plan: RestorePlan,
  choices: Record<string, RestoreChoice>
): Promise<ApplyRestoreResult> =>
  runTomlTransaction(async () => {
    const items = plan.entries
      .filter((entry) => entry.status !== 'invalid' && choices[entry.item.id] === 'backup')
      .map((entry) => entry.item)
    const warnings: RestoreWarning[] = []
    const runTransaction = (webTransaction?: WebConfigTransactionOps) =>
      runRestoreTransaction(items, {
        snapshot: (item) => captureRestoreSnapshot(item, webTransaction),
        apply: (item) => applyEntry(item, webTransaction, warnings),
        rollback: (item, snapshot) => rollbackRestoreEntry(item, snapshot, webTransaction)
      })

    const result = items.some((item) => item.category === 'web')
      ? // 校验与恢复必须占用同一次 Web 队列事务，检查结束后不能释放给页面写入。
        await runWebConfigTransaction(async (webTransaction) => {
          await assertRestorePlanUnchanged(plan, webTransaction)
          return runTransaction(webTransaction)
        })
      : await (async () => {
          await assertRestorePlanUnchanged(plan)
          return runTransaction()
        })()
    // 回滚路径不返回提示，避免“恢复失败已回滚”时再出现误导性的跳过说明
    return warnings.length && result.failed.length === 0 ? { ...result, warnings } : result
  })
