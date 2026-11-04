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
        <LtButton
          v-for="(tab, idx) in tabs"
          :key="tab.key"
          variant="bare"
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
        </LtButton>
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
              <LtButton variant="text" size="xs" type="button" @click="selectAllCategories">
                {{ t('newBackup.selectAll') }}
              </LtButton>
              <LtButton variant="text" size="xs" type="button" @click="clearCategories">
                {{ t('newBackup.clearAll') }}
              </LtButton>
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
              <LtButton type="button" variant="ghost" :disabled="reading" @click="pickFile('base')">
                {{
                  reading
                    ? t('newBackup.reading')
                    : baseManifest
                      ? t('newBackup.baseChange')
                      : t('newBackup.basePick')
                }}
              </LtButton>
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
              <LtButton
                type="button"
                variant="primary"
                :disabled="reading"
                @click="pickFile('restore')"
              >
                {{ reading ? t('newBackup.reading') : t('newBackup.pickFile') }}
              </LtButton>
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
                <LtButton
                  type="button"
                  variant="ghost"
                  :disabled="reading || applying"
                  @click="pickFile('restore')"
                >
                  {{ reading ? t('newBackup.reading') : t('newBackup.changeFile') }}
                </LtButton>
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
                    <LtButton variant="text" size="xs" type="button" @click="chooseAll('backup')">
                      {{ t('newBackup.allBackup') }}
                    </LtButton>
                    <LtButton variant="text" size="xs" type="button" @click="chooseAll('local')">
                      {{ t('newBackup.allLocal') }}
                    </LtButton>
                    <LtButton variant="text" size="xs" type="button" @click="resetChoices">
                      {{ t('newBackup.resetChoices') }}
                    </LtButton>
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
                      <LtButton
                        type="button"
                        variant="bare"
                        :class="{ active: choices[entry.item.id] === 'backup' }"
                        :aria-pressed="choices[entry.item.id] === 'backup'"
                        @click="choices[entry.item.id] = 'backup'"
                      >
                        {{ t('newBackup.useBackup') }}
                      </LtButton>
                      <LtButton
                        type="button"
                        variant="bare"
                        :class="{ active: choices[entry.item.id] === 'local' }"
                        :aria-pressed="choices[entry.item.id] === 'local'"
                        @click="choices[entry.item.id] = 'local'"
                      >
                        {{ t('newBackup.useLocal') }}
                      </LtButton>
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
      :ref="setFileInputRef"
      class="lt-sr-only"
      type="file"
      accept=".json,application/json"
      tabindex="-1"
      @change="handleFileInputChange"
    />

    <template #footer>
      <span class="bk-footer-hint">{{ footerHint }}</span>
      <div class="bk-footer-actions">
        <LtButton
          type="button"
          variant="ghost"
          :disabled="applying || exporting"
          @click="visible = false"
        >
          {{ t('newCommon.close') }}
        </LtButton>
        <LtButton
          v-if="activeTab === 'create'"
          type="button"
          variant="primary"
          :disabled="exporting || selectedCategories.length === 0"
          @click="handleExport"
        >
          {{ exporting ? t('newBackup.exporting') : t('newBackup.export') }}
        </LtButton>
        <LtButton
          v-else-if="restorePlan && phase === 'plan'"
          type="button"
          variant="primary"
          :disabled="applying || selectedCount.backup === 0"
          @click="openConfirm"
        >
          {{
            applying
              ? t('newBackup.applying')
              : t('newBackup.apply', { count: selectedCount.backup })
          }}
        </LtButton>
        <LtButton v-else-if="phase === 'done'" type="button" variant="primary" @click="reloadNow">
          {{ t('newBackup.reloadNow') }}
        </LtButton>
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
        <LtButton type="button" variant="ghost" @click="confirmVisible = false">
          {{ t('newCommon.cancel') }}
        </LtButton>
        <LtButton type="button" variant="primary" @click="handleApply">
          {{ t('newBackup.confirmApply') }}
        </LtButton>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * BackupDialog — 设置 → 数据管理 → 备份与恢复
 *
 * 创建 / 导入恢复的完整流程在 composables/useBackupRestore.ts；本组件只负责
 * v-model 同步、模板渲染，以及打开 / 关闭 / 卸载时的状态衔接。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import { LtButton } from '@/shared/ui'
import { useBackupRestore } from '../../composables/useBackupRestore'
import { BACKUP_CATEGORIES } from '../../lib/backupUtil'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const backup = useBackupRestore()

const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (value) => {
    visible.value = value
  }
)
watch(visible, (value) => {
  emit('update:modelValue', value)
  if (value) void backup.onDialogOpen()
  else backup.resetTransientState()
})

onBeforeUnmount(backup.dispose)

const {
  activeTab,
  tabs,
  setTabRef,
  selectTab,
  handleTabKeydown,
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
  handleBeforeClose
} = backup
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
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
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

/* 分类卡片：两列排布，窄屏回落单列 */
.bk-cat-grid,
.bk-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--theme-space-2);
}

.bk-cat {
  position: relative;
  display: flex;
  min-width: 0;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  transition:
    border-color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: flex-start;
  gap: 9px;
}

.bk-cat:hover {
  border-color: var(--theme-border, #ede4db);
}

.bk-cat.checked {
  background: rgb(var(--theme-accent-primary-rgb, 212, 165, 116), 0.06);
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
    background-color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration-fast) var(--theme-ease-out);
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
  position: relative;
  display: flex;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  transition:
    border-color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  flex-direction: column;
  gap: 3px;
}

.bk-mode.active {
  background: rgb(var(--theme-accent-primary-rgb, 212, 165, 116), 0.06);
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
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.1);
}

.bk-notice.is-warning {
  color: var(--theme-color-warning, #d9a441);
  background: rgb(var(--theme-color-warning-rgb, 217, 164, 65), 0.1);
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
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12);
}

.bk-summary-chip.status-conflict {
  color: var(--theme-color-warning, #d9a441);
  background: rgb(var(--theme-color-warning-rgb, 217, 164, 65), 0.12);
}

.bk-summary-chip.status-same {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-bg-tag, #f5ede6);
}

.bk-summary-chip.status-invalid {
  color: var(--theme-color-danger, #e8a0a0);
  background: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.12);
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
  border-color: rgb(var(--theme-color-warning-rgb, 217, 164, 65), 0.45);
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
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12);
}

.bk-status.status-conflict {
  color: var(--theme-color-warning, #d9a441);
  background: rgb(var(--theme-color-warning-rgb, 217, 164, 65), 0.12);
}

.bk-status.status-same {
  color: var(--theme-text-muted, #c8bdb2);
  background: var(--theme-bg-tag, #f5ede6);
}

.bk-status.status-invalid {
  color: var(--theme-color-danger, #e8a0a0);
  background: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.12);
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
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
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
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12);
  border-radius: 50%;
  align-items: center;
  justify-content: center;
}

.bk-done-icon.has-fail {
  color: var(--theme-color-warning, #d9a441);
  background: rgb(var(--theme-color-warning-rgb, 217, 164, 65), 0.12);
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
