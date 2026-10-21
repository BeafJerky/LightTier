/**
 * backupUtil 单测：清单解析、差量构建、逐项校验与冲突状态。
 */
import { describe, expect, it } from 'vitest'
import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  buildBackupFileName,
  buildBackupManifest,
  buildRestorePlan,
  countRestoreSelection,
  createBackupItem,
  createDefaultChoices,
  isValidBackupConfigName,
  parseBackupManifest,
  parseWebConfigValue,
  sanitizeAppearancePayload,
  sanitizeMirrorPayload,
  sanitizePreferencesPayload,
  validateBackupItem,
  type BackupCategory,
  type BackupItem,
  type BackupManifest,
  type BackupMode
} from '@/utils/backupUtil'
import { sha256Hex } from '@/utils/lockUtil'

const TOML_A = '[network]\ninstance_name = "a"\n'
const TOML_B = '[network]\ninstance_name = "b"\n'
const TOML_C = '[network]\ninstance_name = "c"\n'
const LOCK_HASH = `sha256$${'a'.repeat(32)}$${'b'.repeat(64)}`

const makeManifest = (
  items: BackupItem[],
  options: {
    mode?: BackupMode
    categories?: BackupCategory[]
    baseHash?: string
  } = {}
): BackupManifest => {
  const mode = options.mode ?? 'full'
  const categories = options.categories ?? ['configs']
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    id: 'backup-1',
    createdAt: '2026-10-21T10:00:00.000Z',
    appVersion: '1.5.0',
    mode,
    categories,
    ...(mode === 'diff'
      ? {
          base: {
            id: 'base-1',
            createdAt: '2026-10-20T10:00:00.000Z',
            appVersion: '1.5.0'
          }
        }
      : {}),
    items
  }
}

const configItem = (name: string, value: string, baseHash?: string): BackupItem => ({
  ...createBackupItem('configs', name, value),
  ...(baseHash ? { baseHash } : {})
})

describe('buildBackupManifest（完整/差量）', () => {
  const baseItems = [
    configItem('keep.toml', TOML_A),
    configItem('change.toml', TOML_B),
    configItem('deleted.toml', TOML_C)
  ]
  const base = makeManifest(baseItems)
  const current = [
    configItem('keep.toml', TOML_A),
    configItem('change.toml', TOML_C),
    configItem('new.toml', TOML_B),
    createBackupItem('security', '', 'sha256$abc')
  ]

  it('完整备份收录所选分类的全部内容', () => {
    const manifest = buildBackupManifest({
      mode: 'full',
      categories: ['configs'],
      items: current,
      appVersion: '1.5.0',
      now: new Date('2026-10-21T10:00:00.000Z')
    })
    expect(manifest.mode).toBe('full')
    expect(manifest.base).toBeUndefined()
    expect(manifest.items).toHaveLength(3)
    expect(manifest.items.every((item) => item.category === 'configs')).toBe(true)
    expect(manifest.createdAt).toBe('2026-10-21T10:00:00.000Z')
  })

  it('差量备份省略未变更项，修改项携带基准哈希，新增项不带基准哈希', () => {
    const manifest = buildBackupManifest({
      mode: 'diff',
      categories: ['configs'],
      items: current,
      appVersion: '1.5.0',
      base
    })
    const byName = new Map(manifest.items.map((item) => [item.name, item]))
    expect(byName.has('keep.toml')).toBe(false)
    // 基准中已删除的项不会被差量备份重新收录
    expect(byName.has('deleted.toml')).toBe(false)
    expect(byName.get('change.toml')?.baseHash).toBe(sha256Hex(TOML_B))
    expect(byName.get('new.toml')).toBeTruthy()
    expect(byName.get('new.toml')?.baseHash).toBeUndefined()
    expect(manifest.base?.id).toBe('backup-1')
  })

  it('差量模式必须有完整备份基准，且不能以差量备份为基准', () => {
    expect(() =>
      buildBackupManifest({
        mode: 'diff',
        categories: ['configs'],
        items: current,
        appVersion: '1.5.0'
      })
    ).toThrow()
    expect(() =>
      buildBackupManifest({
        mode: 'diff',
        categories: ['configs'],
        items: current,
        appVersion: '1.5.0',
        base: makeManifest([], { mode: 'diff' })
      })
    ).toThrow()
  })
})

describe('parseBackupManifest（导入校验）', () => {
  const valid = buildBackupManifest({
    mode: 'full',
    categories: ['configs', 'security'],
    items: [configItem('家庭.toml', TOML_A), createBackupItem('security', 'h', 'sha256$abc')],
    appVersion: '1.5.0'
  })

  it('接受并规范化有效备份（忽略不可信 hash，按内容重算）', () => {
    const raw = JSON.parse(JSON.stringify(valid))
    raw.items[0].hash = 'f'.repeat(64)
    const result = parseBackupManifest(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.items.find((item) => item.name === '家庭.toml')?.hash).toBe(
      sha256Hex(TOML_A)
    )
    expect(result.manifest.categories).toEqual(['configs', 'security'])
  })

  it('拒绝空文件、非法 JSON、非本应用文件', () => {
    expect(parseBackupManifest('')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(parseBackupManifest('{oops')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(parseBackupManifest(JSON.stringify({ app: 'other' }))).toEqual({
      ok: false,
      reason: 'not-backup'
    })
  })

  it('拒绝不支持的格式版本与结构异常', () => {
    expect(
      parseBackupManifest(JSON.stringify({ ...valid, formatVersion: BACKUP_FORMAT_VERSION + 1 }))
    ).toEqual({ ok: false, reason: 'unsupported-version' })
    expect(
      parseBackupManifest(JSON.stringify({ ...valid, categories: ['configs', 'configs'] }))
    ).toEqual({ ok: false, reason: 'invalid-structure' })
    expect(
      parseBackupManifest(
        JSON.stringify({
          ...valid,
          items: [valid.items[0], valid.items[0]]
        })
      )
    ).toEqual({ ok: false, reason: 'invalid-structure' })
    expect(
      parseBackupManifest(
        JSON.stringify({
          ...valid,
          items: [{ ...valid.items[0], id: 'config:另一个.toml' }]
        })
      )
    ).toEqual({ ok: false, reason: 'invalid-structure' })
  })

  it('差量备份缺少基准信息时拒绝', () => {
    const diff = buildBackupManifest({
      mode: 'diff',
      categories: ['configs'],
      items: [configItem('a.toml', TOML_A)],
      appVersion: '1.5.0',
      base: makeManifest([])
    })
    const { base: _base, ...withoutBase } = diff
    expect(parseBackupManifest(JSON.stringify(withoutBase))).toEqual({
      ok: false,
      reason: 'invalid-structure'
    })
  })

  it('单项内容问题不阻断解析，由恢复计划标记为无效', () => {
    const manifest = makeManifest([
      configItem('../evil.toml', TOML_A),
      configItem('bad.toml', 'not = [valid')
    ])
    const result = parseBackupManifest(JSON.stringify(manifest))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plan = buildRestorePlan(result.manifest, {})
    expect(plan.entries.map((entry) => entry.status)).toEqual(['invalid', 'invalid'])
    expect(plan.entries.map((entry) => entry.issue)).toEqual(['config-name', 'config-toml'])
  })
})

describe('buildRestorePlan（冲突检测）', () => {
  const baseChanged = sha256Hex(TOML_A)
  const WEB_A = JSON.stringify([
    { protocol: 'udp', host: '10.0.0.1', port: 22020, userName: 'u', configFileName: '中继' }
  ])
  const WEB_B = JSON.stringify([
    { protocol: 'udp', host: '10.0.0.2', port: 22020, userName: 'u', configFileName: '中继' }
  ])
  const WEB_C = JSON.stringify([
    { protocol: 'tcp', host: '10.0.0.3', port: 22020, userName: 'u', configFileName: '中继' }
  ])
  const items = [
    configItem('same.toml', TOML_A),
    configItem('new.toml', TOML_B),
    { ...configItem('safe.toml', TOML_C), baseHash: baseChanged },
    { ...configItem('conflict.toml', TOML_A), baseHash: sha256Hex(TOML_B) },
    {
      ...createBackupItem('web', '', WEB_A),
      baseHash: sha256Hex(WEB_B)
    },
    createBackupItem('security', '', LOCK_HASH)
  ]
  const manifest = makeManifest(items, {
    mode: 'diff',
    categories: ['configs', 'web', 'security']
  })

  it('区分 same/new/safe/conflict', () => {
    const plan = buildRestorePlan(manifest, {
      'config:same.toml': TOML_A,
      'config:safe.toml': TOML_A,
      'config:conflict.toml': TOML_C,
      web: WEB_C,
      security: LOCK_HASH
    })
    const byId = new Map(plan.entries.map((entry) => [entry.item.id, entry]))
    expect(byId.get('config:same.toml')?.status).toBe('same')
    expect(byId.get('config:new.toml')?.status).toBe('new')
    expect(byId.get('config:safe.toml')?.status).toBe('safe')
    expect(byId.get('config:conflict.toml')?.status).toBe('conflict')
    expect(byId.get('web')?.status).toBe('conflict')
    expect(byId.get('security')?.status).toBe('same')
    expect(plan.counts).toEqual({ same: 2, new: 1, safe: 1, conflict: 2, invalid: 0 })
  })

  it('差量项在本地被删除时判为冲突，新增项本地缺失判为新增', () => {
    const plan = buildRestorePlan(manifest, {})
    const byId = new Map(plan.entries.map((entry) => [entry.item.id, entry]))
    expect(byId.get('config:new.toml')?.status).toBe('new')
    expect(byId.get('config:safe.toml')?.status).toBe('conflict')
    expect(byId.get('web')?.status).toBe('conflict')
  })

  it('默认选择与统计：新增/可安全合并用备份，冲突保留本地，无效项跳过', () => {
    const plan = buildRestorePlan(
      makeManifest(
        [
          configItem('same.toml', TOML_A),
          configItem('new.toml', TOML_B),
          { ...configItem('safe.toml', TOML_C), baseHash: sha256Hex(TOML_A) },
          { ...configItem('conflict.toml', TOML_A), baseHash: sha256Hex(TOML_B) },
          configItem('../invalid.toml', TOML_A)
        ],
        { mode: 'diff' }
      ),
      {
        'config:same.toml': TOML_A,
        'config:safe.toml': TOML_A,
        'config:conflict.toml': TOML_C
      }
    )
    const choices = createDefaultChoices(plan.entries)
    expect(choices['config:new.toml']).toBe('backup')
    expect(choices['config:safe.toml']).toBe('backup')
    expect(choices['config:conflict.toml']).toBe('local')
    expect(choices['config:same.toml']).toBe('local')
    expect(countRestoreSelection(plan.entries, choices)).toEqual({
      backup: 2,
      local: 2,
      invalid: 1
    })
  })
})

describe('分类载荷校验', () => {
  it('配置文件名拒绝路径片段、非法字符与保留名', () => {
    expect(isValidBackupConfigName('家庭.toml')).toBe(true)
    expect(isValidBackupConfigName('a b-c_1.toml')).toBe(true)
    expect(isValidBackupConfigName('../evil.toml')).toBe(false)
    expect(isValidBackupConfigName('dir/evil.toml')).toBe(false)
    expect(isValidBackupConfigName('CON.toml')).toBe(false)
    expect(isValidBackupConfigName('no-extension')).toBe(false)
  })

  it('Web 配置要求唯一非空 configFileName', () => {
    const webEntry = (overrides: Record<string, unknown> = {}) => ({
      protocol: 'udp',
      host: 'example.com',
      port: 22020,
      userName: 'user',
      webStartMethod: 2,
      configFileName: '中继',
      webUrl: 'http://example.com:22020',
      status: 'running',
      pid: 999,
      ...overrides
    })
    const value = (entries: unknown[]) => JSON.stringify(entries)

    expect(validateBackupItem(createBackupItem('web', '', value([webEntry()])))).toBeNull()
    expect(
      validateBackupItem(createBackupItem('web', '', value([webEntry({ configFileName: '' })])))
    ).toBe('web-json')
    expect(
      validateBackupItem(
        createBackupItem('web', '', value([webEntry(), webEntry({ host: 'other.com' })]))
      )
    ).toBe('web-json')
    expect(
      validateBackupItem(createBackupItem('web', '', value([webEntry({ configFileName: '../x' })])))
    ).toBe('web-json')
  })

  it('Web 配置按白名单清洗字段并重置运行时状态', () => {
    const parsed = parseWebConfigValue(
      JSON.stringify([
        {
          protocol: 'tcp',
          host: '::1',
          port: 1,
          userName: 'a@b.c_d',
          webStartMethod: 1,
          configFileName: '家庭 中继',
          webUrl: 'https://console.example.com',
          status: 'running',
          pid: 1234,
          extra: 'dropped'
        }
      ])
    )
    expect(parsed).toEqual([
      {
        protocol: 'tcp',
        host: '::1',
        port: 1,
        userName: 'a@b.c_d',
        webStartMethod: 1,
        configFileName: '家庭 中继',
        webUrl: 'https://console.example.com',
        status: 'notRunning'
      }
    ])
    // 非 http(s) 控制台地址（本地路径等）静默清空，不阻断其余字段恢复
    expect(
      parseWebConfigValue(
        JSON.stringify([
          {
            protocol: 'udp',
            host: '127.0.0.1',
            port: 22020,
            userName: 'u',
            configFileName: 'a',
            webUrl: 'file:///C:/Windows/System32/calc.exe'
          }
        ])
      )?.[0].webUrl
    ).toBe('')

    const base = {
      protocol: 'udp',
      host: '127.0.0.1',
      port: 22020,
      userName: 'u',
      configFileName: 'a'
    }
    expect(parseWebConfigValue(JSON.stringify([{ ...base, protocol: 'icmp' }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, host: 'bad host' }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, host: '../evil' }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, port: 0 }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, port: '22020' }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, userName: 'bad user' }]))).toBeNull()
    expect(parseWebConfigValue(JSON.stringify([{ ...base, webStartMethod: 99 }]))).toBeNull()
  })

  it('偏好载荷仅接受白名单字段与正确类型', () => {
    const value = JSON.stringify({
      version: 1,
      store: { refreshInterval: 5, defaultServiceInstallMethod: 'official' },
      local: { 'settings.autoRunNetwork': 'true' },
      serviceConfigs: { 家庭: '{"installMethod":"nssm"}' }
    })
    const payload = sanitizePreferencesPayload(value)
    expect(payload?.store.refreshInterval).toBe(5)
    expect(payload?.local['settings.autoRunNetwork']).toBe('true')
    expect(payload?.serviceConfigs['service-config:家庭']).toBe('{"installMethod":"nssm"}')

    expect(
      sanitizePreferencesPayload(JSON.stringify({ store: { refreshInterval: 999 } }))
    ).toBeNull()
    expect(
      sanitizePreferencesPayload(JSON.stringify({ local: { 'settings.autoRunNetwork': 'yes' } }))
    ).toBeNull()
    expect(
      sanitizePreferencesPayload(
        JSON.stringify({ serviceConfigs: { '../evil': '{"installMethod":"nssm"}' } })
      )
    ).toBeNull()
    // 自动运行配置引用：允许空串（表示上次运行的配置），非空必须是合法配置名
    expect(
      sanitizePreferencesPayload(
        JSON.stringify({
          store: { autoRunConfigName: '家庭' },
          local: { 'settings.autoRunConfigName': '' }
        })
      )
    ).toMatchObject({
      store: { autoRunConfigName: '家庭' },
      local: { 'settings.autoRunConfigName': '' }
    })
    expect(
      sanitizePreferencesPayload(JSON.stringify({ store: { autoRunConfigName: '../evil' } }))
    ).toBeNull()
    expect(
      sanitizePreferencesPayload(
        JSON.stringify({ local: { 'settings.autoRunConfigName': '../evil' } })
      )
    ).toBeNull()
    expect(
      sanitizePreferencesPayload(
        JSON.stringify({ local: { 'settings.autoRunConfigName': ' 家庭 ' } })
      )
    ).toBeNull()
  })

  it('外观载荷校验主题、语言与主色', () => {
    expect(
      sanitizeAppearancePayload(
        JSON.stringify({ theme: 'dark', lang: 'en', app: { isDark: true } })
      )
    ).toEqual({ version: 1, theme: 'dark', lang: 'en', app: { isDark: true } })
    expect(sanitizeAppearancePayload(JSON.stringify({ theme: '../evil' }))).toBeNull()
    expect(sanitizeAppearancePayload(JSON.stringify({ lang: 'fr' }))).toBeNull()
    expect(sanitizeAppearancePayload(JSON.stringify({ app: { elColorPrimary: 'red' } }))).toBeNull()
  })

  it('加速源载荷要求 http(s) 地址并规范化尾部斜杠', () => {
    const payload = sanitizeMirrorPayload(
      JSON.stringify({
        source: 'https://wget.la',
        custom: ['https://ghfast.top/'],
        hidden: []
      })
    )
    expect(payload?.source).toBe('https://wget.la/')
    expect(payload?.custom).toEqual(['https://ghfast.top/'])
    expect(sanitizeMirrorPayload(JSON.stringify({ source: 'ftp://mirror' }))).toBeNull()
    expect(sanitizeMirrorPayload(JSON.stringify({ custom: ['not-a-url'] }))).toBeNull()
  })

  it('锁屏密码仅接受空值、现行哈希或旧版明文', () => {
    expect(validateBackupItem(createBackupItem('security', '', ''))).toBeNull()
    expect(
      validateBackupItem(
        createBackupItem('security', '', `sha256$${'a'.repeat(32)}$${'b'.repeat(64)}`)
      )
    ).toBeNull()
    expect(validateBackupItem(createBackupItem('security', '', 'legacy-password'))).toBeNull()
    expect(validateBackupItem(createBackupItem('security', '', 'sha256$broken'))).toBe(
      'security-format'
    )
    expect(validateBackupItem(createBackupItem('security', '', 'line\nbreak'))).toBe(
      'security-format'
    )
  })
})

describe('buildBackupFileName', () => {
  it('包含模式与本地时间戳', () => {
    expect(buildBackupFileName('diff', new Date(2026, 9, 21, 9, 5, 3))).toBe(
      'LightTier-diff-20261021-090503.json'
    )
  })
})
