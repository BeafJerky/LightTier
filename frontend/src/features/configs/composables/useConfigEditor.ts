/**
 * 配置编辑弹窗的状态与保存管线（新增 / 编辑双模式）。
 *
 * 表单模式由 parseConfigFormModel / buildConfigFormModel 双向转换；代码模式直接编辑 TOML。
 * 保存前统一经 normalizeToml 清洗（合并默认值、剔除空参数），保证落盘 TOML 简洁。
 * secret 字段以掩码展示、真实值暂存 secretBackup，未改动则原值写回。
 * 模板下拉、tab 焦点等纯 UI 状态留在 EditDialog 壳组件。
 */
import { computed, ref, useId, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as toml from 'smol-toml'
import { normalizeToml } from '@/features/configs/lib/tomlNormalize'
import { validateToml } from '@/shared/lib/tomlValidationUtil'
import { migrateLightTierConfig } from '@/entities/config/lighttierConfigUtil'
import { isValidConfigName } from '@/shared/lib/configNameUtil'
import { getErrorMessage } from '@/shared/lib/error'
import {
  buildConfigFormModel,
  parseConfigFormModel,
  type ConfigFormModel
} from '@/features/configs/lib/configFormUtil'
import {
  CONFIG_TEMPLATES,
  SECURITY_FIELD_DEFS,
  ADVANCED_FLAG_DEFS,
  ADVANCED_TOP_SWITCH_DEFS,
  ADVANCED_TOP_TEXT_DEFS,
  type AdvancedFieldDef
} from '@/entities/config/defaultData'
import { useEasyTierStore } from '@/shared/store/easytier'
import {
  checkConfigCompat,
  collectUnsupportedConfigEntries,
  compareCoreVersion,
  isCoreFeatureSupported,
  isCoreFlagSupported
} from '@/entities/kernel/kernelCompatUtil'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { useTomlDraft } from './useTomlDraft'

export type TemplateId = 'server' | 'client' | 'custom'

interface UseConfigEditorOptions {
  props: Readonly<{
    configName: string
    tomlContent: string
    dialogMode?: 'add' | 'edit'
    existingConfigNames?: string[]
  }>
  /** 父组件写盘回调：done 由父组件在写盘结束后调用 */
  emitSaved: (name: string, content: string, done: (ok: boolean) => void) => void
  /** 弹窗可见性（由壳组件持有）：脏检查与保存成功后关闭都依赖它 */
  visible: Ref<boolean>
}

interface FormData {
  hostname: string
  instance_name: string
  dhcp: boolean
  rpc_portal: string
  network_identity?: { network_name?: string; network_secret?: string }
  listeners?: string[]
  peer?: { uri: string }[]
  routes?: string[]
  exit_nodes?: string[]
  flags?: Record<string, any>
  [key: string]: any
}

export function useConfigEditor(options: UseConfigEditorOptions) {
  const { props, emitSaved, visible } = options
  const { t } = useI18n()
  const store = useEasyTierStore()
  // 非 Tauri 环境优雅降级（浏览器预览）；withGlobalTauri 已关闭，用 isTauri() 检测
  const isTauri = isTauriRuntime()

  // 表单字段 id 前缀：label for 与控件的可访问名称一一对应
  const uid = useId()
  const fieldId = (key: string) => `ed-${uid}-${key}`

  const dialogMode = computed(() => props.dialogMode || 'edit')
  const isAddMode = computed(() => dialogMode.value === 'add')

  // 配置名（仅新增可编辑）与校验错误
  const newConfigName = ref(props.configName || '')
  const nameError = ref('')
  // 编辑模式：code 代码直编 / form 结构化表单（默认表单模式）
  const editMode = ref<'code' | 'form'>('form')
  // 保存中标志：避免重复提交
  const saving = ref(false)
  // 脏检查基线：打开时的名称/代码 + 进入表单模式时的表单快照
  const initialToml = ref(props.tomlContent)
  const initialName = ref(props.dialogMode === 'add' ? '' : props.configName)
  const formBaseline = ref('')
  // 代码区内容：外部传入的 TOML 原文，编辑期间以本地副本为准
  const tomlContent = ref(props.tomlContent)
  watch(
    () => props.tomlContent,
    (v) => {
      tomlContent.value = v
    }
  )

  // ===== TOML 实时校验（300ms 防抖）=====
  const { codeIssue, saveError, runValidation, resetIssues } = useTomlDraft({
    text: () => tomlContent.value,
    isCodeMode: () => editMode.value === 'code'
  })

  const formData = ref<FormData>({
    hostname: '',
    instance_name: '',
    dhcp: true,
    rpc_portal: '',
    flags: {}
  })
  // 表单未建模的顶层键/表（vpn_portal_config、[lighttier] 等），保存时原样透传
  const formPassthrough = ref<Record<string, any>>({})
  // 当前内核不支持/已移除的配置项：只读展示，构建 TOML 时最后原样写回（表单无法修改）
  const formLockedFlags = ref<Record<string, any>>({})
  const formLockedTop = ref<Record<string, any>>({})

  // 5.6：安全模式开关（表单最底部；开启后才渲染安全字段并写入 [secure_mode] 表）
  const secureModeEnabled = ref(false)
  // 5.6：安全字段掩码回显（真实值备份在 secretBackup，保存时写回）
  const secretDisplays = ref<Record<string, string>>({})
  const secretBackup = ref<Record<string, string>>({})
  // 敏感字段显隐切换（默认使用 password 类型显示，点击“显示”后明文）
  const secretVisible = ref<Record<string, boolean>>({})
  // stun_servers 为数组，表单以逗号分隔文本展示
  const formStunServers = ref('')

  const formListeners = ref<string[]>([])
  const formPeers = ref<string[]>([])
  // 与 formPeers 索引对齐：保留 peer_public_key 等表单未建模字段
  const formPeerExtras = ref<Record<string, any>[]>([])
  const formRoutes = ref<string[]>([])
  const formExitNodes = ref<string[]>([])
  const formFlagsKeys = ref<string[]>([])
  const formFlagsVals = ref<string[]>([])

  const formDataNetworkName = ref('')
  const formDataNetworkSecret = ref('')

  // ===== 未保存修改检测 =====
  // 表单模式以内容快照比较（避免逐事件接线）；代码模式直接比较原文；名称变化同样视为修改
  const formSignature = (): string =>
    JSON.stringify({
      formData: formData.value,
      secureMode: secureModeEnabled.value,
      stun: formStunServers.value,
      listeners: formListeners.value,
      peers: formPeers.value,
      peerExtras: formPeerExtras.value,
      routes: formRoutes.value,
      exitNodes: formExitNodes.value,
      flagKeys: formFlagsKeys.value,
      flagVals: formFlagsVals.value,
      networkName: formDataNetworkName.value,
      networkSecret: formDataNetworkSecret.value,
      secretDisplays: secretDisplays.value
    })

  const formParsedOk = ref(false)
  const dirty = computed(() => {
    if (!visible.value) return false
    if (newConfigName.value !== initialName.value) return true
    if (editMode.value === 'form' && formParsedOk.value) {
      return formSignature() !== formBaseline.value
    }
    return tomlContent.value !== initialToml.value
  })

  // 放弃确认：Promise 供 CreamDialog before-close 与 Android 路由守卫共同等待
  const discardVisible = ref(false)
  // 由路由离开守卫触发：返回事件已在路由导航流程中，确认面板不能注入 history 条目
  const discardFromRoute = ref(false)
  let discardResolve: ((ok: boolean) => void) | null = null
  const resolveDiscard = (ok: boolean) => {
    const resolve = discardResolve
    discardResolve = null
    discardVisible.value = false
    if (!ok) return resolve?.(false)
    // 用户明确放弃修改：重置基线，避免关闭动画/路由跳转再次触发提示
    initialToml.value = tomlContent.value
    initialName.value = newConfigName.value
    formBaseline.value = formSignature()
    resolve?.(true)
  }
  const confirmDiscard = (fromRoute = false): Promise<boolean> => {
    if (!dirty.value) return Promise.resolve(true)
    if (discardVisible.value) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      discardFromRoute.value = fromRoute
      discardResolve = resolve
      discardVisible.value = true
    })
  }
  // 放弃确认框被 Esc/遮罩/返回键关闭时视为取消
  watch(discardVisible, (v) => {
    if (!v && discardResolve) {
      const resolve = discardResolve
      discardResolve = null
      resolve(false)
    }
  })

  // TOML 原文 → 表单模型：解析失败时保留空表单（用户切到表单模式不报错）
  // @returns 是否解析成功（供代码/表单双向切换判断能否安全回写）
  const parseFormData = (): boolean => {
    const model = parseConfigFormModel(tomlContent.value)
    if (!model) return false
    formLockedFlags.value = {}
    formLockedTop.value = {}
    try {
      // 以原文为准收集当前内核不支持的配置项：从可编辑表单剔除，改为只读展示 + 原样写回
      const raw = toml.parse(tomlContent.value) as Record<string, any>
      migrateLightTierConfig(raw)
      const locked = collectUnsupportedConfigEntries(raw, store.coreCaps)
      formLockedFlags.value = locked.flags
      formLockedTop.value = locked.topLevel
      const lockedFlagKeys = new Set(Object.keys(locked.flags))
      if (lockedFlagKeys.size) {
        if (model.formData.flags) {
          lockedFlagKeys.forEach((key) => delete model.formData.flags[key])
        }
        const keptIndexes = model.flagsKeys
          .map((_, i) => i)
          .filter((i) => !lockedFlagKeys.has(model.flagsKeys[i]))
        model.flagsKeys = keptIndexes.map((i) => model.flagsKeys[i])
        model.flagsVals = keptIndexes.map((i) => model.flagsVals[i])
      }
      const lockedTopKeys = new Set(Object.keys(locked.topLevel))
      if (lockedTopKeys.size) {
        lockedTopKeys.forEach((key) => {
          delete model.formData[key]
          delete model.passthrough[key]
        })
        // 安全模式表不可用时整段隐藏，避免编辑了写入时又被锁定值覆盖
        if (lockedTopKeys.has('secure_mode') || lockedTopKeys.has('credential_file')) {
          model.secureModeEnabled = false
          delete model.secretDisplays.local_private_key
          delete model.secretBackup.local_private_key
          delete model.formData.local_public_key
        }
      }
    } catch {
      /* parseConfigFormModel 已成功解析，忽略重复解析异常 */
    }
    formData.value = { ...model.formData } as FormData
    formPassthrough.value = { ...model.passthrough }
    secureModeEnabled.value = model.secureModeEnabled
    secretDisplays.value = model.secretDisplays
    secretBackup.value = model.secretBackup
    formStunServers.value = model.stunServers
    formListeners.value = [...model.listeners]
    formPeers.value = [...model.peers]
    formPeerExtras.value = model.peerExtras.map((e) => ({ ...e }))
    formRoutes.value = [...model.routes]
    formExitNodes.value = [...model.exitNodes]
    formFlagsKeys.value = [...model.flagsKeys]
    formFlagsVals.value = [...model.flagsVals]
    formDataNetworkName.value = model.networkName
    formDataNetworkSecret.value = model.networkSecret
    return true
  }

  // 当前表单状态 → 模型（供构建 TOML 使用）
  const collectFormModel = (): ConfigFormModel => ({
    formData: formData.value as Record<string, any>,
    passthrough: formPassthrough.value,
    secretDisplays: secretDisplays.value,
    secretBackup: secretBackup.value,
    secureModeEnabled: secureModeEnabled.value,
    stunServers: formStunServers.value,
    listeners: formListeners.value,
    peers: formPeers.value,
    peerExtras: formPeerExtras.value,
    routes: formRoutes.value,
    exitNodes: formExitNodes.value,
    flagsKeys: formFlagsKeys.value,
    flagsVals: formFlagsVals.value,
    networkName: formDataNetworkName.value,
    networkSecret: formDataNetworkSecret.value,
    lockedFlags: formLockedFlags.value,
    lockedTopLevel: formLockedTop.value
  })

  // 表单模型 → TOML 文本：空值剔除、安全字段按掩码规则写回、flags 类型推断（bool/number/string）
  // assignBackup=false 供兼容性预览等只读场景使用，避免计算属性写入状态
  const buildFormToml = (assignBackup = true): string => {
    const { toml: content, secretBackup: backup } = buildConfigFormModel(collectFormModel())
    if (assignBackup) secretBackup.value = backup
    return content
  }

  // ===== 内核版本适配 =====
  // 当前内核不支持的字段一律不渲染可编辑控件：
  // 新建时隐藏；编辑时若配置文件中存在，则归入底部只读“当前内核未兼容”栏
  const lockedTopKeys = computed(() => new Set(Object.keys(formLockedTop.value)))
  const supportsDef = (f: AdvancedFieldDef): boolean =>
    (!f.feature || isCoreFeatureSupported(f.feature, store.coreCaps)) &&
    !lockedTopKeys.value.has(f.key)

  const visibleAdvancedFlagDefs = computed(() =>
    ADVANCED_FLAG_DEFS.filter((f) => isCoreFlagSupported(f.key, store.coreCaps))
  )
  const visibleTopSwitchDefs = computed(() => ADVANCED_TOP_SWITCH_DEFS.filter(supportsDef))
  const visibleTopTextDefs = computed(() => ADVANCED_TOP_TEXT_DEFS.filter(supportsDef))
  const visibleSecurityFieldDefs = computed(() =>
    SECURITY_FIELD_DEFS.filter((f) => !lockedTopKeys.value.has(f.key))
  )
  const securitySectionVisible = computed(
    () =>
      isCoreFeatureSupported('secureMode', store.coreCaps) &&
      !lockedTopKeys.value.has('secure_mode')
  )

  // 未兼容配置项只读展示（flags 加前缀区分顶层字段）
  const formatLockedValue = (value: unknown): string => {
    if (typeof value === 'string') return value || '""'
    if (value === undefined) return 'undefined'
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  const lockedEntries = computed(() => [
    ...Object.entries(formLockedFlags.value).map(([key, value]) => ({
      key: `flags.${key}`,
      value: formatLockedValue(value)
    })),
    ...Object.entries(formLockedTop.value).map(([key, value]) => ({
      key,
      value: formatLockedValue(value)
    }))
  ])
  // rpc_portal 自 v2.5.0 起不再从配置文件读取（需改走 CLI --rpc-portal）
  const rpcPortalSupported = computed(
    () => !store.detectedCoreVersion || compareCoreVersion(store.detectedCoreVersion, 'v2.5.0') < 0
  )
  const showRpcPortal = computed(() => !isAddMode.value || rpcPortalSupported.value)
  const unsupportedTitle = (key: string) =>
    t('newEdit.fieldUnsupported', {
      version: store.detectedCoreVersion || t('newSettings.notInstalled'),
      field: key
    })

  // 兼容性提示：代码模式直接解析原文；表单模式先构建再解析（只读，不写 secretBackup）
  const compatIssues = computed(() => {
    try {
      const raw = editMode.value === 'form' ? buildFormToml(false) : tomlContent.value
      const parsed = toml.parse(raw) as Record<string, any>
      migrateLightTierConfig(parsed)
      return checkConfigCompat(parsed, store.detectedCoreVersion)
    } catch {
      return []
    }
  })
  const hasCompatError = computed(() => compatIssues.value.some((i) => i.level === 'error'))

  // 删除某行自定义 Flag（key/value 同步移除，保持两数组索引对齐）
  const removeFlag = (i: number) => {
    formFlagsKeys.value.splice(i, 1)
    formFlagsVals.value.splice(i, 1)
  }

  // 对等节点：URI 与额外字段（peer_public_key 等）同步增删，保持索引对齐
  const addPeer = () => {
    formPeers.value.push('')
    formPeerExtras.value.push({})
  }
  const removePeer = (i: number) => {
    formPeers.value.splice(i, 1)
    formPeerExtras.value.splice(i, 1)
  }

  // === 5.6 高级字段交互 ===
  // 缺省未写时按内核默认值显示（如 bind_device 默认开启）；
  // 切回默认值时删除该键，保持配置文件简洁
  const isAdvancedFlagOn = (f: AdvancedFieldDef): boolean => {
    const value = formData.value.flags?.[f.key]
    if (value === undefined || value === null) return f.defaultValue === true
    return value === true
  }

  const toggleAdvancedFlag = (f: AdvancedFieldDef) => {
    if (!formData.value.flags) formData.value.flags = {}
    const flags = formData.value.flags
    const next = !isAdvancedFlagOn(f)
    if (next === (f.defaultValue === true)) delete flags[f.key]
    else flags[f.key] = next
  }

  // 顶层布尔字段（如 ipv6_public_addr_provider）：false 时不落盘
  const toggleTopSwitch = (key: string) => {
    formData.value[key] = formData.value[key] !== true
  }

  // 敏感字段输入：掩码未被修改时保持占位，用户输入即视为新值
  const onSecurityInput = (f: AdvancedFieldDef, value: string) => {
    if (f.secret) {
      secretDisplays.value[f.key] = value
    } else {
      formData.value[f.key] = value
    }
  }

  // credential_file 📁 选择（Tauri 文件选择）
  const pickCredentialFile = async () => {
    if (!isTauri) return
    try {
      const selected = await open({
        multiple: false,
        title: t('newEdit.pickFile')
      })
      if (selected) {
        formData.value.credential_file = selected
      }
    } catch {
      /* ignore */
    }
  }

  // 敏感字段显隐切换（password ↔ text）
  const toggleSecretVisible = (key: string) => {
    secretVisible.value[key] = !secretVisible.value[key]
  }

  // 切到表单模式：以当前代码区内容重新解析，保证两种模式数据一致
  // formParsedOk 记录解析是否成功；解析失败不进入表单，避免空表单覆盖原文件
  const switchToForm = () => {
    if (editMode.value === 'form') return
    const ok = parseFormData()
    formParsedOk.value = ok
    if (!ok) {
      const result = validateToml(tomlContent.value)
      codeIssue.value = result.ok
        ? t('newEdit.formParseFailed')
        : t('newEdit.codeInvalid', {
            line: result.error.line,
            column: result.error.column
          })
      return
    }
    resetIssues()
    // 进入表单时记录基线：切回代码时仅在有实际修改时回写，避免无意义的格式变化
    formBaseline.value = formSignature()
    editMode.value = 'form'
  }

  // 切到代码模式：先把表单改动回写到代码区，避免“表单改完切代码再保存”路径丢失修改
  const switchToCode = () => {
    if (editMode.value === 'form' && formParsedOk.value && formSignature() !== formBaseline.value) {
      tomlContent.value = buildFormToml()
    }
    editMode.value = 'code'
    runValidation()
  }

  // === 配置模板（5.8） ===
  // 模板接管的字段：切换模板时先清空再合并，保留主机名 / 网络身份 / Peer 等已填内容
  const TEMPLATE_TOP_LEVEL_KEYS = new Set(
    CONFIG_TEMPLATES.flatMap((tpl) => Object.keys(tpl.values).filter((key) => key !== 'flags'))
  )
  const TEMPLATE_FLAG_KEYS = new Set(
    CONFIG_TEMPLATES.flatMap((tpl) => Object.keys(tpl.values.flags ?? {}))
  )

  // 应用模板：只替换模板接管的字段，保留用户已填写的主机名 / 网络身份 / Peer 等
  const applyTemplate = (id: TemplateId) => {
    const tpl = CONFIG_TEMPLATES.find((item) => item.id === id)
    if (!tpl) return
    // 以当前内容为底：表单模式先收集表单改动，避免模板覆盖尚未回写的输入
    let base: Record<string, any> = {}
    try {
      const current =
        editMode.value === 'form' && formParsedOk.value ? buildFormToml() : tomlContent.value
      if (current.trim()) base = toml.parse(current) as Record<string, any>
    } catch {
      base = {}
    }
    // 清空上一个模板接管的字段，再合并新模板值
    TEMPLATE_TOP_LEVEL_KEYS.forEach((key) => delete base[key])
    const flags =
      base.flags && typeof base.flags === 'object' && !Array.isArray(base.flags)
        ? { ...base.flags }
        : {}
    TEMPLATE_FLAG_KEYS.forEach((key) => delete flags[key])
    Object.entries(tpl.values).forEach(([key, value]) => {
      if (key === 'flags' && value && typeof value === 'object') Object.assign(flags, value)
      else base[key] = value
    })
    if (Object.keys(flags).length) base.flags = flags
    else delete base.flags
    tomlContent.value = Object.keys(base).length ? toml.stringify(base) : ''
    if (editMode.value === 'form') {
      formParsedOk.value = parseFormData()
    }
    resetIssues()
  }

  // 校验配置名：非空、仅字母数字下划线连字符、新增时不得与现有配置重名
  const validateName = (): boolean => {
    newConfigName.value = newConfigName.value.trim()
    if (!newConfigName.value) {
      nameError.value = t('newEdit.nameEmpty')
      return false
    }
    if (!isValidConfigName(newConfigName.value)) {
      nameError.value = t('newEdit.nameInvalid')
      return false
    }
    if (props.dialogMode === 'add' && props.existingConfigNames?.includes(newConfigName.value)) {
      nameError.value = t('newEdit.nameExists')
      return false
    }
    nameError.value = ''
    return true
  }

  const saveErrorText = (e: unknown): string => {
    const detail = getErrorMessage(e)
    return detail ? t('newCommon.saveFailDetail', { msg: detail }) : t('newCommon.saveFail')
  }

  // 保存：按当前模式取内容 → 语法校验 → normalizeToml 清洗 → 等待父组件写盘结果后再关闭
  const handleSave = async () => {
    if (saving.value) return
    saveError.value = ''
    if (editMode.value === 'code') {
      const check = validateToml(tomlContent.value)
      if (!check.ok) {
        codeIssue.value = t('newEdit.codeInvalid', {
          line: check.error.line,
          column: check.error.column
        })
        return
      }
      codeIssue.value = ''
    } else if (!formParsedOk.value) {
      codeIssue.value = t('newEdit.formParseFailed')
      return
    }
    if (dialogMode.value === 'add' && !validateName()) return

    // builtFormToml 可能因表单模型异常抛错：必须给出可见反馈，不能静默中止保存
    let rawContent: string
    try {
      rawContent = editMode.value === 'code' ? tomlContent.value : buildFormToml()
    } catch (e) {
      console.error('[config] build toml from form failed:', e)
      saveError.value = saveErrorText(e)
      return
    }
    // 表单构建结果再校验一次：任何非法 TOML 都不得进入写盘流程
    const check = validateToml(rawContent)
    if (!check.ok) {
      codeIssue.value = t('newEdit.codeInvalid', {
        line: check.error.line,
        column: check.error.column
      })
      return
    }

    saving.value = true
    try {
      let content = rawContent
      try {
        // 5.7：保存前统一清洗（默认值合并 + 空值剔除），双模式均不落空参数
        const parsed = toml.parse(rawContent) as Record<string, any>
        // 旧版 LightTier 私有标记迁移到 [lighttier]，保存后不再污染 [flags]
        migrateLightTierConfig(parsed)
        const normalized = normalizeToml(parsed, { mergeDefaults: false })
        if (editMode.value === 'form') {
          // 未兼容配置项在清洗后再写回一次：防止空值清洗等步骤改动其原值
          if (Object.keys(formLockedFlags.value).length) {
            const flags =
              normalized.flags && typeof normalized.flags === 'object' ? normalized.flags : {}
            normalized.flags = { ...flags, ...formLockedFlags.value }
          }
          Object.assign(normalized, formLockedTop.value)
        }
        content = toml.stringify(normalized)
      } catch (e) {
        // 归一化失败：不写坏原文件，保留用户输入；错误详情随提示展示
        console.error('[config] normalize toml failed:', e)
        saveError.value = saveErrorText(e)
        return
      }

      const name = dialogMode.value === 'add' ? newConfigName.value : props.configName
      const ok = await new Promise<boolean>((resolve) => {
        emitSaved(name, content, resolve)
      })
      if (!ok) return
      // 写盘成功才重置基线并关闭；失败时保留弹窗与内容
      initialToml.value = tomlContent.value
      initialName.value = newConfigName.value
      formParsedOk.value = true
      formBaseline.value = formSignature()
      visible.value = false
    } finally {
      saving.value = false
    }
  }

  // 从 TOML 文件导入（校验格式后填充代码区；文件名可用时自动作为配置名）
  const handleImportToml = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'TOML', extensions: ['toml'] }]
      })
      if (!selected) return
      const content = await readTextFile(selected)
      // 校验 TOML 格式
      toml.parse(content)
      tomlContent.value = content
      // 表单模式下同步重解析，避免表单仍显示旧值并在保存时覆盖导入内容
      if (editMode.value === 'form') {
        formParsedOk.value = parseFormData()
        if (formParsedOk.value) codeIssue.value = ''
      }
      // 从文件名提取配置名
      const fileName = selected.split(/[\\/]/).pop() || ''
      const nameWithoutExt = fileName.replace(/\.toml$/i, '')
      if (nameWithoutExt && !props.existingConfigNames?.includes(nameWithoutExt)) {
        newConfigName.value = nameWithoutExt
        nameError.value = ''
      }
    } catch (e: any) {
      // 导入/解析失败必须可见：编辑模式没有名称输入栏，nameError 不会渲染
      if (!e?.message) return
      if (dialogMode.value === 'add') nameError.value = t('newEdit.importFail')
      else saveError.value = t('newEdit.importFail')
    }
  }

  // 弹窗打开时重置内部状态（配置名 / 校验错误 / 脏检查基线）
  const resetOnOpen = () => {
    newConfigName.value = props.dialogMode === 'add' ? '' : props.configName
    nameError.value = ''
    resetIssues()
    tomlContent.value = props.tomlContent
    initialToml.value = props.tomlContent
    initialName.value = props.dialogMode === 'add' ? '' : props.configName
    formBaseline.value = ''
    // 默认表单模式：按传入 TOML 重新解析，避免沿用上一次打开留下的表单值；
    // 解析失败时 switchToForm 会回退代码模式并给出语法提示
    editMode.value = 'code'
    formParsedOk.value = false
    switchToForm()
  }

  return {
    dialogMode,
    isAddMode,
    fieldId,
    newConfigName,
    nameError,
    editMode,
    saving,
    codeIssue,
    saveError,
    tomlContent,
    formData,
    secureModeEnabled,
    secretDisplays,
    secretVisible,
    formStunServers,
    formListeners,
    formPeers,
    formRoutes,
    formExitNodes,
    formFlagsKeys,
    formFlagsVals,
    formDataNetworkName,
    formDataNetworkSecret,
    visibleAdvancedFlagDefs,
    visibleTopSwitchDefs,
    visibleTopTextDefs,
    visibleSecurityFieldDefs,
    securitySectionVisible,
    lockedEntries,
    rpcPortalSupported,
    showRpcPortal,
    unsupportedTitle,
    compatIssues,
    hasCompatError,
    discardVisible,
    discardFromRoute,
    dirty,
    parseFormData,
    buildFormToml,
    removeFlag,
    addPeer,
    removePeer,
    isAdvancedFlagOn,
    toggleAdvancedFlag,
    toggleTopSwitch,
    onSecurityInput,
    pickCredentialFile,
    toggleSecretVisible,
    switchToForm,
    switchToCode,
    applyTemplate,
    handleSave,
    handleImportToml,
    resetOnOpen,
    resolveDiscard,
    confirmDiscard
  }
}

export type ConfigEditorApi = ReturnType<typeof useConfigEditor>
