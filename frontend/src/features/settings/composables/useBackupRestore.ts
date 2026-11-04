/**
 * 备份与恢复弹窗的全部状态与流程（设置 → 数据管理 → 备份与恢复）。
 *
 * 创建：按分类勾选内容，支持完整备份与“以某份完整备份为基准”的差量备份；
 * 导入：解析备份文件后与本地逐项比对（same/new/safe/conflict/invalid），
 *       默认仅恢复新增与可安全覆盖项，冲突项由用户逐条选择，确认后写回并重新加载应用。
 * 弹窗组件只保留 v-model 同步与模板，打开/关闭与卸载清理通过本 composable 的回调衔接。
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import {
  applyRestore,
  createRestorePlan,
  exportBackup,
  getBackupContentCounts,
  pickBackupFile,
  type BackupContentCounts
} from './useAppBackup'
import {
  BACKUP_CATEGORIES,
  countRestoreSelection,
  createDefaultChoices,
  parseBackupManifest,
  type BackupCategory,
  type BackupItemIssue,
  type BackupManifest,
  type BackupMode,
  type BackupParseError,
  type RestoreChoice,
  type RestorePlan,
  type RestorePlanEntry,
  type RestoreStatus
} from '../lib/backupUtil'

type FilePurpose = 'base' | 'restore'
type DialogPhase = 'pick' | 'plan' | 'applying' | 'done'

const MAX_BACKUP_FILE_SIZE = 20 * 1024 * 1024

export function useBackupRestore() {
  const { t } = useI18n()
  const toast = useCreamToast()

  // ===== 标签页 =====
  const activeTab = ref<'create' | 'restore'>('create')
  const tabs = computed(() => [
    { key: 'create' as const, label: t('newBackup.tabCreate') },
    { key: 'restore' as const, label: t('newBackup.tabRestore') }
  ])
  const tabRefs = ref<HTMLButtonElement[]>([])
  // LtButton 的模板 ref 是组件实例，取出根按钮元素供焦点管理使用
  const setTabRef = (el: unknown, idx: number) => {
    if (!el) return
    const rootEl = (el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)
    tabRefs.value[idx] = rootEl as HTMLButtonElement
  }
  const selectTab = (key: 'create' | 'restore') => {
    activeTab.value = key
  }
  const handleTabKeydown = (e: KeyboardEvent, idx: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    let next = idx
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.value.length) % tabs.value.length
    else if (e.key === 'ArrowRight') next = (idx + 1) % tabs.value.length
    else if (e.key === 'Home') next = 0
    else next = tabs.value.length - 1
    selectTab(tabs.value[next].key)
    nextTick(() => tabRefs.value[next]?.focus())
  }

  // ===== 创建备份 =====
  const contentCounts = ref<BackupContentCounts>({ configs: 0, web: 0 })
  const selectedCategories = ref<BackupCategory[]>([...BACKUP_CATEGORIES])
  const mode = ref<BackupMode>('full')
  const baseManifest = ref<BackupManifest | null>(null)
  const baseFileName = ref('')
  const baseError = ref('')
  const exporting = ref(false)
  const createMessage = ref('')
  const createMessageType = ref<'success' | 'warning' | 'info'>('info')

  const isSelected = (key: BackupCategory): boolean => selectedCategories.value.includes(key)
  const toggleCategory = (key: BackupCategory) => {
    if (isSelected(key)) {
      selectedCategories.value = selectedCategories.value.filter((item) => item !== key)
    } else {
      selectedCategories.value = BACKUP_CATEGORIES.filter(
        (item) => item === key || selectedCategories.value.includes(item)
      )
    }
    createMessage.value = ''
  }
  const selectAllCategories = () => {
    selectedCategories.value = [...BACKUP_CATEGORIES]
    createMessage.value = ''
  }
  const clearCategories = () => {
    selectedCategories.value = []
    createMessage.value = ''
  }

  const CATEGORY_LABEL_KEYS: Record<BackupCategory, string> = {
    configs: 'catConfigs',
    web: 'catWeb',
    preferences: 'catPreferences',
    appearance: 'catAppearance',
    security: 'catSecurity',
    mirror: 'catMirror'
  }
  const CATEGORY_DESC_KEYS: Record<BackupCategory, string> = {
    configs: 'catConfigsDesc',
    web: 'catWebDesc',
    preferences: 'catPreferencesDesc',
    appearance: 'catAppearanceDesc',
    security: 'catSecurityDesc',
    mirror: 'catMirrorDesc'
  }
  const categoryLabel = (key: BackupCategory): string => t(`newBackup.${CATEGORY_LABEL_KEYS[key]}`)
  const categoryDesc = (key: BackupCategory): string => t(`newBackup.${CATEGORY_DESC_KEYS[key]}`)
  const categoryCountText = (key: BackupCategory): string => {
    if (key === 'configs' && contentCounts.value.configs > 0) {
      return t('newBackup.countConfigs', { count: contentCounts.value.configs })
    }
    if (key === 'web' && contentCounts.value.web > 0) {
      return t('newBackup.countWeb', { count: contentCounts.value.web })
    }
    return ''
  }

  const loadContentCounts = async () => {
    try {
      contentCounts.value = await getBackupContentCounts()
    } catch (error) {
      console.error('统计备份内容失败:', error)
      contentCounts.value = { configs: 0, web: 0 }
    }
  }

  const handleExport = async () => {
    createMessage.value = ''
    if (selectedCategories.value.length === 0) {
      createMessageType.value = 'warning'
      createMessage.value = t('newBackup.selectAtLeastOne')
      return
    }
    if (mode.value === 'diff' && !baseManifest.value) {
      createMessageType.value = 'warning'
      createMessage.value = t('newBackup.baseMissing')
      return
    }
    exporting.value = true
    try {
      const result = await exportBackup({
        mode: mode.value,
        categories: [...selectedCategories.value],
        base: mode.value === 'diff' ? (baseManifest.value ?? undefined) : undefined
      })
      if (!result.ok) {
        if (result.reason === 'cancelled') {
          createMessageType.value = 'info'
          createMessage.value = t('newBackup.exportCancelled')
        } else {
          createMessageType.value = 'warning'
          createMessage.value = t(
            result.reason === 'empty'
              ? 'newBackup.exportEmpty'
              : result.reason === 'nothing-changed'
                ? 'newBackup.exportNothingChanged'
                : 'newBackup.exportFailed'
          )
        }
        return
      }
      createMessageType.value = 'success'
      createMessage.value = t('newBackup.exportSuccess', {
        name: result.fileName,
        count: result.itemCount
      })
      toast.success(t('newBackup.exportToast'))
    } catch (error) {
      console.error('导出备份失败:', error)
      createMessageType.value = 'warning'
      createMessage.value = t('newBackup.exportFailed')
    } finally {
      exporting.value = false
    }
  }

  // ===== 导入恢复 =====
  const fileInputRef = ref<HTMLInputElement | null>(null)
  // 模板 ref 由弹窗组件绑定：组件内以函数 ref 回写
  const setFileInputRef = (el: unknown) => {
    fileInputRef.value = (el as HTMLInputElement | null) ?? null
  }
  const fileInputPurpose = ref<FilePurpose>('restore')
  const reading = ref(false)
  const restoreFileName = ref('')
  const restoreError = ref('')
  const restorePlan = ref<RestorePlan | null>(null)
  const choices = ref<Record<string, RestoreChoice>>({})
  const phase = ref<DialogPhase>('pick')
  const applying = ref(false)
  const appliedCount = ref(0)
  const failedItems = ref<string[]>([])
  const confirmVisible = ref(false)
  let reloadTimer: number | null = null

  const PARSE_ERROR_KEYS: Record<BackupParseError, string> = {
    'invalid-json': 'parseInvalidJson',
    'not-backup': 'parseNotBackup',
    'unsupported-version': 'parseUnsupportedVersion',
    'invalid-structure': 'parseInvalidStructure',
    'too-large': 'parseTooLarge'
  }
  const statusLabel = (status: RestoreStatus): string =>
    t(
      `newBackup.${
        status === 'new'
          ? 'statusNew'
          : status === 'safe'
            ? 'statusSafe'
            : status === 'conflict'
              ? 'statusConflict'
              : status === 'invalid'
                ? 'statusInvalid'
                : 'statusSame'
      }`
    )
  const STATUS_DESC_KEYS: Record<RestoreStatus, string> = {
    same: 'statusSameDesc',
    new: 'statusNewDesc',
    safe: 'statusSafeDesc',
    conflict: 'statusConflictDesc',
    invalid: 'statusInvalidDesc'
  }
  const statusDesc = (status: RestoreStatus): string => t(`newBackup.${STATUS_DESC_KEYS[status]}`)
  const ISSUE_KEYS: Record<BackupItemIssue, string> = {
    'config-name': 'issueConfigName',
    'config-toml': 'issueConfigToml',
    'web-json': 'issueWebJson',
    'preferences-json': 'issuePreferencesJson',
    'appearance-json': 'issueAppearanceJson',
    'security-format': 'issueSecurityFormat',
    'mirror-json': 'issueMirrorJson',
    'unknown-category': 'issueUnknownCategory'
  }
  const issueLabel = (issue: BackupItemIssue): string => t(`newBackup.${ISSUE_KEYS[issue]}`)
  const modeLabel = (value: BackupMode): string =>
    t(value === 'diff' ? 'newBackup.modeDiff' : 'newBackup.modeFull')
  const formatDate = (value: string): string => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }
  const itemTitle = (entry: RestorePlanEntry): string =>
    entry.item.category === 'configs' ? entry.item.name : categoryLabel(entry.item.category)

  const selectedCount = computed(() =>
    restorePlan.value
      ? countRestoreSelection(restorePlan.value.entries, choices.value)
      : { backup: 0, local: 0, invalid: 0 }
  )
  const selectedConflictCount = computed(() => {
    if (!restorePlan.value) return 0
    return restorePlan.value.entries.filter(
      (entry) => entry.status === 'conflict' && choices.value[entry.item.id] === 'backup'
    ).length
  })
  const confirmMessage = computed(() =>
    t('newBackup.confirmMsg', {
      count: selectedCount.value.backup,
      conflict: selectedConflictCount.value
    })
  )
  const footerHint = computed(() => {
    if (activeTab.value === 'create') return t('newBackup.footerHintCreate')
    if (phase.value === 'done') {
      return failedItems.value.length ? t('newBackup.reloadHint') : t('newBackup.reloading')
    }
    if (restorePlan.value) {
      return t('newBackup.footerSelected', {
        backup: selectedCount.value.backup,
        local: selectedCount.value.local
      })
    }
    return ''
  })

  const resetTransientState = () => {
    restorePlan.value = null
    restoreFileName.value = ''
    restoreError.value = ''
    choices.value = {}
    phase.value = 'pick'
    appliedCount.value = 0
    failedItems.value = []
    confirmVisible.value = false
    baseManifest.value = null
    baseFileName.value = ''
    baseError.value = ''
    createMessage.value = ''
    activeTab.value = 'create'
  }

  const setFileError = (purpose: FilePurpose, message: string) => {
    if (purpose === 'base') baseError.value = message
    else restoreError.value = message
  }

  const parseErrorText = (reason: BackupParseError): string =>
    t(`newBackup.${PARSE_ERROR_KEYS[reason]}`)

  const handleBackupText = async (
    text: string,
    fileName: string,
    purpose: FilePurpose
  ): Promise<void> => {
    if (purpose === 'restore') {
      // 用户明确选择了新文件：先清空旧计划，避免失败后仍展示过期预览
      restorePlan.value = null
      restoreFileName.value = ''
      restoreError.value = ''
      choices.value = {}
      phase.value = 'pick'
    }
    const parsed = parseBackupManifest(text)
    if (!parsed.ok) {
      setFileError(purpose, parseErrorText(parsed.reason))
      return
    }
    if (purpose === 'base') {
      if (parsed.manifest.mode !== 'full') {
        baseError.value = t('newBackup.baseNotFull')
        return
      }
      baseManifest.value = parsed.manifest
      baseFileName.value = fileName
      baseError.value = ''
      return
    }
    try {
      const nextPlan = await createRestorePlan(parsed.manifest)
      restorePlan.value = nextPlan
      restoreFileName.value = fileName
      choices.value = createDefaultChoices(nextPlan.entries)
      phase.value = 'plan'
    } catch (error) {
      console.error('生成恢复计划失败:', error)
      restoreError.value = t('newBackup.planFailed')
    }
  }

  const pickFile = async (purpose: FilePurpose): Promise<void> => {
    reading.value = true
    setFileError(purpose, '')
    try {
      const result = await pickBackupFile()
      if (!result.ok) {
        if (result.reason === 'unsupported') {
          // 浏览器预览：Tauri 对话框不可用，改用隐藏 file input 读取
          fileInputPurpose.value = purpose
          await nextTick()
          fileInputRef.value?.click()
          return
        }
        if (result.reason === 'read-failed') {
          setFileError(purpose, t('newBackup.readFailed'))
        }
        return
      }
      await handleBackupText(result.text, result.fileName, purpose)
    } finally {
      reading.value = false
    }
  }

  const handleFileInputChange = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const purpose = fileInputPurpose.value
    if (file.size > MAX_BACKUP_FILE_SIZE) {
      setFileError(purpose, t('newBackup.parseTooLarge'))
      return
    }
    reading.value = true
    try {
      await handleBackupText(await file.text(), file.name, purpose)
    } catch (error) {
      console.error('读取备份文件失败:', error)
      setFileError(purpose, t('newBackup.readFailed'))
    } finally {
      reading.value = false
    }
  }

  const chooseAll = (choice: RestoreChoice) => {
    if (!restorePlan.value) return
    const next = { ...choices.value }
    for (const entry of restorePlan.value.entries) {
      if (entry.status !== 'invalid') next[entry.item.id] = choice
    }
    choices.value = next
  }
  const resetChoices = () => {
    if (!restorePlan.value) return
    choices.value = createDefaultChoices(restorePlan.value.entries)
  }

  const openConfirm = () => {
    if (!restorePlan.value) return
    if (selectedCount.value.backup === 0) {
      toast.info(t('newBackup.noSelection'))
      return
    }
    confirmVisible.value = true
  }

  const scheduleReload = () => {
    if (reloadTimer !== null) window.clearTimeout(reloadTimer)
    reloadTimer = window.setTimeout(() => {
      reloadTimer = null
      window.location.reload()
    }, 1500)
  }

  const reloadNow = () => {
    if (reloadTimer !== null) {
      window.clearTimeout(reloadTimer)
      reloadTimer = null
    }
    window.location.reload()
  }

  const handleApply = async () => {
    if (!restorePlan.value || applying.value) return
    const plan = restorePlan.value
    confirmVisible.value = false
    applying.value = true
    phase.value = 'applying'
    try {
      const result = await applyRestore(plan, choices.value)
      appliedCount.value = result.applied
      failedItems.value = result.failed.map((id) => {
        const entry = plan.entries.find((item) => item.item.id === id)
        return entry ? itemTitle(entry) : id
      })
      phase.value = 'done'
      if (failedItems.value.length === 0) {
        toast.success(t('newBackup.restoreSuccess', { count: result.applied }))
        scheduleReload()
      } else {
        toast.warning(
          t('newBackup.restorePartial', {
            count: result.applied,
            failed: failedItems.value.length
          })
        )
      }
    } catch (error) {
      console.error('恢复备份失败:', error)
      phase.value = 'plan'
      toast.error(t('newBackup.restoreFailed'))
    } finally {
      applying.value = false
    }
  }

  const handleBeforeClose = (): boolean => !applying.value && !exporting.value

  // 弹窗每次打开：回到创建页并刷新可备份条目数
  const onDialogOpen = async () => {
    activeTab.value = 'create'
    createMessage.value = ''
    baseError.value = ''
    restoreError.value = ''
    await loadContentCounts()
  }

  // 组件卸载时清掉待执行的重新加载定时器
  const dispose = () => {
    if (reloadTimer !== null) {
      window.clearTimeout(reloadTimer)
      reloadTimer = null
    }
  }

  return {
    activeTab,
    tabs,
    setTabRef,
    selectTab,
    handleTabKeydown,
    contentCounts,
    selectedCategories,
    mode,
    baseManifest,
    baseFileName,
    baseError,
    exporting,
    createMessage,
    createMessageType,
    isSelected,
    toggleCategory,
    selectAllCategories,
    clearCategories,
    categoryLabel,
    categoryDesc,
    categoryCountText,
    handleExport,
    setFileInputRef,
    reading,
    restoreFileName,
    restoreError,
    restorePlan,
    choices,
    phase,
    applying,
    appliedCount,
    failedItems,
    confirmVisible,
    statusLabel,
    statusDesc,
    issueLabel,
    modeLabel,
    formatDate,
    itemTitle,
    selectedCount,
    selectedConflictCount,
    confirmMessage,
    footerHint,
    pickFile,
    handleFileInputChange,
    chooseAll,
    resetChoices,
    openConfirm,
    reloadNow,
    handleApply,
    handleBeforeClose,
    resetTransientState,
    onDialogOpen,
    dispose
  }
}
