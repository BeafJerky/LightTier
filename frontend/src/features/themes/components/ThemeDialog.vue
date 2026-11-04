<template>
  <CreamDialog v-model="visible" :title="t('newLayout.theme')" width="700px" :inline="inline">
    <div class="td-body">
      <!-- 左侧：主题列表 -->
      <div class="td-sidebar">
        <div class="td-sidebar-header">
          <span class="td-sidebar-title">{{ t('newTheme.installed') }}</span>
          <LtButton variant="ghost" size="sm" class="td-refresh-btn" @click="refreshList">{{
            t('newTheme.refreshList')
          }}</LtButton>
        </div>
        <div class="td-tools">
          <LtButton
            variant="ghost"
            size="sm"
            class="td-tool-btn"
            :loading="importing"
            @click="handleImportClick"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 20h16" />
            </svg>
            {{ t('newTheme.importTheme') }}
          </LtButton>
          <LtButton variant="ghost" size="sm" class="td-tool-btn" @click="handleDownloadGuide">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 4v12M7 11l5 5 5-5" />
              <path d="M4 20h16" />
            </svg>
            {{ t('newTheme.downloadGuide') }}
          </LtButton>
        </div>
        <input
          ref="fileInputRef"
          class="lt-sr-only"
          type="file"
          accept=".css,text/css,text/plain"
          tabindex="-1"
          aria-hidden="true"
          @change="onThemeFilePicked"
        />
        <div class="td-list" role="radiogroup" :aria-label="t('newLayout.theme')">
          <label
            v-for="th in themes"
            :key="th.name"
            class="td-item"
            :class="{ active: previewName === th.name }"
          >
            <input
              class="lt-sr-only"
              type="radio"
              name="lt-theme"
              :value="th.name"
              :checked="previewName === th.name"
              @change="selectTheme(th.name)"
            />
            <span class="td-item-dot" :style="{ background: th.color }"></span>
            <span class="td-item-label">{{ th.label }}</span>
            <span v-if="th.name === defaultThemeName" class="td-item-badge">{{
              t('newTheme.default')
            }}</span>
            <svg
              v-if="previewName === th.name"
              class="td-item-check"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </label>
        </div>
        <LtButton
          v-if="inline"
          variant="text"
          size="sm"
          class="td-inline-reset"
          @click="handleReset"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {{ t('newTheme.resetDefault') }}
        </LtButton>
      </div>

      <!-- 右侧：预览区 -->
      <div class="td-preview-block">
        <div v-if="inline" class="td-preview-label">{{ t('newTheme.previewLabel') }}</div>
        <div class="td-preview-wrap">
          <div ref="previewRef" class="td-preview"></div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="td-footer" :class="{ 'td-footer-inline': inline }">
        <LtButton v-if="!inline" variant="ghost" size="md" @click="handleReset">{{
          t('newTheme.resetDefault')
        }}</LtButton>
        <div class="td-footer-actions">
          <template v-if="inline">
            <LtButton variant="ghost" size="lg" class="td-btn" @click="visible = false">{{
              t('newCommon.cancel')
            }}</LtButton>
            <LtButton variant="primary" size="lg" class="td-btn" @click="handleApply">{{
              t('newTheme.applyTheme')
            }}</LtButton>
          </template>
          <template v-else>
            <LtButton variant="ghost" size="md" @click="visible = false">{{
              t('newCommon.cancel')
            }}</LtButton>
            <LtButton variant="primary" size="md" @click="handleApply">{{
              t('newTheme.applyTheme')
            }}</LtButton>
          </template>
        </div>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * ThemeDialog — 主题设置弹窗（左侧主题列表 + 右侧 Shadow DOM 实时预览）
 *
 * 主题来源：内置 cream / dark + useExternalThemes 发现的外部主题；
 * 预览区通过 attachShadow 样式隔离：内置主题在预览内显式声明 CSS 变量
 * （不依赖全局 :root，避免全局已切暗色时奶油预览不生效），外部主题把 :root
 * 改写为 :host 后注入；点击“应用主题”经 useThemeLoader 应用并持久化。
 */
import { ref, watch, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { systemDefaultTheme, useThemeLoader } from '@/shared/composables/useThemeLoader'
import {
  downloadThemeGuide,
  importThemeFile,
  useExternalThemes
} from '@/shared/composables/useExternalThemes'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { isAndroid } from '@/shared/platform/platformUtil'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import { LtButton } from '@/shared/ui'
import {
  buildPreviewHTML,
  getBuiltinPreviewStyle,
  getExternalPreviewStyle
} from '@/features/themes/lib/themePreview'

const props = withDefaults(defineProps<{ modelValue: boolean; inline?: boolean }>(), {
  inline: false
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t, locale } = useI18n()

// 内部可见态：与父组件 v-model 双向同步
const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
})

const { applyTheme, resetTheme, currentTheme } = useThemeLoader()
const { externalThemes, discoverThemes } = useExternalThemes()

// 「默认」徽标指向系统偏好推导出的默认主题（用户显式选择不影响它）
const defaultThemeName = systemDefaultTheme()

const previewRef = ref<HTMLElement>()
// 当前预览（选中）的主题名，应用时以它为准；初值为当前生效主题
const previewName = ref(currentTheme.value)
// 已点“恢复默认”：应用时清空显式选择并回到系统默认，而不是写入某个具体主题名
const pendingReset = ref(false)
let shadowRoot: ShadowRoot | null = null

interface ThemeInfo {
  name: string
  label: string
  color: string
}

const themes = ref<ThemeInfo[]>([])

onMounted(() => refreshList())

// 刷新主题列表：内置 cream / dark 两项 + 外部主题
const refreshList = async () => {
  const base: ThemeInfo[] = [
    { name: 'cream', label: t('newTheme.cream'), color: '#fdf8f4' },
    { name: 'dark', label: t('newTheme.dark'), color: '#0d1b2a' }
  ]
  const external = await discoverThemes()
  themes.value = [
    ...base,
    ...external.map((t) => ({ name: t.name, label: t.label, color: t.color }))
  ]
}

const toast = useCreamToast()
const fileInputRef = ref<HTMLInputElement>()
const importing = ref(false)

// 桌面端走原生文件对话框；Android 与浏览器预览走 file input
const isDesktopRuntime = (): boolean => {
  try {
    return isTauri() && !isAndroid()
  } catch {
    return false
  }
}

// 校验并保存主题，成功后刷新列表并直接预览新主题
const importTheme = async (fileName: string, cssText: string) => {
  importing.value = true
  try {
    const result = await importThemeFile(fileName, cssText)
    if (!result.ok) {
      const reasonText = {
        'invalid-name': t('newTheme.importInvalidName'),
        'reserved-name': t('newTheme.importReservedName'),
        'invalid-css': t('newTheme.importInvalidCss'),
        'write-failed': t('newTheme.importFailed')
      }[result.reason]
      toast.error(reasonText)
      return
    }
    await refreshList()
    previewName.value = result.theme.name
    nextTick(() => renderPreview(result.theme.name))
    toast.success(t('newTheme.importSuccess', { name: result.theme.label }))
  } finally {
    importing.value = false
  }
}

const handleImportClick = async () => {
  if (importing.value) return
  if (!isDesktopRuntime()) {
    fileInputRef.value?.click()
    return
  }
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Theme CSS', extensions: ['css'] }]
    })
    if (!selected) return
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return
    const fileName = path.split(/[\\/]/).pop() || path
    await importTheme(fileName, await readTextFile(path))
  } catch (error) {
    console.error('读取主题文件失败:', error)
    toast.error(t('newTheme.importFailed'))
  }
}

const onThemeFilePicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    await importTheme(file.name, await file.text())
  } catch (error) {
    console.error('读取主题文件失败:', error)
    toast.error(t('newTheme.importFailed'))
  }
}

const handleDownloadGuide = async () => {
  const result = await downloadThemeGuide()
  if (result === 'saved') toast.success(t('newTheme.guideSaved'))
  else if (result === 'failed') toast.error(t('newTheme.guideFailed'))
}

// 选中主题并在右侧预览
const selectTheme = (name: string) => {
  pendingReset.value = false
  previewName.value = name
  nextTick(() => renderPreview(name))
}

// 渲染指定主题的预览（内置主题注入变量定义，外部主题注入其 CSS 文本）
const renderPreview = (name: string) => {
  const el = previewRef.value
  if (!el) return

  shadowRoot = el.shadowRoot || el.attachShadow({ mode: 'open' })

  // 首次调用：创建容器和 style 元素（后续调用只更新容器内容，保留 style 元素）
  if (!shadowRoot.querySelector('.pv-container')) {
    const container = document.createElement('div')
    container.className = 'pv-container'
    container.style.height = '100%'
    shadowRoot.appendChild(container)

    const styleEl = document.createElement('style')
    styleEl.className = 'theme-style'
    shadowRoot.appendChild(styleEl)
  }

  // 只更新容器内的 HTML，不触碰 style 元素
  const container = shadowRoot.querySelector('.pv-container') as HTMLElement
  container.innerHTML = buildPreviewHTML(props.inline, t)

  const styleEl = shadowRoot.querySelector('style.theme-style') as HTMLStyleElement

  // 内置主题注入变量定义；外部主题注入其 CSS 文本（缺省变量在前，主题自身定义覆盖）
  const builtinStyle = getBuiltinPreviewStyle(name)
  if (builtinStyle) {
    styleEl.textContent = builtinStyle
  } else {
    const ext = externalThemes.value.find((t) => t.name === name)
    if (ext) styleEl.textContent = getExternalPreviewStyle(ext.cssText)
  }
}

// 应用当前预览主题（外部主题需同步传入其 CSS 文本）并关闭弹窗
const handleApply = () => {
  // “恢复默认”只在点“应用”时真正落盘，取消/关闭弹窗不改变当前主题
  if (pendingReset.value) {
    resetTheme()
    visible.value = false
    return
  }
  const ext = externalThemes.value.find((t) => t.name === previewName.value)
  applyTheme(previewName.value, ext?.cssText)
  visible.value = false
}

// 恢复默认仅切换预览（跟随系统深色偏好），持久化推迟到“应用主题”
const handleReset = () => {
  pendingReset.value = true
  const fallback = systemDefaultTheme()
  previewName.value = fallback
  nextTick(() => renderPreview(fallback))
}

// 弹窗打开时加载预览
watch(visible, (v) => {
  if (v) {
    pendingReset.value = false
    previewName.value = currentTheme.value
    nextTick(() => renderPreview(previewName.value))
  }
})

// 语言切换后重建预览文案
watch(locale, () => {
  if (visible.value) nextTick(() => renderPreview(previewName.value))
})
</script>

<style scoped>
.td-body {
  display: flex;
  gap: var(--theme-space-4);
  min-height: 320px;
}

.td-sidebar {
  display: flex;
  width: 180px;
  flex-shrink: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.td-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.td-sidebar-title {
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-primary, #4a3728);
}

.td-refresh-btn {
  margin-left: auto;
}

.td-list {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-1);
}

/* 导入 / 指南入口：桌面侧栏为竖向工具组，Android 页由 theme-view 覆盖为分组卡片 */
.td-tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.td-tool-btn {
  width: 100%;
  font-size: 12px;
  justify-content: flex-start;
}

.td-tool-btn svg {
  width: 14px;
  height: 14px;
  color: var(--theme-accent-primary, #e8a0a0);
  flex-shrink: 0;
}

.td-item {
  position: relative;
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
  cursor: pointer;
  border-radius: 10px;
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: var(--theme-space-2);
}

.td-item:hover {
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.td-item.active {
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

/* 原生 radio 键盘聚焦时给圆点画焦点环（不使用 :has，兼容旧 WebView） */
.td-item input:focus-visible + .td-item-dot {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 3px;
}

.td-item-dot {
  width: 10px;
  height: 10px;
  border: 1px solid rgb(0 0 0 / 6%);
  border-radius: 50%;
  flex-shrink: 0;
}

.td-item-label {
  font-family: var(--theme-font-body, 'Sora', sans-serif);
}

.td-item-badge {
  padding: 1px var(--theme-space-2);
  margin-left: auto;
  font-size: 11px;
  color: var(--theme-text-secondary, #7a6e5e);
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: 4px;
}

.td-item-check {
  margin-left: auto;
  color: var(--theme-accent-primary, #e8a0a0);
  flex-shrink: 0;
}

/* 内联移动页专用：恢复默认与底部原生按钮（桌面弹窗仍使用 Naive UI） */
.td-inline-reset {
  display: none;
}

.td-btn {
  height: 44px;
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: 600;
}

.td-preview-block {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.td-preview-label {
  display: none;
}

.td-preview-wrap {
  overflow: hidden;
  background: var(--theme-bg, #fdf8f4);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: 14px;
  flex: 1;
}

.td-preview {
  height: 100%;
  min-height: 280px;
}

.td-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.td-footer-actions {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

/* 桌面端：主题列表独立滚动，标题/预览/底部按钮保持固定，避免长列表把整个弹窗撑出滚动 */
@media (width >= 641px) {
  .td-body {
    height: 100%;
  }

  .td-sidebar {
    min-height: 0;
  }

  .td-list {
    min-height: 0;
    padding: var(--theme-space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--theme-bg, #fdf8f4);
    border: 1px solid var(--theme-border, #ede4db);
    border-radius: var(--theme-radius-md, 12px);
    flex: 1;
    scrollbar-width: thin;
  }

  .td-list::-webkit-scrollbar {
    width: 4px;
  }

  .td-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .td-list::-webkit-scrollbar-thumb {
    background: var(--theme-border, #ede4db);
    border-radius: 10px;
  }
}

/* 移动端（含 Android 二级页面）：上下堆叠，主题列表转横向滚动，预览保留合理高度 */
@media (width <= 640px) {
  .td-body {
    flex: 1;
    flex-direction: column;
    gap: var(--theme-space-3);
  }

  .td-sidebar {
    width: 100%;
    gap: var(--theme-space-2);
  }

  .td-list {
    padding-bottom: 2px;
    overflow-x: auto;
    flex-direction: row;
    gap: var(--theme-space-2);
    scrollbar-width: none;
  }

  .td-list::-webkit-scrollbar {
    display: none;
  }

  .td-item {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .td-preview {
    min-height: 240px;
  }

  .td-footer {
    flex-wrap: wrap;
    gap: var(--theme-space-2);
  }
}
</style>
