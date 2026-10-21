/**
 * 备份与恢复的纯数据层
 *
 * 负责：
 * - 备份清单结构定义与严格解析（错误文件不会进入恢复流程）
 * - 完整备份 / 差量备份构建（差量以用户选择的完整备份为基准，仅收录新增与修改项）
 * - 导入时的本地对照、逐项校验与冲突状态计算（same/new/safe/conflict/invalid）
 * - 各分类载荷的清洗与校验，保证写回前字段类型可控
 *
 * 本文件不依赖 Tauri / Pinia，便于单元测试；文件读写与状态应用见 useAppBackup。
 * 凭据安全：锁屏密码仅备份加盐校验串（sha256$salt$hash），旧版明文在应用时迁移。
 */
import { isValidConfigName } from './configNameUtil'
import { sha256Hex } from './lockUtil'
import { validateToml } from './tomlValidationUtil'

export const BACKUP_APP = 'lighttier'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_CATEGORIES = [
  'configs',
  'web',
  'preferences',
  'appearance',
  'security',
  'mirror'
] as const
export type BackupCategory = (typeof BACKUP_CATEGORIES)[number]
export type BackupMode = 'full' | 'diff'
export type RestoreChoice = 'backup' | 'local'
export type RestoreStatus = 'same' | 'new' | 'safe' | 'conflict' | 'invalid'

export type BackupItemIssue =
  | 'config-name'
  | 'config-toml'
  | 'web-json'
  | 'preferences-json'
  | 'appearance-json'
  | 'security-format'
  | 'mirror-json'
  | 'unknown-category'

export type BackupParseError =
  | 'invalid-json'
  | 'not-backup'
  | 'unsupported-version'
  | 'invalid-structure'
  | 'too-large'

// 体积护栏：备份是用户可编辑的 JSON 文件，恢复前限制总量与单项大小
const MAX_BACKUP_ITEMS = 2000
const MAX_ITEM_VALUE_LENGTH = 2 * 1024 * 1024
const MAX_BACKUP_TEXT_LENGTH = 20 * 1024 * 1024
const MAX_NAME_LENGTH = 200
const MAX_STRING_SETTING_LENGTH = 2048
const MAX_MIRROR_ENTRIES = 100
const MAX_SERVICE_CONFIGS = 500
const MAX_WEB_CONFIGS = 500

const THEME_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const URL_PATTERN = /^https?:\/\/\S+$/i
// Web 配置字段白名单：主机/用户名用于拼装 --config-server URL 与服务启动参数
const WEB_HOST_PATTERN = /^[\p{L}\p{N}._:%\-[\]]{1,255}$/u
const WEB_USER_PATTERN = /^[a-zA-Z0-9@._-]{1,36}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const HEX_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i
const LOCK_HASH_PATTERN = /^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/
const SUPPORTED_LANGS = ['zh-CN', 'en'] as const
const SUPPORTED_COLOR_SCHEMES = ['dark', 'light', 'auto'] as const
const SUPPORTED_APP_SIZES = ['default', 'large', 'small'] as const

const PREFERENCE_LOCAL_KEYS = [
  'settings.autoRunNetwork',
  'settings.autoRunConfigName',
  'settings.minimizeOnStart',
  'settings.onboardingDone'
] as const
const PREFERENCE_BOOLEAN_LOCAL_KEYS = new Set([
  'settings.autoRunNetwork',
  'settings.minimizeOnStart',
  'settings.onboardingDone'
])
const SERVICE_CONFIG_PREFIX = 'service-config:'

const CATEGORY_ORDER = new Map(BACKUP_CATEGORIES.map((category, index) => [category, index]))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBackupCategory = (value: unknown): value is BackupCategory =>
  typeof value === 'string' && (BACKUP_CATEGORIES as readonly string[]).includes(value)

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value))

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

const isUrlSetting = (value: unknown): value is string =>
  isBoundedString(value, MAX_STRING_SETTING_LENGTH) && URL_PATTERN.test(value)

/** 自动运行配置引用：空串表示“上次运行的配置”，否则必须是可写回 config 目录的配置名 */
const isRestorableConfigRef = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value === '' ||
    (value === value.trim() && isBoundedString(value, MAX_NAME_LENGTH) && isValidConfigName(value)))

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const isStringArray = (value: unknown, maxEntries: number, maxLength = 100): value is string[] =>
  Array.isArray(value) &&
  value.length <= maxEntries &&
  value.every((item) => isBoundedString(item, maxLength))

/** 单个备份条目（value 为统一序列化后的内容，hash 由 value 计算） */
export interface BackupItem {
  id: string
  category: BackupCategory
  /** 配置分类为文件名（含 .toml）；固定分类为空 */
  name: string
  value: string
  hash: string
  /** 差量备份中相对于基准的内容哈希；缺失表示该条目在基准中不存在 */
  baseHash?: string
}

export interface BackupBaseRef {
  id: string
  createdAt: string
  appVersion: string
}

export interface BackupManifest {
  app: typeof BACKUP_APP
  formatVersion: typeof BACKUP_FORMAT_VERSION
  id: string
  createdAt: string
  appVersion: string
  mode: BackupMode
  categories: BackupCategory[]
  base?: BackupBaseRef
  items: BackupItem[]
}

export interface BuildBackupOptions {
  mode: BackupMode
  categories: BackupCategory[]
  items: BackupItem[]
  appVersion: string
  /** 差量备份必填，必须为完整备份 */
  base?: BackupManifest
  now?: Date
}

const createBackupId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 非安全上下文等环境回退到时间随机串 */
  }
  return `lt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const normalizeCategories = (categories: BackupCategory[]): BackupCategory[] =>
  Array.from(new Set(categories))
    .filter(isBackupCategory)
    .sort((a, b) => (CATEGORY_ORDER.get(a) ?? 0) - (CATEGORY_ORDER.get(b) ?? 0))

const compareItems = (a: BackupItem, b: BackupItem): number => {
  const order = (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0)
  if (order !== 0) return order
  return a.name.localeCompare(b.name)
}

/** 创建固定分类条目（configs 之外的分类只有一个条目，id 即分类名） */
export const createBackupItem = (
  category: BackupCategory,
  name: string,
  value: string
): BackupItem => ({
  id: category === 'configs' ? `config:${name}` : category,
  category,
  name: category === 'configs' ? name : '',
  value,
  hash: sha256Hex(value)
})

/** 构建备份清单：完整模式收录全部；差量模式剔除与基准一致的内容并标注 baseHash */
export const buildBackupManifest = (options: BuildBackupOptions): BackupManifest => {
  const categories = normalizeCategories(options.categories)
  if (options.mode === 'diff') {
    if (!options.base) throw new Error('diff backup requires a base manifest')
    if (
      options.base.mode !== 'full' ||
      options.base.app !== BACKUP_APP ||
      options.base.formatVersion !== BACKUP_FORMAT_VERSION
    ) {
      throw new Error('diff backup base must be a full backup')
    }
  }

  let items = options.items
    .filter((item) => categories.includes(item.category))
    .map((item) => ({ ...item, hash: sha256Hex(item.value) }))
    .sort(compareItems)

  if (options.mode === 'diff' && options.base) {
    // 基准中已存在的条目：内容一致则省略，不一致则记录基准哈希用于冲突检测
    const baseItems = new Map(options.base.items.map((item) => [item.id, item]))
    items = items.flatMap((item) => {
      const baseItem = baseItems.get(item.id)
      if (baseItem && baseItem.hash === item.hash) return []
      return [baseItem ? { ...item, baseHash: baseItem.hash } : item]
    })
  }

  const createdAt = (options.now ?? new Date()).toISOString()
  const manifest: BackupManifest = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    id: createBackupId(),
    createdAt,
    appVersion: options.appVersion || '',
    mode: options.mode,
    categories,
    items
  }
  if (options.base) {
    manifest.base = {
      id: options.base.id,
      createdAt: options.base.createdAt,
      appVersion: options.base.appVersion
    }
  }
  return manifest
}

export type ParseBackupResult =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; reason: BackupParseError }

const parseBaseRef = (raw: unknown): BackupBaseRef | null => {
  if (!isRecord(raw)) return null
  if (!isBoundedString(raw.id, 128) || !raw.id) return null
  if (!isDateString(raw.createdAt)) return null
  if (typeof raw.appVersion !== 'string' || raw.appVersion.length > 128) return null
  return { id: raw.id, createdAt: raw.createdAt, appVersion: raw.appVersion }
}

/** 解析并规范化备份文件；结构不合法时整体拒绝，单项内容问题留待恢复计划逐项标记 */
export const parseBackupManifest = (text: string): ParseBackupResult => {
  if (!text || !text.trim()) return { ok: false, reason: 'invalid-json' }
  if (text.length > MAX_BACKUP_TEXT_LENGTH) return { ok: false, reason: 'too-large' }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isRecord(raw)) return { ok: false, reason: 'invalid-structure' }
  if (raw.app !== BACKUP_APP) return { ok: false, reason: 'not-backup' }
  if (typeof raw.formatVersion !== 'number' || !Number.isInteger(raw.formatVersion)) {
    return { ok: false, reason: 'invalid-structure' }
  }
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (!isBoundedString(raw.id, 128) || !raw.id || !isDateString(raw.createdAt)) {
    return { ok: false, reason: 'invalid-structure' }
  }
  if (typeof raw.appVersion !== 'string' || raw.appVersion.length > 128) {
    return { ok: false, reason: 'invalid-structure' }
  }
  if (raw.mode !== 'full' && raw.mode !== 'diff') {
    return { ok: false, reason: 'invalid-structure' }
  }
  const mode: BackupMode = raw.mode
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    return { ok: false, reason: 'invalid-structure' }
  }
  if (!raw.categories.every(isBackupCategory)) {
    return { ok: false, reason: 'invalid-structure' }
  }
  const categories = normalizeCategories(raw.categories)
  if (categories.length !== new Set(raw.categories).size) {
    return { ok: false, reason: 'invalid-structure' }
  }

  let base: BackupBaseRef | undefined
  if (mode === 'diff') {
    const parsedBase = parseBaseRef(raw.base)
    if (!parsedBase) return { ok: false, reason: 'invalid-structure' }
    base = parsedBase
  } else if (raw.base !== undefined) {
    // 完整备份不应携带基准信息，存在则忽略（不参与恢复）
    base = undefined
  }

  if (!Array.isArray(raw.items) || raw.items.length > MAX_BACKUP_ITEMS) {
    return { ok: false, reason: 'invalid-structure' }
  }

  const items: BackupItem[] = []
  const seenIds = new Set<string>()
  const categorySet = new Set(categories)
  for (const rawItem of raw.items) {
    if (!isRecord(rawItem)) return { ok: false, reason: 'invalid-structure' }
    if (!isBackupCategory(rawItem.category) || !categorySet.has(rawItem.category)) {
      return { ok: false, reason: 'invalid-structure' }
    }
    const category = rawItem.category
    if (!isBoundedString(rawItem.name, MAX_NAME_LENGTH)) {
      return { ok: false, reason: 'invalid-structure' }
    }
    if (typeof rawItem.value !== 'string' || rawItem.value.length > MAX_ITEM_VALUE_LENGTH) {
      return { ok: false, reason: 'invalid-structure' }
    }
    const name = category === 'configs' ? rawItem.name : ''
    const id = category === 'configs' ? `config:${name}` : category
    if (rawItem.id !== id || seenIds.has(id)) {
      return { ok: false, reason: 'invalid-structure' }
    }
    seenIds.add(id)
    const item: BackupItem = {
      id,
      category,
      name,
      value: rawItem.value,
      // 不信任文件内 hash：始终按实际内容重算，避免篡改/损坏导致冲突判断失真
      hash: sha256Hex(rawItem.value)
    }
    if (mode === 'diff' && typeof rawItem.baseHash === 'string') {
      // 非法 baseHash 视为“基准中不存在”，恢复时只会更保守地判为冲突
      if (HASH_PATTERN.test(rawItem.baseHash)) item.baseHash = rawItem.baseHash
    }
    items.push(item)
  }
  items.sort(compareItems)

  return {
    ok: true,
    manifest: {
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      id: raw.id,
      createdAt: raw.createdAt,
      appVersion: raw.appVersion,
      mode,
      categories,
      ...(base ? { base } : {}),
      items
    }
  }
}

/** 配置文件名是否可安全写回 config 目录（含扩展名，拒绝路径片段与非法名称） */
export const isValidBackupConfigName = (name: string): boolean => {
  if (!name.endsWith('.toml') || name.length > MAX_NAME_LENGTH) return false
  if (name !== name.trim()) return false
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  return isValidConfigName(name.slice(0, -'.toml'.length))
}

export interface PreferencesPayload {
  version: 1
  store: {
    p2pNotifySetting?: boolean
    errRunNotify?: boolean
    refreshInterval?: number
    selectedColumns?: string[]
    defaultServiceInstallMethod?: 'nssm' | 'official'
    defaultEnableAutostart?: boolean
    autoRunNetworkSetting?: boolean
    autoRunConfigName?: string
    xshellPath?: string
  }
  local: Record<string, string>
  serviceConfigs: Record<string, string>
}

/** 清洗应用偏好载荷：仅保留白名单字段与正确类型，任何已知字段类型错误均整体拒绝 */
export const sanitizePreferencesPayload = (value: string): PreferencesPayload | null => {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw.version !== undefined && raw.version !== 1) return null
  const rawStore = raw.store
  const rawLocal = raw.local
  const rawServiceConfigs = raw.serviceConfigs
  if (!isRecord(rawStore) && !isRecord(rawLocal) && !isRecord(rawServiceConfigs)) return null

  const store: PreferencesPayload['store'] = {}
  if (rawStore !== undefined) {
    if (!isRecord(rawStore)) return null
    const booleans = [
      'p2pNotifySetting',
      'errRunNotify',
      'defaultEnableAutostart',
      'autoRunNetworkSetting'
    ] as const
    for (const key of booleans) {
      if (rawStore[key] === undefined) continue
      if (!isBoolean(rawStore[key])) return null
      store[key] = rawStore[key]
    }
    if (rawStore.refreshInterval !== undefined) {
      const interval = rawStore.refreshInterval
      if (
        typeof interval !== 'number' ||
        !Number.isInteger(interval) ||
        interval < 1 ||
        interval > 60
      ) {
        return null
      }
      store.refreshInterval = interval
    }
    if (rawStore.selectedColumns !== undefined) {
      if (!isStringArray(rawStore.selectedColumns, 50, 100)) return null
      store.selectedColumns = [...rawStore.selectedColumns]
    }
    if (rawStore.defaultServiceInstallMethod !== undefined) {
      const method = rawStore.defaultServiceInstallMethod
      if (method !== 'nssm' && method !== 'official') return null
      store.defaultServiceInstallMethod = method
    }
    if (rawStore.autoRunConfigName !== undefined) {
      if (!isRestorableConfigRef(rawStore.autoRunConfigName)) return null
      store.autoRunConfigName = rawStore.autoRunConfigName
    }
    if (rawStore.xshellPath !== undefined) {
      if (!isBoundedString(rawStore.xshellPath, MAX_STRING_SETTING_LENGTH)) return null
      store.xshellPath = rawStore.xshellPath
    }
  }

  const local: Record<string, string> = {}
  if (rawLocal !== undefined) {
    if (!isRecord(rawLocal)) return null
    for (const key of PREFERENCE_LOCAL_KEYS) {
      if (rawLocal[key] === undefined) continue
      const item = rawLocal[key]
      if (PREFERENCE_BOOLEAN_LOCAL_KEYS.has(key)) {
        if (item !== 'true' && item !== 'false') return null
      } else if (key === 'settings.autoRunConfigName') {
        if (!isRestorableConfigRef(item)) return null
      } else if (!isBoundedString(item, MAX_NAME_LENGTH)) {
        return null
      }
      local[key] = item
    }
  }

  const serviceConfigs: Record<string, string> = {}
  if (rawServiceConfigs !== undefined) {
    if (!isRecord(rawServiceConfigs)) return null
    const entries = Object.entries(rawServiceConfigs)
    if (entries.length > MAX_SERVICE_CONFIGS) return null
    for (const [name, rawConfig] of entries) {
      if (!isValidConfigName(name)) return null
      if (!isBoundedString(rawConfig, MAX_STRING_SETTING_LENGTH)) return null
      let parsedConfig: unknown
      try {
        parsedConfig = JSON.parse(rawConfig)
      } catch {
        return null
      }
      if (!isRecord(parsedConfig)) return null
      const method = parsedConfig.installMethod
      if (method !== undefined && method !== 'nssm' && method !== 'official') return null
      serviceConfigs[`${SERVICE_CONFIG_PREFIX}${name}`] = rawConfig
    }
  }

  return { version: 1, store, local, serviceConfigs }
}

export interface AppearancePayload {
  version: 1
  theme?: string
  lang?: string
  colorScheme?: string
  app: {
    isDark?: boolean
    greyMode?: boolean
    currentSize?: (typeof SUPPORTED_APP_SIZES)[number]
    elColorPrimary?: string
  }
}

/** 清洗外观载荷：主题 ID / 语言 / 明暗模式与 Element Plus 主色均做白名单校验 */
export const sanitizeAppearancePayload = (value: string): AppearancePayload | null => {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw.version !== undefined && raw.version !== 1) return null
  if (raw.theme === undefined && raw.lang === undefined && raw.app === undefined) {
    return null
  }

  const payload: AppearancePayload = { version: 1, app: {} }
  if (raw.theme !== undefined) {
    if (!isBoundedString(raw.theme, 64)) return null
    if (raw.theme && !THEME_ID_PATTERN.test(raw.theme)) return null
    payload.theme = raw.theme
  }
  if (raw.lang !== undefined) {
    if (!isBoundedString(raw.lang, 20)) return null
    if (raw.lang && !(SUPPORTED_LANGS as readonly string[]).includes(raw.lang)) return null
    payload.lang = raw.lang
  }
  if (raw.colorScheme !== undefined) {
    if (!isBoundedString(raw.colorScheme, 20)) return null
    if (
      raw.colorScheme &&
      !(SUPPORTED_COLOR_SCHEMES as readonly string[]).includes(raw.colorScheme)
    ) {
      return null
    }
    payload.colorScheme = raw.colorScheme
  }
  if (raw.app !== undefined) {
    if (!isRecord(raw.app)) return null
    const app = raw.app
    if (app.isDark !== undefined) {
      if (!isBoolean(app.isDark)) return null
      payload.app.isDark = app.isDark
    }
    if (app.greyMode !== undefined) {
      if (!isBoolean(app.greyMode)) return null
      payload.app.greyMode = app.greyMode
    }
    if (app.currentSize !== undefined) {
      if (!(SUPPORTED_APP_SIZES as readonly string[]).includes(app.currentSize as string)) {
        return null
      }
      payload.app.currentSize = app.currentSize as AppearancePayload['app']['currentSize']
    }
    if (app.elColorPrimary !== undefined) {
      if (!isBoundedString(app.elColorPrimary, 32) || !HEX_COLOR_PATTERN.test(app.elColorPrimary)) {
        return null
      }
      payload.app.elColorPrimary = app.elColorPrimary
    }
  }
  return payload
}

export interface MirrorPayload {
  version: 1
  source?: string
  custom?: string[]
  hidden?: string[]
}

const normalizeMirrorList = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_MIRROR_ENTRIES) return null
  const result: string[] = []
  for (const item of raw) {
    if (!isUrlSetting(item)) return null
    const normalized = item.replace(/\/+$/, '') + '/'
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result
}

/** 清洗加速源载荷：选择项与自定义/隐藏列表均为 http(s) 地址 */
export const sanitizeMirrorPayload = (value: string): MirrorPayload | null => {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw.version !== undefined && raw.version !== 1) return null
  if (raw.source === undefined && raw.custom === undefined && raw.hidden === undefined) return null

  const payload: MirrorPayload = { version: 1 }
  if (raw.source !== undefined) {
    if (!isUrlSetting(raw.source)) return null
    payload.source = raw.source.replace(/\/+$/, '') + '/'
  }
  if (raw.custom !== undefined) {
    const custom = normalizeMirrorList(raw.custom)
    if (!custom) return null
    payload.custom = custom
  }
  if (raw.hidden !== undefined) {
    const hidden = normalizeMirrorList(raw.hidden)
    if (!hidden) return null
    payload.hidden = hidden
  }
  return payload
}

/** 锁屏密码校验串：空、现行加盐格式或旧版明文（应用时迁移）；拒绝控制字符与超长值 */
export const isRestorableLockValue = (value: string): boolean => {
  if (!value) return true
  if (value.length > 256 || /[\r\n\0]/.test(value)) return false
  if (value.startsWith('sha256$')) return LOCK_HASH_PATTERN.test(value)
  return true
}

export interface ParsedWebConfig {
  configFileName: string
  [key: string]: unknown
}

/**
 * 解析并清洗 Web 配置列表：仅保留可安全写回的字段。
 * - configFileName 必须可作为配置名与进程/服务标识（拒绝路径片段与重名）
 * - protocol/host/port/userName 会拼装为 --config-server URL，按表单规则白名单校验
 * - webUrl 仅保留 http(s)，避免“打开控制台”被诱导打开本地路径；非法值静默清空
 * - status/pid 属于运行时状态，恢复时统一重置，避免伪造运行中状态
 */
export const parseWebConfigValue = (value: string): ParsedWebConfig[] | null => {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length > MAX_WEB_CONFIGS) return null
  const seen = new Set<string>()
  const result: ParsedWebConfig[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const name = entry.configFileName
    if (
      !isBoundedString(name, MAX_NAME_LENGTH) ||
      name !== name.trim() ||
      !isValidConfigName(name) ||
      seen.has(name)
    ) {
      return null
    }
    if (entry.protocol !== 'udp' && entry.protocol !== 'tcp') return null
    const host = entry.host
    if (!isBoundedString(host, 255) || !WEB_HOST_PATTERN.test(host)) return null
    const port = entry.port
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null
    }
    const userName = entry.userName
    if (!isBoundedString(userName, 36) || !WEB_USER_PATTERN.test(userName)) return null
    if (entry.webStartMethod !== undefined) {
      const method = entry.webStartMethod
      if (typeof method !== 'number' || !Number.isInteger(method) || method < 0 || method > 9) {
        return null
      }
    }
    const webUrl =
      typeof entry.webUrl === 'string' && URL_PATTERN.test(entry.webUrl) ? entry.webUrl : ''
    seen.add(name)
    result.push({
      configFileName: name,
      protocol: entry.protocol,
      host,
      port,
      userName,
      webStartMethod: entry.webStartMethod === undefined ? 2 : (entry.webStartMethod as number),
      webUrl,
      status: 'notRunning'
    })
  }
  return result
}

/**
 * 校验单个备份条目的内容，返回具体问题；null 表示可安全应用。
 * 配置名非法或 TOML 语法错误、Web 列表 JSON 损坏等都在恢复前拦截。
 */
export const validateBackupItem = (item: BackupItem): BackupItemIssue | null => {
  switch (item.category) {
    case 'configs':
      if (!isValidBackupConfigName(item.name)) return 'config-name'
      return validateToml(item.value).ok ? null : 'config-toml'
    case 'web':
      return parseWebConfigValue(item.value) ? null : 'web-json'
    case 'preferences':
      return sanitizePreferencesPayload(item.value) ? null : 'preferences-json'
    case 'appearance':
      return sanitizeAppearancePayload(item.value) ? null : 'appearance-json'
    case 'security':
      return isRestorableLockValue(item.value) ? null : 'security-format'
    case 'mirror':
      return sanitizeMirrorPayload(item.value) ? null : 'mirror-json'
    default:
      return 'unknown-category'
  }
}

export interface RestorePlanEntry {
  item: BackupItem
  status: RestoreStatus
  issue?: BackupItemIssue
  localValue: string | null
  localHash: string | null
}

export interface RestorePlanCounts {
  same: number
  new: number
  safe: number
  conflict: number
  invalid: number
}

export interface RestorePlan {
  manifest: BackupManifest
  entries: RestorePlanEntry[]
  counts: RestorePlanCounts
}

/**
 * 基于本地当前值构建恢复计划。
 *
 * 状态：
 * - same：本地与备份一致（默认保留本地）
 * - new：本地不存在（默认使用备份）
 * - safe：差量项且本地仍等于基准（默认使用备份）
 * - conflict：本地与备份不同，含差量项在本地被删除的情况（默认保留本地）
 * - invalid：内容不合法，强制跳过
 */
export const buildRestorePlan = (
  manifest: BackupManifest,
  localValues: Record<string, string | null | undefined>
): RestorePlan => {
  const counts: RestorePlanCounts = { same: 0, new: 0, safe: 0, conflict: 0, invalid: 0 }
  const entries = manifest.items
    .map<RestorePlanEntry>((item) => {
      const localValue = Object.prototype.hasOwnProperty.call(localValues, item.id)
        ? (localValues[item.id] ?? null)
        : null
      const localHash = localValue === null ? null : sha256Hex(localValue)
      const issue = validateBackupItem(item)
      if (issue) {
        return { item, status: 'invalid', issue, localValue, localHash }
      }
      let status: RestoreStatus
      if (localValue === null) {
        status = item.baseHash ? 'conflict' : 'new'
      } else if (localHash === item.hash) {
        status = 'same'
      } else if (item.baseHash && localHash === item.baseHash) {
        status = 'safe'
      } else {
        status = 'conflict'
      }
      return { item, status, localValue, localHash }
    })
    .sort((a, b) => compareItems(a.item, b.item))
  entries.forEach((entry) => {
    counts[entry.status] += 1
  })
  return { manifest, entries, counts }
}

/** 默认选择：新增与可安全合并项使用备份，其余保留本地 */
export const getDefaultRestoreChoice = (entry: RestorePlanEntry): RestoreChoice =>
  entry.status === 'new' || entry.status === 'safe' ? 'backup' : 'local'

export const createDefaultChoices = (
  entries: RestorePlanEntry[]
): Record<string, RestoreChoice> => {
  const choices: Record<string, RestoreChoice> = {}
  for (const entry of entries) choices[entry.item.id] = getDefaultRestoreChoice(entry)
  return choices
}

/** 统计当前选择：无效项强制跳过，不参与应用 */
export const countRestoreSelection = (
  entries: RestorePlanEntry[],
  choices: Record<string, RestoreChoice>
): { backup: number; local: number; invalid: number } => {
  let backup = 0
  let local = 0
  let invalid = 0
  for (const entry of entries) {
    if (entry.status === 'invalid') {
      invalid += 1
    } else if (choices[entry.item.id] === 'backup') {
      backup += 1
    } else {
      local += 1
    }
  }
  return { backup, local, invalid }
}

/** 生成导出文件名（本地时间戳，完整/差量前缀便于区分） */
export const buildBackupFileName = (mode: BackupMode, now: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `LightTier-${mode}-${stamp}.json`
}
