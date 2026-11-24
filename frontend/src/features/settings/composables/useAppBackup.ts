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
  type RestorePlan
} from '@/features/settings/lib/backupUtil'
import {
  isServiceConfigStorageName,
  SERVICE_CONFIG_PREFIX
} from '@/shared/platform/serviceInstallRecord'
import { migrateLockPassword, sha256Hex } from '@/shared/platform/lockUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getAppVersion } from '@/shared/platform/sysUtil'

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

/** 采集应用偏好：easytier 持久化字段 + settings.* 独立键 + 服务安装方式 */
const collectPreferencesPayload = (): PreferencesPayload => {
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
  return {
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

/** 采集加速源：选择结果与自定义/隐藏列表 */
const collectMirrorPayload = (): MirrorPayload => {
  const source = readStorage(MIRROR_SOURCE_KEY)
  const payload: MirrorPayload = { version: 1 }
  if (source && URL_PATTERN.test(source)) {
    payload.source = normalizeMirrorStorageSource(source)
  }
  payload.custom = readMirrorList(MIRROR_CUSTOM_KEY)
  payload.hidden = readMirrorList(MIRROR_HIDDEN_KEY)
  return payload
}

const collectWebValue = async (): Promise<string> =>
  runWebConfigTransaction(async ({ snapshot }) => JSON.stringify(await snapshot()))

const collectConfigItems = async (): Promise<BackupItem[]> => {
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
    items.push(createBackupItem('preferences', '', JSON.stringify(collectPreferencesPayload())))
  }
  if (selected.has('appearance')) {
    items.push(createBackupItem('appearance', '', JSON.stringify(collectAppearancePayload())))
  }
  if (selected.has('security')) {
    items.push(createBackupItem('security', '', useEasyTierStore().lockPassword))
  }
  if (selected.has('mirror')) {
    items.push(createBackupItem('mirror', '', JSON.stringify(collectMirrorPayload())))
  }
  return items
}

export interface BackupContentCounts {
  configs: number
  web: number
}

/** 分类内容数量（仅用于创建页展示，配置与 Web 配置为动态数量） */
export const getBackupContentCounts = async (): Promise<BackupContentCounts> => {
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
  if (selected.has('web')) {
    values.web = webTransaction
      ? JSON.stringify(await webTransaction.snapshot())
      : await collectWebValue()
  }
  if (selected.has('preferences')) {
    values.preferences = JSON.stringify(collectPreferencesPayload())
  }
  if (selected.has('appearance')) {
    values.appearance = JSON.stringify(collectAppearancePayload())
  }
  if (selected.has('security')) values.security = useEasyTierStore().lockPassword
  if (selected.has('mirror')) values.mirror = JSON.stringify(collectMirrorPayload())
  return values
}

/** 读取本地当前值并生成恢复计划（含冲突检测与内容校验） */
export const createRestorePlan = async (manifest: BackupManifest): Promise<RestorePlan> =>
  runTomlTransaction(async () => {
    const localValues = await collectLocalBackupValues(manifest)
    return buildRestorePlan(manifest, localValues)
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

const applyPreferencesPayload = (
  payload: PreferencesPayload,
  options: {
    replaceServiceConfigs?: boolean
    rawServiceConfigs?: Record<string, string>
    rawPreferenceLocal?: RawPreferenceLocalSnapshot
  } = {}
): void => {
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
}

const applyPreferences = (item: BackupItem): void => {
  const payload = sanitizePreferencesPayload(item.value)
  if (!payload) throw new Error('invalid preferences payload')
  applyPreferencesPayload(payload)
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

const applyMirror = (item: BackupItem): void => {
  const payload = sanitizeMirrorPayload(item.value)
  if (!payload) throw new Error('invalid mirror payload')
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

const applyEntry = async (
  item: BackupItem,
  webTransaction?: WebConfigTransactionOps
): Promise<void> => {
  switch (item.category) {
    case 'configs':
      if (!isValidBackupConfigName(item.name)) throw new Error('invalid config name')
      await useMockData().writeFileContent(`${CONFIG_PATH}/${item.name}`, item.value)
      return
    case 'web': {
      const list = parseWebConfigValue(item.value)
      if (!list) throw new Error('invalid web config payload')
      if (!webTransaction) throw new Error('web restore requires queue transaction')
      await webTransaction.replace(list as unknown as FormWebData[])
      return
    }
    case 'preferences':
      applyPreferences(item)
      return
    case 'appearance':
      await applyAppearance(item)
      return
    case 'security':
      applySecurity(item)
      return
    case 'mirror':
      applyMirror(item)
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
}

type RestoreSnapshot =
  | { kind: 'config-file'; path: string; existed: boolean; value: string }
  | { kind: 'web-list'; value: string }
  | {
      kind: 'preferences'
      value: string
      rawServiceConfigs: Record<string, string>
      rawPreferenceLocal: RawPreferenceLocalSnapshot
    }
  | { kind: 'appearance'; value: string }
  | { kind: 'security'; value: string }
  | { kind: 'mirror'; value: string }

/** 采集恢复目标的当前状态；任何一步失败都中止恢复，不产生部分写入 */
const captureRestoreSnapshot = async (
  item: BackupItem,
  webTransaction?: WebConfigTransactionOps
): Promise<RestoreSnapshot> => {
  switch (item.category) {
    case 'configs': {
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
    case 'preferences':
      return {
        kind: 'preferences',
        value: JSON.stringify(collectPreferencesPayload()),
        rawServiceConfigs: collectRawServiceConfigs(),
        rawPreferenceLocal: collectRawPreferenceLocal()
      }
    case 'appearance':
      return { kind: 'appearance', value: JSON.stringify(collectAppearancePayload()) }
    case 'security':
      return { kind: 'security', value: useEasyTierStore().lockPassword }
    case 'mirror':
      return { kind: 'mirror', value: JSON.stringify(collectMirrorPayload()) }
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
      applyPreferencesPayload(payload, {
        replaceServiceConfigs: true,
        rawServiceConfigs: snap.rawServiceConfigs,
        rawPreferenceLocal: snap.rawPreferenceLocal
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
      applyMirror({ ...item, value: snap.value })
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
    const runTransaction = (webTransaction?: WebConfigTransactionOps) =>
      runRestoreTransaction(items, {
        snapshot: (item) => captureRestoreSnapshot(item, webTransaction),
        apply: (item) => applyEntry(item, webTransaction),
        rollback: (item, snapshot) => rollbackRestoreEntry(item, snapshot, webTransaction)
      })

    if (items.some((item) => item.category === 'web')) {
      // 校验与恢复必须占用同一次 Web 队列事务，检查结束后不能释放给页面写入。
      return runWebConfigTransaction(async (webTransaction) => {
        await assertRestorePlanUnchanged(plan, webTransaction)
        return runTransaction(webTransaction)
      })
    }
    await assertRestorePlanUnchanged(plan)
    return runTransaction()
  })
