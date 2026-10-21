<template>
  <CreamDialog
    v-model="visible"
    :title="t('newBackup.title')"
    width="660px"
    height="680px"
    :body-scroll="false"
    :before-close="handleBeforeClose"
  >
    <div class="bk-root">
      <div class="bk-tabs" role="tablist" :aria-label="t('newBackup.title')">
        <button
          v-for="(tab, idx) in tabs"
          :key="tab.key"
          :id="`bk-tab-${tab.key}`"
          :ref="(el) => setTabRef(el, idx)"
          type="button"
          class="bk-tab"
          :class="{ active: activeTab === tab.key }"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`bk-panel-${tab.key}`"
          :tabindex="activeTab === tab.key ? 0 : -1"
          @click="selectTab(tab.key)"
          @keydown="handleTabKeydown($event, idx)"
        >
          <svg
            v-if="tab.key === 'create'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 21V9" />
            <path d="m7 14 5-5 5 5" />
            <path d="M4 5h16" />
          </svg>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <div class="bk-scroll">
        <!-- 创建备份 -->
        <div
          v-if="activeTab === 'create'"
          id="bk-panel-create"
          class="bk-panel"
          role="tabpanel"
          aria-labelledby="bk-tab-create"
          tabindex="0"
        >
          <p class="bk-intro">{{ t('newBackup.createIntro') }}</p>

          <div class="bk-section-head">
            <span class="bk-section-title">{{ t('newBackup.contentTitle') }}</span>
            <div class="bk-inline-actions">
              <button type="button" class="bk-text-btn" @click="selectAllCategories">
                {{ t('newBackup.selectAll') }}
              </button>
              <button type="button" class="bk-text-btn" @click="clearCategories">
                {{ t('newBackup.clearAll') }}
              </button>
            </div>
          </div>

          <div class="bk-cat-grid">
            <label
              v-for="key in BACKUP_CATEGORIES"
              :key="key"
              class="bk-cat"
              :class="{ checked: isSelected(key) }"
            >
              <input
                class="lt-sr-only"
                type="checkbox"
                :checked="isSelected(key)"
                @change="toggleCategory(key)"
              />
              <span class="bk-cat-check" aria-hidden="true">
                <svg
                  v-if="isSelected(key)"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </span>
              <span class="bk-cat-info">
                <span class="bk-cat-head">
                  <span class="bk-cat-title">{{ categoryLabel(key) }}</span>
                  <span v-if="categoryCountText(key)" class="bk-cat-count">{{
                    categoryCountText(key)
                  }}</span>
                </span>
                <span class="bk-cat-desc">{{ categoryDesc(key) }}</span>
              </span>
            </label>
          </div>

          <div class="bk-section-head">
            <span class="bk-section-title">{{ t('newBackup.modeTitle') }}</span>
          </div>

          <div class="bk-mode-grid" role="radiogroup" :aria-label="t('newBackup.modeTitle')">
            <label class="bk-mode" :class="{ active: mode === 'full' }">
              <input class="lt-sr-only" type="radio" name="bk-mode" value="full" v-model="mode" />
              <span class="bk-mode-title">{{ t('newBackup.modeFull') }}</span>
              <span class="bk-mode-desc">{{ t('newBackup.modeFullDesc') }}</span>
            </label>
            <label class="bk-mode" :class="{ active: mode === 'diff' }">
              <input class="lt-sr-only" type="radio" name="bk-mode" value="diff" v-model="mode" />
              <span class="bk-mode-title">{{ t('newBackup.modeDiff') }}</span>
              <span class="bk-mode-desc">{{ t('newBackup.modeDiffDesc') }}</span>
            </label>
          </div>

          <div v-if="mode === 'diff'" class="bk-base-card">
            <div class="bk-base-head">
              <div class="bk-base-info">
                <span class="bk-section-title">{{ t('newBackup.baseTitle') }}</span>
                <span class="bk-hint">{{ t('newBackup.baseDesc') }}</span>
              </div>
              <button
                type="button"
                class="bk-btn bk-btn-ghost"
                :disabled="reading"
                @click="pickFile('base')"
              >
                {{
                  reading
                    ? t('newBackup.reading')
                    : baseManifest
                      ? t('newBackup.baseChange')
                      : t('newBackup.basePick')
                }}
              </button>
            </div>
            <div v-if="baseManifest" class="bk-base-file">
              <span class="bk-base-file-name" :title="baseFileName">{{ baseFileName }}</span>
              <span class="bk-base-file-meta">
                {{
                  t('newBackup.baseMeta', {
                    time: formatDate(baseManifest.createdAt),
                    count: baseManifest.items.length
                  })
                }}
              </span>
            </div>
            <div v-if="baseError" class="bk-error" role="alert">{{ baseError }}</div>
          </div>

          <div
            v-if="createMessage"
            class="bk-notice"
            :class="`is-${createMessageType}`"
            role="status"
          >
            {{ createMessage }}
          </div>
        </div>

        <!-- 导入恢复 -->
        <div
          v-else
          id="bk-panel-restore"
          class="bk-panel"
          role="tabpanel"
          aria-labelledby="bk-tab-restore"
          tabindex="0"
        >
          <!-- 恢复完成 -->
          <div v-if="phase === 'done'" class="bk-done">
            <span class="bk-done-icon" :class="{ 'has-fail': failedItems.length > 0 }">
              <svg
                v-if="failedItems.length === 0"
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12 5 5L20 7" />
              </svg>
              <svg
                v-else
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3 2.5 20h19L12 3Z" />
                <path d="M12 10v4" />
                <path d="M12 17.4h.01" />
              </svg>
            </span>
            <span class="bk-done-title">{{
              failedItems.length
                ? t('newBackup.restorePartial', {
                    count: appliedCount,
                    failed: failedItems.length
                  })
                : t('newBackup.restoreSuccess', { count: appliedCount })
            }}</span>
            <span class="bk-hint">
              {{ failedItems.length ? t('newBackup.reloadHint') : t('newBackup.reloading') }}
            </span>
            <div v-if="failedItems.length" class="bk-failed" role="alert">
              <span>{{ t('newBackup.failedItems') }}</span>
              <span class="bk-failed-list">{{ failedItems.join(' · ') }}</span>
            </div>
          </div>

          <template v-else>
            <p class="bk-intro">{{ t('newBackup.restoreIntro') }}</p>

            <div v-if="!restorePlan" class="bk-pick">
              <span class="bk-pick-icon" aria-hidden="true">
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="m9 15 3-3 3 3" />
                </svg>
              </span>
              <span class="bk-hint bk-pick-hint">{{ t('newBackup.restoreHint') }}</span>
              <button
                type="button"
                class="bk-btn bk-btn-primary"
                :disabled="reading"
                @click="pickFile('restore')"
              >
                {{ reading ? t('newBackup.reading') : t('newBackup.pickFile') }}
              </button>
              <div v-if="restoreError" class="bk-error" role="alert">{{ restoreError }}</div>
            </div>

            <template v-else>
              <div class="bk-file-card">
                <div class="bk-file-main">
                  <span class="bk-file-name" :title="restoreFileName">{{ restoreFileName }}</span>
                  <span class="bk-file-meta">
                    {{ formatDate(restorePlan.manifest.createdAt) }} ·
                    {{ modeLabel(restorePlan.manifest.mode) }} ·
                    {{ t('newBackup.itemCount', { count: restorePlan.entries.length }) }}
                    <template v-if="restorePlan.manifest.appVersion">
                      ·
                      {{ t('newBackup.appVersion', { version: restorePlan.manifest.appVersion }) }}
                    </template>
                  </span>
                  <span v-if="restorePlan.manifest.base" class="bk-file-meta">
                    {{
                      t('newBackup.basedOn', {
                        time: formatDate(restorePlan.manifest.base.createdAt)
                      })
                    }}
                  </span>
                </div>
                <button
                  type="button"
                  class="bk-btn bk-btn-ghost"
                  :disabled="reading || applying"
                  @click="pickFile('restore')"
                >
                  {{ reading ? t('newBackup.reading') : t('newBackup.changeFile') }}
                </button>
              </div>

              <div class="bk-summary">
                <span class="bk-summary-chip status-new"
                  >{{ t('newBackup.statusNew') }} {{ restorePlan.counts.new }}</span
                >
                <span class="bk-summary-chip status-safe"
                  >{{ t('newBackup.statusSafe') }} {{ restorePlan.counts.safe }}</span
                >
                <span class="bk-summary-chip status-conflict"
                  >{{ t('newBackup.statusConflict') }} {{ restorePlan.counts.conflict }}</span
                >
                <span class="bk-summary-chip status-same"
                  >{{ t('newBackup.statusSame') }} {{ restorePlan.counts.same }}</span
                >
                <span class="bk-summary-chip status-invalid"
                  >{{ t('newBackup.statusInvalid') }} {{ restorePlan.counts.invalid }}</span
                >
              </div>

              <div v-if="restorePlan.entries.length === 0" class="bk-notice is-info" role="status">
                {{ t('newBackup.restoreEmpty') }}
              </div>

              <template v-else>
                <div class="bk-bulk">
                  <span class="bk-section-title">{{ t('newBackup.chooseHint') }}</span>
                  <div class="bk-inline-actions">
                    <button type="button" class="bk-text-btn" @click="chooseAll('backup')">
                      {{ t('newBackup.allBackup') }}
                    </button>
                    <button type="button" class="bk-text-btn" @click="chooseAll('local')">
                      {{ t('newBackup.allLocal') }}
                    </button>
                    <button type="button" class="bk-text-btn" @click="resetChoices">
                      {{ t('newBackup.resetChoices') }}
                    </button>
                  </div>
                </div>

                <div class="bk-items">
                  <div
                    v-for="entry in restorePlan.entries"
                    :key="entry.item.id"
                    class="bk-item"
                    :class="`status-${entry.status}`"
                  >
                    <div class="bk-item-main">
                      <div class="bk-item-head">
                        <span class="bk-item-badge">{{ categoryLabel(entry.item.category) }}</span>
                        <span class="bk-item-name" :title="itemTitle(entry)">{{
                          itemTitle(entry)
                        }}</span>
                        <span
                          class="bk-status"
                          :class="`status-${entry.status}`"
                          :title="statusDesc(entry.status)"
                          >{{ statusLabel(entry.status) }}</span
                        >
                      </div>
                      <div class="bk-item-sub">
                        <span v-if="entry.issue" class="bk-issue">{{
                          issueLabel(entry.issue)
                        }}</span>
                        <span v-else>{{ statusDesc(entry.status) }}</span>
                      </div>
                      <div
                        v-if="
                          entry.item.category === 'security' &&
                          entry.status !== 'invalid' &&
                          choices[entry.item.id] === 'backup'
                        "
                        class="bk-item-warn"
                      >
                        {{ t('newBackup.securityNote') }}
                      </div>
                    </div>
                    <div
                      v-if="entry.status !== 'invalid'"
                      class="bk-choice"
                      role="group"
                      :aria-label="t('newBackup.itemChoiceLabel', { name: itemTitle(entry) })"
                    >
                      <button
                        type="button"
                        :class="{ active: choices[entry.item.id] === 'backup' }"
                        :aria-pressed="choices[entry.item.id] === 'backup'"
                        @click="choices[entry.item.id] = 'backup'"
                      >
                        {{ t('newBackup.useBackup') }}
                      </button>
                      <button
                        type="button"
                        :class="{ active: choices[entry.item.id] === 'local' }"
                        :aria-pressed="choices[entry.item.id] === 'local'"
                        @click="choices[entry.item.id] = 'local'"
                      >
                        {{ t('newBackup.useLocal') }}
                      </button>
                    </div>
                  </div>
                </div>

                <p class="bk-hint">{{ t('newBackup.restoreMergeHint') }}</p>
              </template>
            </template>
          </template>
        </div>
      </div>
    </div>

    <!-- 浏览器预览走隐藏 file input；桌面端由 Tauri 打开对话框 -->
    <input
      ref="fileInputRef"
      class="lt-sr-only"
      type="file"
      accept=".json,application/json"
      tabindex="-1"
      @change="handleFileInputChange"
    />

    <template #footer>
      <span class="bk-footer-hint">{{ footerHint }}</span>
      <div class="bk-footer-actions">
        <button
          type="button"
          class="bk-btn bk-btn-ghost"
          :disabled="applying || exporting"
          @click="visible = false"
        >
          {{ t('newCommon.close') }}
        </button>
        <button
          v-if="activeTab === 'create'"
          type="button"
          class="bk-btn bk-btn-primary"
          :disabled="exporting || selectedCategories.length === 0"
          @click="handleExport"
        >
          {{ exporting ? t('newBackup.exporting') : t('newBackup.export') }}
        </button>
        <button
          v-else-if="restorePlan && phase === 'plan'"
          type="button"
          class="bk-btn bk-btn-primary"
          :disabled="applying || selectedCount.backup === 0"
          @click="openConfirm"
        >
          {{
            applying
              ? t('newBackup.applying')
              : t('newBackup.apply', { count: selectedCount.backup })
          }}
        </button>
        <button
          v-else-if="phase === 'done'"
          type="button"
          class="bk-btn bk-btn-primary"
          @click="reloadNow"
        >
          {{ t('newBackup.reloadNow') }}
        </button>
      </div>
    </template>
  </CreamDialog>

  <!-- 恢复确认 -->
  <CreamDialog v-model="confirmVisible" :title="t('newBackup.confirmTitle')" width="420px">
    <div class="bk-confirm">
      <span class="bk-confirm-icon" aria-hidden="true">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4" />
          <path d="M12 17.4h.01" />
        </svg>
      </span>
      <p class="bk-confirm-msg">{{ confirmMessage }}</p>
      <p v-if="selectedConflictCount > 0" class="bk-confirm-warn">
        {{ t('newBackup.confirmConflictWarn', { count: selectedConflictCount }) }}
      </p>
    </div>
    <template #footer>
      <div class="bk-footer-actions">
        <button type="button" class="bk-btn bk-btn-ghost" @click="confirmVisible = false">
          {{ t('newCommon.cancel') }}
        </button>
        <button type="button" class="bk-btn bk-btn-primary" @click="handleApply">
          {{ t('newBackup.confirmApply') }}
        </button>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * BackupDialog — 设置 → 数据管理 → 备份与恢复
 *
 * 创建：按分类勾选内容，支持完整备份与“以某份完整备份为基准”的差量备份；
 * 导入：解析备份文件后与本地逐项比对（same/new/safe/conflict/invalid），
 *       默认仅恢复新增与可安全覆盖项，冲突项由用户逐条选择，确认后写回并重新加载应用。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { useCreamToast } from '@/hooks/useCreamToast'
import {
  applyRestore,
  createRestorePlan,
  exportBackup,
  getBackupContentCounts,
  pickBackupFile,
  type BackupContentCounts
} from '@/hooks/useAppBackup'
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
} from '@/utils/backupUtil'

type FilePurpose = 'base' | 'restore'
type DialogPhase = 'pick' | 'plan' | 'applying' | 'done'

const MAX_BACKUP_FILE_SIZE = 20 * 1024 * 1024

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const toast = useCreamToast()

const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (value) => {
    visible.value = value
  }
)
watch(visible, (value) => {
  emit('update:modelValue', value)
  if (!value) resetTransientState()
})

// ===== 标签页 =====
const activeTab = ref<'create' | 'restore'>('create')
const tabs = computed(() => [
  { key: 'create' as const, label: t('newBackup.tabCreate') },
  { key: 'restore' as const, label: t('newBackup.tabRestore') }
])
const tabRefs = ref<HTMLButtonElement[]>([])
const setTabRef = (el: unknown, idx: number) => {
  if (el) tabRefs.value[idx] = el as HTMLButtonElement
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

watch(visible, async (value) => {
  if (!value) return
  activeTab.value = 'create'
  createMessage.value = ''
  baseError.value = ''
  restoreError.value = ''
  await loadContentCounts()
})

onBeforeUnmount(() => {
  if (reloadTimer !== null) window.clearTimeout(reloadTimer)
})
</script>

<style scoped>
.bk-root {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: var(--theme-space-3);
}

/* 顶部标签：与设置页导航一致的胶囊分段 */
.bk-tabs {
  display: grid;
  padding: 3px;
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
}

.bk-tab {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary, #8b7355);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-pill, 100px);
  transition:
    color 0.15s,
    background 0.15s;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.bk-tab:hover {
  color: var(--theme-text-primary, #4a3728);
}

.bk-tab.active {
  color: var(--theme-accent-primary, #d4a574);
  background: var(--theme-bg-card, #fff);
}

.bk-tab:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 1px;
}

.bk-scroll {
  min-height: 0;
  padding-right: 4px;
  overflow-y: auto;
  flex: 1;
  overscroll-behavior: contain;
}

.bk-scroll::-webkit-scrollbar {
  width: 4px;
}

.bk-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.bk-scroll::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.bk-panel {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.bk-intro {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--theme-text-muted, #c8bdb2);
}

.bk-section-head,
.bk-bulk {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

.bk-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.bk-inline-actions {
  display: flex;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

.bk-text-btn {
  padding: 2px 0;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 11px;
  color: var(--theme-text-secondary, #8b7355);
  cursor: pointer;
  background: transparent;
  border: none;
}

.bk-text-btn:hover {
  color: var(--theme-accent-primary, #d4a574);
}

.bk-text-btn:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

/* 分类卡片：两列排布，窄屏回落单列 */
.bk-cat-grid,
.bk-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--theme-space-2);
}

.bk-cat {
  display: flex;
  min-width: 0;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  transition:
    border-color 0.15s,
    background 0.15s;
  align-items: flex-start;
  gap: 9px;
}

.bk-cat:hover {
  border-color: var(--theme-border, #ede4db);
}

.bk-cat.checked {
  background: color-mix(in srgb, var(--theme-accent-primary, #d4a574) 6%, transparent);
  border-color: var(--theme-accent-primary, #d4a574);
}

.bk-cat:focus-within,
.bk-mode:focus-within {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.bk-cat-check {
  display: flex;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  color: var(--theme-text-on-accent, #fff);
  background: transparent;
  border: 1.5px solid var(--theme-border, #e8ddd3);
  border-radius: 4px;
  transition:
    background 0.15s,
    border-color 0.15s;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bk-cat.checked .bk-cat-check {
  background: var(--theme-accent-primary, #d4a574);
  border-color: var(--theme-accent-primary, #d4a574);
}

.bk-cat-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.bk-cat-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bk-cat-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.bk-cat-count {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: var(--theme-text-secondary, #8b7355);
  white-space: nowrap;
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
}

.bk-cat-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
  overflow-wrap: anywhere;
}

/* 备份方式 */
.bk-mode {
  display: flex;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  transition:
    border-color 0.15s,
    background 0.15s;
  flex-direction: column;
  gap: 3px;
}

.bk-mode.active {
  background: color-mix(in srgb, var(--theme-accent-primary, #d4a574) 6%, transparent);
  border-color: var(--theme-accent-primary, #d4a574);
}

.bk-mode-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.bk-mode-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
}

/* 差量基准 */
.bk-base-card {
  display: flex;
  padding: var(--theme-space-3);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  flex-direction: column;
  gap: var(--theme-space-2);
}

.bk-base-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
}

.bk-base-info {
  display: flex;
  min-width: 220px;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.bk-base-file {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-sm, 6px);
  flex-direction: column;
  gap: 2px;
}

.bk-base-file-name,
.bk-file-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-primary, #4a3728);
  overflow-wrap: anywhere;
}

.bk-base-file-meta,
.bk-file-meta {
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
}

.bk-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
}

.bk-error {
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-color-danger, #e8a0a0);
}

.bk-notice {
  padding: var(--theme-space-2) var(--theme-space-3);
  font-size: 12px;
  line-height: 1.5;
  border-radius: var(--theme-radius-sm, 6px);
}

.bk-notice.is-success {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 10%, transparent);
}

.bk-notice.is-warning {
  color: var(--theme-color-warning, #d9a441);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 10%, transparent);
}

.bk-notice.is-info {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-bg-tag, #f5ede6);
}

/* 选择备份文件空态 */
.bk-pick {
  display: flex;
  padding: var(--theme-space-6) var(--theme-space-4);
  text-align: center;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1.5px dashed var(--theme-border, #e8ddd3);
  border-radius: var(--theme-radius-lg, 14px);
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-3);
}

.bk-pick-icon {
  color: var(--theme-text-muted, #c8bdb2);
}

.bk-pick-hint {
  max-width: 360px;
}

/* 文件摘要 */
.bk-file-card {
  display: flex;
  padding: var(--theme-space-3);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
}

.bk-file-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.bk-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.bk-summary-chip {
  padding: 2px 8px;
  font-size: 11px;
  white-space: nowrap;
  border-radius: var(--theme-radius-pill, 100px);
}

.bk-summary-chip.status-new,
.bk-summary-chip.status-safe {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

.bk-summary-chip.status-conflict {
  color: var(--theme-color-warning, #d9a441);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 12%, transparent);
}

.bk-summary-chip.status-same {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-bg-tag, #f5ede6);
}

.bk-summary-chip.status-invalid {
  color: var(--theme-color-danger, #e8a0a0);
  background: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 12%, transparent);
}

/* 逐项列表 */
.bk-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bk-item {
  display: flex;
  padding: 8px 10px;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  align-items: center;
  gap: var(--theme-space-3);
}

.bk-item.status-conflict {
  border-color: color-mix(in srgb, var(--theme-color-warning, #d9a441) 45%, transparent);
}

.bk-item.status-invalid {
  opacity: 0.7;
}

.bk-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.bk-item-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.bk-item-badge {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: var(--theme-text-secondary, #8b7355);
  white-space: nowrap;
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
}

.bk-item-name {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-primary, #4a3728);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.bk-status {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
}

.bk-status.status-new,
.bk-status.status-safe {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

.bk-status.status-conflict {
  color: var(--theme-color-warning, #d9a441);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 12%, transparent);
}

.bk-status.status-same {
  color: var(--theme-text-muted, #c8bdb2);
  background: var(--theme-bg-tag, #f5ede6);
}

.bk-status.status-invalid {
  color: var(--theme-color-danger, #e8a0a0);
  background: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 12%, transparent);
}

.bk-item-sub {
  padding-left: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
  overflow-wrap: anywhere;
}

.bk-issue {
  color: var(--theme-color-danger, #e8a0a0);
}

.bk-item-warn {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-color-warning, #d9a441);
}

.bk-choice {
  display: flex;
  overflow: hidden;
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #e8ddd3);
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
}

.bk-choice button {
  padding: 3px 9px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 11px;
  color: var(--theme-text-secondary, #8b7355);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  transition:
    color 0.15s,
    background 0.15s;
}

.bk-choice button:hover {
  color: var(--theme-text-primary, #4a3728);
}

.bk-choice button.active {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.bk-choice button:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: -2px;
}

/* 完成态 */
.bk-done {
  display: flex;
  padding: var(--theme-space-6) var(--theme-space-4);
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-2);
  text-align: center;
}

.bk-done-icon {
  display: flex;
  width: 56px;
  height: 56px;
  margin-bottom: var(--theme-space-2);
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
  border-radius: 50%;
  align-items: center;
  justify-content: center;
}

.bk-done-icon.has-fail {
  color: var(--theme-color-warning, #d9a441);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 12%, transparent);
}

.bk-done-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.bk-failed {
  display: flex;
  margin-top: var(--theme-space-2);
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-color-danger, #e8a0a0);
  flex-direction: column;
  gap: 2px;
}

.bk-failed-list {
  overflow-wrap: anywhere;
}

/* 确认弹窗 */
.bk-confirm {
  display: flex;
  padding: var(--theme-space-2) 0;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-2);
  text-align: center;
}

.bk-confirm-icon {
  color: var(--theme-color-warning, #d9a441);
}

.bk-confirm-msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #8b7355);
}

.bk-confirm-warn {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-color-danger, #e8a0a0);
}

/* 底部 */
.bk-footer-hint {
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
  flex: 1;
}

.bk-footer-actions {
  display: flex;
  gap: var(--theme-space-2);
  flex-shrink: 0;
}

.bk-btn {
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.bk-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.bk-btn-ghost {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-surface-secondary, #f5ede4);
  border-color: var(--theme-border, #e8ddd3);
}

.bk-btn-ghost:hover:not(:disabled) {
  background: var(--theme-surface-hover, #efe5d9);
}

.bk-btn-primary {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.bk-btn-primary:hover:not(:disabled) {
  background: var(--theme-accent-hover, #c9955f);
}

.bk-btn:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

@media (width <= 720px) {
  .bk-cat-grid,
  .bk-mode-grid {
    grid-template-columns: 1fr;
  }

  .bk-item {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .bk-choice {
    margin-left: auto;
  }

  .bk-footer-hint {
    display: none;
  }
}
</style>
