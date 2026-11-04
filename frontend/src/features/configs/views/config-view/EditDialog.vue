<template>
  <CreamDialog
    ref="dialogRef"
    v-model="visible"
    :title="editorDialogMode === 'add' ? t('newEdit.addTitle') : t('newEdit.editTitle')"
    width="800px"
    :inline="inline"
    :before-close="handleBeforeClose"
  >
    <!-- 配置名称（仅新增模式显示） -->
    <div v-if="editorDialogMode === 'add'" class="ed-name-bar">
      <label class="ed-form-label" :for="fieldId('configName')">{{
        t('newEdit.configName')
      }}</label>
      <LtInput
        v-model="newConfigName"
        class="ed-name-input"
        variant="outline"
        :aria-label="t('newEdit.configName')"
        :placeholder="t('newEdit.configNamePlaceholder')"
      />
      <span v-if="nameError" class="ed-name-error" role="alert">{{ nameError }}</span>
      <!-- 模板选择：主题化下拉，选项附带用途说明；仅更新模板相关字段，不覆盖已填写的其他内容 -->
      <div class="ed-template-select">
        <button
          :id="fieldId('template-trigger')"
          ref="templateTriggerRef"
          type="button"
          class="ed-template-trigger"
          :aria-label="t('newEdit.templateLabel')"
          aria-haspopup="listbox"
          :aria-expanded="templateDropdownOpen"
          :aria-controls="fieldId('template-menu')"
          @click.stop="toggleTemplateDropdown"
          @keydown.down.prevent="openTemplateDropdown(1)"
          @keydown.up.prevent="openTemplateDropdown(-1)"
          @keydown.esc="closeTemplateDropdown()"
        >
          <span class="ed-template-trigger-label">{{ t(currentTemplate.labelKey) }}</span>
          <svg
            class="ed-template-caret"
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <Teleport to="body">
          <Transition name="ed-template-drop">
            <div
              v-if="templateDropdownOpen"
              :id="fieldId('template-menu')"
              ref="templateMenuRef"
              class="ed-template-menu"
              :style="templateMenuStyle"
              role="listbox"
              :aria-label="t('newEdit.templateLabel')"
              @keydown.down.prevent="focusTemplateOption(templateHighlighted + 1)"
              @keydown.up.prevent="focusTemplateOption(templateHighlighted - 1)"
              @keydown.home.prevent="focusTemplateOption(0)"
              @keydown.end.prevent="focusTemplateOption(CONFIG_TEMPLATES.length - 1)"
              @keydown.esc.prevent="closeTemplateDropdown(true)"
              @keydown.tab="closeTemplateDropdown()"
            >
              <LtButton
                v-for="(tpl, idx) in CONFIG_TEMPLATES"
                :key="tpl.id"
                variant="bare"
                role="option"
                class="ed-template-option"
                :class="{ active: tpl.id === templateId }"
                :aria-selected="tpl.id === templateId"
                @click="selectTemplate(tpl.id)"
                @focus="templateHighlighted = idx"
                @mouseenter="templateHighlighted = idx"
              >
                <span class="ed-template-option-text">
                  <span class="ed-template-option-label">{{ t(tpl.labelKey) }}</span>
                  <span class="ed-template-option-desc">{{ t(tpl.descriptionKey) }}</span>
                </span>
                <svg
                  v-if="tpl.id === templateId"
                  class="ed-template-check"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </LtButton>
            </div>
          </Transition>
        </Teleport>
      </div>
      <LtButton
        variant="ghost"
        size="md"
        @click="handleImportToml"
        :title="t('newEdit.importToml')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        {{ t('newEdit.importToml') }}
      </LtButton>
    </div>

    <!-- 双模式切换：代码直编 / 表单结构化（切表单自动重解析；切代码先回写表单改动） -->
    <div class="ed-tabs">
      <div class="ed-tabs-track" role="tablist" :aria-label="t('newEdit.editModeLabel')">
        <button
          id="ed-tab-code"
          ref="codeTabRef"
          type="button"
          class="ed-tab"
          role="tab"
          aria-controls="ed-panel-code"
          :aria-selected="editMode === 'code'"
          :tabindex="editMode === 'code' ? 0 : -1"
          :class="{ active: editMode === 'code' }"
          @click="switchToCode"
          @keydown="handleEditTabKeydown"
          >{{ t('newEdit.codeEdit') }}</button
        >
        <button
          id="ed-tab-form"
          ref="formTabRef"
          type="button"
          class="ed-tab"
          role="tab"
          aria-controls="ed-panel-form"
          :aria-selected="editMode === 'form'"
          :tabindex="editMode === 'form' ? 0 : -1"
          :class="{ active: editMode === 'form' }"
          @click="switchToForm"
          @keydown="handleEditTabKeydown"
          >{{ t('newEdit.formEdit') }}</button
        >
      </div>
      <span v-if="store.detectedCoreVersion" class="ed-core-target">{{
        t('newEdit.adaptedTo', { version: store.detectedCoreVersion })
      }}</span>
    </div>

    <!-- 版本兼容提示：新建时错误会阻断启动，存量配置仅提示不丢字段 -->
    <div
      v-if="compatIssues.length"
      class="ed-compat-banner"
      :class="hasCompatError ? 'is-error' : 'is-warning'"
    >
      <div class="ed-compat-title">
        {{ hasCompatError ? t('coreCompat.bannerError') : t('coreCompat.bannerWarning') }}
      </div>
      <ul class="ed-compat-list">
        <li v-for="(issue, i) in compatIssues" :key="i">
          {{ t('coreCompat.' + issue.code, issue.params || {}) }}
        </li>
      </ul>
    </div>

    <div class="ed-body" :class="{ 'ed-body-full': inline }">
      <!-- 语法/保存错误条：代码模式实时校验，保存前同步复核；写盘/导入失败在此可见 -->
      <div v-if="codeIssue || saveError" class="ed-code-error" role="alert">{{
        codeIssue || saveError
      }}</div>
      <!-- 代码模式 -->
      <div
        v-show="editMode === 'code'"
        id="ed-panel-code"
        class="ed-code-wrap"
        role="tabpanel"
        aria-labelledby="ed-tab-code"
      >
        <TomlEditor v-model="editorTomlContent" />
      </div>

      <!-- 表单模式 -->
      <div
        v-show="editMode === 'form'"
        id="ed-panel-form"
        class="ed-form-scroll"
        role="tabpanel"
        aria-labelledby="ed-tab-form"
      >
        <BasicForm />
        <AdvancedForm />
      </div>
    </div>

    <template #footer>
      <div class="ed-footer">
        <span class="ed-footer-info">{{
          editorDialogMode === 'add' ? t('newEdit.addFooter') : t('newEdit.editFooter')
        }}</span>
        <div class="ed-footer-btns">
          <LtButton variant="ghost" size="md" @click="requestCloseFromButton">{{
            t('newCommon.cancel')
          }}</LtButton>
          <LtButton
            variant="primary"
            size="md"
            :disabled="saving || (editMode === 'code' && !!codeIssue)"
            :title="editMode === 'code' && codeIssue ? t('newEdit.codeInvalidSave') : undefined"
            @click="handleSave"
            >{{
              saving
                ? t('newCommon.saving')
                : editorDialogMode === 'add'
                  ? t('newEdit.create')
                  : t('newEdit.save')
            }}</LtButton
          >
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 放弃未保存修改的二次确认（Esc/遮罩/关闭按钮/取消按钮/Android 返回键共用） -->
  <CreamDialog
    v-model="discardVisible"
    :title="t('newCommon.discardTitle')"
    width="380px"
    :history-close="!discardFromRoute"
  >
    <p class="ed-discard-msg">{{ t('newCommon.discardMsg') }}</p>
    <template #footer>
      <LtButton variant="ghost" size="md" @click="resolveDiscard(false)">{{
        t('newCommon.cancel')
      }}</LtButton>
      <LtButton variant="danger" size="md" @click="resolveDiscard(true)">{{
        t('newCommon.discardConfirm')
      }}</LtButton>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * EditDialog — 配置编辑弹窗外壳（新增 / 编辑双模式，桌面端使用；Android 走 config-edit-view 页面）
 *
 * 状态与保存管线在 useConfigEditor，表单区块拆为 BasicForm / AdvancedForm（通过
 * CONFIG_EDITOR_KEY 注入），代码区为 TomlEditor。本文件只保留弹窗骨架、模板下拉与
 * 代码/表单 tab 的焦点交互。
 */
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import { LtButton, LtInput } from '@/shared/ui'
import { CONFIG_TEMPLATES } from '@/entities/config/defaultData'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useConfigEditor, type TemplateId } from '@/features/configs/composables/useConfigEditor'
import { CONFIG_EDITOR_KEY } from './edit/context'
import TomlEditor from './edit/TomlEditor.vue'
import BasicForm from './edit/BasicForm.vue'
import AdvancedForm from './edit/AdvancedForm.vue'

const { t } = useI18n()
const store = useEasyTierStore()

// configName / tomlContent 由父组件传入；existingConfigNames 用于新增时的重名校验
const props = defineProps<{
  modelValue: boolean
  configName: string
  tomlContent: string
  dialogMode?: 'add' | 'edit'
  existingConfigNames?: string[]
  // 内联模式：透传 CreamDialog，作为页面级卡片渲染（移动端二级页面用）
  inline?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  // done 由父组件在写盘结束后回调：true 关闭弹窗，false 保留内容与弹窗
  saved: [name: string, content: string, done: (ok: boolean) => void]
}>()

const dialogRef = ref<InstanceType<typeof CreamDialog> | null>(null)

const visible = ref(props.modelValue)

const editor = useConfigEditor({
  props,
  emitSaved: (name, content, done) => emit('saved', name, content, done),
  visible
})
provide(CONFIG_EDITOR_KEY, editor)

const {
  dialogMode: editorDialogMode,
  fieldId,
  newConfigName,
  nameError,
  editMode,
  saving,
  codeIssue,
  saveError,
  tomlContent: editorTomlContent,
  compatIssues,
  hasCompatError,
  discardVisible,
  discardFromRoute,
  resolveDiscard,
  confirmDiscard,
  handleSave,
  handleImportToml,
  switchToCode,
  switchToForm,
  applyTemplate,
  resetOnOpen,
  dirty
} = editor

// 弹窗打开时重置内部状态（配置名 / 校验错误 / 模板选择 / 脏检查基线）
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
    if (v) {
      templateId.value = 'custom'
      templateDropdownOpen.value = false
      resetOnOpen()
    }
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
  if (!v) closeTemplateDropdown()
})

const codeTabRef = ref<HTMLButtonElement | null>(null)
const formTabRef = ref<HTMLButtonElement | null>(null)

// 编辑模式 tab 键盘操作：左右方向键切换，Home/End 定位首尾
const handleEditTabKeydown = (e: KeyboardEvent) => {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  if (e.key === 'ArrowLeft' || e.key === 'Home') switchToCode()
  else switchToForm()
  nextTick(() => {
    ;(editMode.value === 'code' ? codeTabRef.value : formTabRef.value)?.focus()
  })
}

// === 配置模板（5.8） ===
const templateId = ref<TemplateId>('custom')
const currentTemplate = computed(
  () => CONFIG_TEMPLATES.find((tpl) => tpl.id === templateId.value) ?? CONFIG_TEMPLATES[0]
)

const templateTriggerRef = ref<HTMLButtonElement | null>(null)
const templateMenuRef = ref<HTMLElement | null>(null)
const templateDropdownOpen = ref(false)
const templateHighlighted = ref(0)
const templateMenuStyle = ref<Record<string, string>>({})

// 弹层 Teleport 到 body，用 fixed 坐标贴合触发器；空间不足时向上展开
const positionTemplateMenu = () => {
  const trigger = templateTriggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const menuHeight = templateMenuRef.value?.offsetHeight || CONFIG_TEMPLATES.length * 54 + 8
  // WebView 在极端情况下可能报告 0 视口，回退到触发器尺寸避免负数宽度
  const viewportWidth = window.innerWidth || rect.width + 16
  const viewportHeight = window.innerHeight || rect.bottom + menuHeight + 8
  const openUp = viewportHeight - rect.bottom < menuHeight + 8 && rect.top > menuHeight + 8
  const width = Math.min(Math.max(rect.width, 260), viewportWidth - 16)
  templateMenuStyle.value = {
    left: `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`,
    width: `${width}px`,
    ...(openUp ? { bottom: `${viewportHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` })
  }
}

const focusTemplateOption = (idx: number) => {
  const options = templateMenuRef.value?.querySelectorAll<HTMLElement>('[role="option"]')
  if (!options?.length) return
  const next = ((idx % options.length) + options.length) % options.length
  templateHighlighted.value = next
  options[next].focus()
}

const openTemplateDropdown = async (direction = 0) => {
  templateDropdownOpen.value = true
  const selectedIdx = Math.max(
    0,
    CONFIG_TEMPLATES.findIndex((tpl) => tpl.id === templateId.value)
  )
  templateHighlighted.value =
    direction === 0
      ? selectedIdx
      : (selectedIdx + direction + CONFIG_TEMPLATES.length) % CONFIG_TEMPLATES.length
  await nextTick()
  positionTemplateMenu()
  focusTemplateOption(templateHighlighted.value)
}

const closeTemplateDropdown = (restoreFocus = false) => {
  if (!templateDropdownOpen.value) return
  templateDropdownOpen.value = false
  if (restoreFocus) nextTick(() => templateTriggerRef.value?.focus())
}

const toggleTemplateDropdown = () => {
  if (templateDropdownOpen.value) closeTemplateDropdown()
  else void openTemplateDropdown()
}

const handleTemplateOutsideClick = (e: MouseEvent) => {
  if (!templateDropdownOpen.value) return
  const target = e.target as Node
  if (templateTriggerRef.value?.contains(target) || templateMenuRef.value?.contains(target)) return
  closeTemplateDropdown()
}

// 内容区滚动或窗口尺寸变化时关闭，避免弹层与触发器分离
const handleTemplateViewportChange = () => closeTemplateDropdown()

onMounted(() => {
  document.addEventListener('click', handleTemplateOutsideClick)
  window.addEventListener('resize', handleTemplateViewportChange)
  window.addEventListener('scroll', handleTemplateViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleTemplateOutsideClick)
  window.removeEventListener('resize', handleTemplateViewportChange)
  window.removeEventListener('scroll', handleTemplateViewportChange, true)
})

const selectTemplate = (id: TemplateId) => {
  applyTemplate(id)
  closeTemplateDropdown(true)
}

const requestCloseFromButton = () => {
  void dialogRef.value?.requestClose()
}
const handleBeforeClose = async (): Promise<boolean> => {
  // 写盘期间不允许关闭，避免内容与结果状态错位
  if (saving.value) return false
  return confirmDiscard()
}

defineExpose({
  isDirty: () => dirty.value,
  confirmDiscard,
  // 路由守卫入口：确认面板不注入 history 条目（见 CreamDialog historyClose）
  confirmDiscardOnLeave: () => confirmDiscard(true),
  requestClose: () => dialogRef.value?.requestClose()
})
</script>

<style scoped>
.ed-name-bar {
  display: flex;
  padding: 12px 16px;
  margin-bottom: 14px;
  background: var(--theme-bg-tag, rgb(232 160 160 / 4%));
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  align-items: center;
  gap: 10px;
}

.ed-name-input {
  flex: 1;
}

.ed-name-error {
  font-size: 12px;
  color: var(--theme-accent-primary, #e8a0a0);
  white-space: nowrap;
}

/* 名称栏标签：表单区块的通用标签样式在 edit/form.less，此处仅名称栏自身需要 */
.ed-form-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
  text-transform: uppercase;
}

/* 模板下拉：触发器沿用胶囊边框，菜单 Teleport 到 body 避免被弹窗裁剪 */
.ed-template-select {
  position: relative;
  flex-shrink: 0;
}

.ed-template-trigger {
  display: flex;
  height: 29px;
  padding: 0 10px 0 12px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration) var(--theme-ease-out);
  align-items: center;
  gap: 6px;
}

.ed-template-trigger:focus-visible,
.ed-template-trigger[aria-expanded='true'] {
  color: var(--theme-text-primary, #4a3728);
  border-color: var(--theme-accent-primary, #e8a0a0);
  outline: none;
}

/* 触屏点按会残留 :hover，悬停反馈只在支持悬停的设备上生效 */
@media (hover: hover) {
  .ed-template-trigger:hover {
    color: var(--theme-text-primary, #4a3728);
    border-color: var(--theme-accent-primary, #e8a0a0);
  }
}

.ed-template-caret {
  color: var(--theme-text-muted, #c8bdb2);
  transition: transform var(--theme-duration-fast) var(--theme-ease-out);
  flex-shrink: 0;
}

.ed-template-trigger[aria-expanded='true'] .ed-template-caret {
  transform: rotate(180deg);
}

.ed-template-menu {
  position: fixed;
  z-index: 2100;
  display: flex;
  max-height: 300px;
  padding: 4px;
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
  box-shadow: var(--theme-shadow-md);
  box-sizing: border-box;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.ed-template-option {
  display: flex;
  width: 100%;
  padding: 8px 10px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm, 6px);
  transition: background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: 8px;
}

.ed-template-option:focus-visible {
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  outline: none;
}

@media (hover: hover) {
  .ed-template-option:hover {
    background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  }
}

.ed-template-option.active {
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.ed-template-option-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.ed-template-option-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.ed-template-option.active .ed-template-option-label {
  color: var(--theme-accent-primary, #e8a0a0);
}

.ed-template-option-desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: normal;
}

.ed-template-check {
  color: var(--theme-accent-primary, #e8a0a0);
  flex-shrink: 0;
}

.ed-template-drop-enter-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-out),
    transform var(--theme-duration-fast) var(--theme-ease-out);
}

.ed-template-drop-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.ed-template-drop-enter-from,
.ed-template-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.ed-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.ed-tabs-track {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ed-core-target {
  padding: 3px 10px;
  margin-left: auto;
  font-family: var(--theme-font-body, 'Sora', monospace);
  font-size: 11px;
  color: var(--theme-text-muted, #c8bdb2);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-pill, 100px);
}

/* 版本兼容提示：error 阻断启动，warning 仅提示字段会被忽略 */
.ed-compat-banner {
  padding: 10px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid transparent;
  border-radius: var(--theme-radius-md, 10px);
}

.ed-compat-banner.is-error {
  color: var(--theme-accent-primary, #b4544f);
  background: color-mix(in srgb, var(--theme-accent-primary, #b4544f) 8%, transparent);
  border-color: color-mix(in srgb, var(--theme-accent-primary, #b4544f) 25%, transparent);
}

.ed-compat-banner.is-warning {
  color: var(--theme-text-secondary, #8b7355);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 8%, transparent);
  border-color: color-mix(in srgb, var(--theme-color-warning, #d9a441) 22%, transparent);
}

.ed-compat-title {
  margin-bottom: 4px;
  font-weight: 600;
}

.ed-compat-list {
  padding-left: 18px;
  margin: 0;
}

.ed-tab {
  padding: 6px 18px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1.5px solid transparent;
  border-radius: var(--theme-radius-pill, 100px);
  transition: var(--theme-transition-interactive);
}

.ed-tab.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-card, #fff);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

/* 触屏点按会残留 :hover，悬停反馈只在支持悬停的设备上生效 */
@media (hover: hover) {
  .ed-tab:hover {
    color: var(--theme-text-primary, #4a3728);
  }
}

.ed-body {
  min-height: 350px;
}

/* inline 全屏页面：编辑区占满剩余高度，底部操作栏由 CreamDialog 固定 */
.ed-body-full {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.ed-body-full .ed-code-wrap {
  height: auto;
  min-height: 0;
  flex: 1;
}

.ed-body-full .ed-form-scroll {
  max-height: none;
  min-height: 0;
  flex: 1;
}

.ed-code-error {
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-tag, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-accent-primary, #e8a0a0);
  border-radius: var(--theme-radius-sm, 10px);
}

.ed-discard-msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #7a6e5e);
}

.ed-code-wrap {
  height: 400px;
  overflow: hidden;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
}

.ed-form-scroll {
  max-height: 400px;
  padding-right: 4px;
  overflow-y: auto;
}

.ed-form-scroll::-webkit-scrollbar {
  width: 4px;
}

.ed-form-scroll::-webkit-scrollbar-thumb {
  background: var(--theme-color-scrollbar, #e8d5c4);
  border-radius: 4px;
}

.ed-form-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.ed-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.ed-footer-info {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.ed-footer-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 移动端窄屏：名称栏换行、编辑区降矮、底部按钮可换行 */
@media (width <= 640px) {
  .ed-name-bar {
    flex-wrap: wrap;
  }

  .ed-name-input {
    flex: 1 1 100%;
  }

  .ed-body {
    min-height: 0;
  }

  .ed-code-wrap {
    height: 280px;
  }

  .ed-form-scroll {
    max-height: 320px;
  }

  .ed-footer {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
