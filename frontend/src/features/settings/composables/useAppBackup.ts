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
import { useEasyTierStore } from '@/shared/store/easytier'
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
import { isValidConfigName } from '@/shared/lib/configNameUtil'
import { migrateLockPassword } from '@/shared/platform/lockUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getAppVersion } from '@/shared/platform/sysUtil'

const THEME_KEY = 'theme'
const LANG_KEY = 'lang'
const SERVICE_CONFIG_PREFIX = 'service-config:'

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
      if (!isValidConfigName(name)) continue
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

  return {
    version: 1,
    store: {
      p2pNotifySetting: store.p2pNotifySetting,
      refreshInterval: store.refreshInterval,
      selectedColumns: [...store.selectedColumns],
      defaultServiceInstallMethod: store.defaultServiceInstallMethod,
      defaultEnableAutostart: store.defaultEnableAutostart,
      autoRunNetworkSetting: store.autoRunNetworkSetting,
      autoRunConfigName: store.autoRunConfigName
    },
    local,
    serviceConfigs: orderedServiceConfigs
  }
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

const collectWebValue = async (): Promise<string> => {
  const list = await useMockData().readWebConfigList()
  return JSON.stringify(list)
}

const collectConfigItems = async (): Promise<BackupItem[]> => {
  const { listTomlFiles, readFileContent } = useMockData()
  const files = (await listTomlFiles()).filter((name) => name.endsWith('.toml'))
  const items: BackupItem[] = []
  for (const file of files) {
    try {
      const content = (await readFileContent(`${CONFIG_PATH}/${file}`)) as string
      // readFileContent 读取失败会返回空串，跳过避免把无效条目写入备份
      if (!content.trim()) continue
      items.push(createBackupItem('configs', file, content))
    } catch {
      /* 单个配置读取失败时跳过，避免整份备份无法创建 */
    }
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
  const [files, web] = await Promise.all([listTomlFiles(), readWebConfigList()])
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
  manifest: BackupManifest
): Promise<Record<string, string | null>> => {
  const selected = new Set(manifest.categories)
  const values: Record<string, string | null> = {}
  if (selected.has('configs')) {
    const { listTomlFiles, readFileContent } = useMockData()
    const files = (await listTomlFiles()).filter((name) => name.endsWith('.toml'))
    for (const file of files) {
      try {
        values[`config:${file}`] = (await readFileContent(`${CONFIG_PATH}/${file}`)) as string
      } catch {
        /* 读取失败按不存在处理，恢复时会提示为新增/冲突 */
      }
    }
  }
  if (selected.has('web')) values.web = await collectWebValue()
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
export const createRestorePlan = async (manifest: BackupManifest): Promise<RestorePlan> => {
  const localValues = await collectLocalBackupValues(manifest)
  return buildRestorePlan(manifest, localValues)
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

const applyPreferences = (item: BackupItem): void => {
  const payload = sanitizePreferencesPayload(item.value)
  if (!payload) throw new Error('invalid preferences payload')
  for (const key of RESTORABLE_PREFERENCE_LOCAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload.local, key)) {
      localStorage.setItem(key, payload.local[key])
    } else {
      localStorage.removeItem(key)
    }
  }
  // 旧备份可能只带 settings.autoRun* 本地键：迁移进 store（单一真源）后清理残留
  const legacy = extractLegacyAutoRunSettings(payload.local)
  const patch: PreferencesPayload['store'] = { ...payload.store }
  if (patch.autoRunNetworkSetting === undefined && legacy.autoRunNetworkSetting !== undefined) {
    patch.autoRunNetworkSetting = legacy.autoRunNetworkSetting
  }
  if (patch.autoRunConfigName === undefined && legacy.autoRunConfigName !== undefined) {
    patch.autoRunConfigName = legacy.autoRunConfigName
  }
  for (const key of LEGACY_AUTO_RUN_LOCAL_KEYS) localStorage.removeItem(key)
  // 服务安装方式按“合并”恢复：不删除本地其它配置的记录，避免已有服务失去方式识别
  for (const [key, value] of Object.entries(payload.serviceConfigs)) {
    localStorage.setItem(key, value)
  }
  // store 已由 pinia 持久化插件管理，$patch 会同步写回 localStorage
  useEasyTierStore().$patch(patch)
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

const applyEntry = async (item: BackupItem): Promise<void> => {
  switch (item.category) {
    case 'configs':
      if (!isValidBackupConfigName(item.name)) throw new Error('invalid config name')
      await useMockData().writeFileContent(`${CONFIG_PATH}/${item.name}`, item.value)
      return
    case 'web': {
      const list = parseWebConfigValue(item.value)
      if (!list) throw new Error('invalid web config payload')
      await useMockData().writeWebConfigList(list as unknown as FormWebData[])
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
}

/** 按逐项选择应用恢复；无效项与“保留本地”项跳过 */
export const applyRestore = async (
  plan: RestorePlan,
  choices: Record<string, RestoreChoice>
): Promise<ApplyRestoreResult> => {
  let applied = 0
  const failed: string[] = []
  for (const entry of plan.entries) {
    if (entry.status === 'invalid' || choices[entry.item.id] !== 'backup') continue
    try {
      await applyEntry(entry.item)
      applied += 1
    } catch (error) {
      console.error('恢复备份条目失败:', entry.item.id, error)
      failed.push(entry.item.id)
    }
  }
  return { applied, failed }
}
