<template>
  <CreamDialog v-model="visible" :title="t('newLayout.theme')" width="700px">
    <div class="td-body">
      <!-- 左侧：主题列表 -->
      <div class="td-sidebar">
        <div class="td-sidebar-header">
          <span class="td-sidebar-title">{{ t('newTheme.installed') }}</span>
          <button type="button" class="td-refresh-btn" @click="refreshList">{{
            t('newTheme.refreshList')
          }}</button>
        </div>
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
          </label>
        </div>
      </div>

      <!-- 右侧：预览区 -->
      <div class="td-preview-wrap">
        <div ref="previewRef" class="td-preview"></div>
      </div>
    </div>

    <template #footer>
      <div class="td-footer">
        <n-button @click="handleReset">{{ t('newTheme.resetDefault') }}</n-button>
        <div class="td-footer-actions">
          <n-button @click="visible = false">{{ t('newCommon.cancel') }}</n-button>
          <n-button type="primary" @click="handleApply">{{ t('newTheme.applyTheme') }}</n-button>
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
import { NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { systemDefaultTheme, useThemeLoader } from '@/hooks/useThemeLoader'
import { useExternalThemes } from '@/hooks/useExternalThemes'
import CreamDialog from '@/components/CreamDialog/index.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()

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

// 选中主题并在右侧预览
const selectTheme = (name: string) => {
  previewName.value = name
  nextTick(() => renderPreview(name))
}

// 预览区结构与样式模板：用主题变量渲染若干典型 UI 元素以展示效果（文案随当前语言）
const buildPreviewHTML = () => `
  <div class="pv-wrap">
    <div class="pv-title">${t('newTheme.previewTitle')}</div>
    <div class="pv-sub">${t('newTheme.previewSub')}</div>
    <div class="pv-btns">
      <button class="pv-btn pv-btn-primary">${t('newCommon.run')}</button>
      <button class="pv-btn pv-btn-stop">${t('newCommon.stop')}</button>
    </div>
    <div class="pv-toasts">
      <span class="pv-toast pv-toast-succ">✅ ${t('newCommon.startSuccess')}</span>
      <span class="pv-toast pv-toast-err">❌ ${t('newCommon.startFail')}</span>
    </div>
    <div class="pv-card">
      <div class="pv-card-title">${t('newTheme.previewCard')}</div>
      <div class="pv-card-text">global-mesh · 10.144.0.1/24</div>
      <span class="pv-badge">● ${t('newCommon.running')}</span>
    </div>
  </div>
`

const previewStyle = `
  .pv-wrap { padding: 20px; font-family: var(--theme-font-body, 'Sora', sans-serif); border-radius: 18px; background: var(--theme-bg, #fdf8f4); color: var(--theme-text-primary, #4a3728); height: 100%; }
  .pv-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 18px; font-weight: 600; margin: 0 0 4px; color: var(--theme-text-primary, #4a3728); }
  .pv-sub { font-size: 13px; color: var(--theme-text-muted, #c8bdb2); margin-bottom: 16px; margin-top: 0; }
  .pv-btns { display: flex; gap: 8px; margin-bottom: 12px; }
  .pv-btn { padding: 6px 20px; border-radius: 100px; border: none; cursor: pointer; font-family: var(--theme-font-body, 'Sora', sans-serif); font-size: 12px; font-weight: 500; }
  .pv-btn-primary { background: linear-gradient(135deg, var(--theme-color-success, #7fba8a), var(--theme-color-success-dark, #6aaa78)); color: var(--theme-text-white, #fff); }
  .pv-btn-stop { background: var(--theme-bg-hover, rgba(232,160,160,0.06)); color: var(--theme-accent-primary, #e8a0a0); }
  .pv-toasts { display: flex; gap: 8px; margin-bottom: 12px; }
  .pv-toast { padding: 6px 16px; border-radius: 100px; font-size: 12px; background: var(--theme-bg-card, #fff); }
  .pv-toast-succ { border: 1.5px solid var(--theme-color-success, #7fba8a); color: var(--theme-text-primary, #4a3728); }
  .pv-toast-err { border: 1.5px solid var(--theme-accent-primary, #e8a0a0); color: var(--theme-text-primary, #4a3728); }
  .pv-card { background: var(--theme-bg-card, #fff); border-radius: 18px; padding: 14px; border: 1.5px solid var(--theme-border, #ede4db); }
  .pv-card-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 14px; font-weight: 600; color: var(--theme-text-primary, #4a3728); margin-bottom: 2px; }
  .pv-card-text { font-size: 12px; color: var(--theme-text-muted, #c8bdb2); margin-bottom: 8px; }
  .pv-badge { display: inline-block; padding: 2px 12px; border-radius: 100px; font-size: 10px; background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 8%, transparent); color: var(--theme-color-success, #7fba8a); border: 1px solid color-mix(in srgb, var(--theme-color-success, #7fba8a) 18%, transparent); }
`

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
  container.innerHTML = buildPreviewHTML()

  const styleEl = shadowRoot.querySelector('style.theme-style') as HTMLStyleElement

  if (name === 'cream') {
    // 奶油主题：显式设置变量（不依赖全局 :root，避免全局暗色时预览不变化）
    styleEl.textContent = `
      :host { display: block; height: 100%;
        --theme-bg: #fdf8f4; --theme-bg-card: #ffffff; --theme-bg-hover: rgba(232,160,160,0.06);
        --theme-text-primary: #4a3728; --theme-text-muted: #c8bdb2;
        --theme-accent-primary: #e8a0a0; --theme-color-success: #7fba8a; --theme-color-success-dark: #6aaa78;
        --theme-border: #ede4db; --theme-text-white: #fff;
        --theme-bg-tag: #f5ede6; --theme-text-secondary: #7a6e5e;
        --theme-font-body: 'Sora', sans-serif; --theme-font-display: 'Quicksand', sans-serif;
      }
      ${previewStyle}`
  } else if (name === 'dark') {
    // 暗色主题：覆盖变量
    styleEl.textContent = `
      :host { display: block; height: 100%; --theme-bg: #0d1b2a; --theme-bg-card: #1b2838; --theme-bg-hover: rgba(100,180,255,0.08); --theme-text-primary: #e0e8f0; --theme-text-muted: #5a6b80; --theme-accent-primary: #6ba8e0; --theme-color-success: #5ab08a; --theme-color-success-dark: #4a9a78; --theme-border: #1e3040; --theme-text-white: #fff; }
      ${previewStyle}`
  } else {
    // 外部主题：读取 CSS 并注入 Shadow DOM
    const ext = externalThemes.value.find((t) => t.name === name)
    if (ext) {
      const hostCss = ext.cssText.replace(/:root/g, ':host')
      styleEl.textContent = `:host { display: block; height: 100%; }\n${hostCss}\n${previewStyle}`
    }
  }
}

// 应用当前预览主题（外部主题需同步传入其 CSS 文本）并关闭弹窗
const handleApply = () => {
  const ext = externalThemes.value.find((t) => t.name === previewName.value)
  applyTheme(previewName.value, ext?.cssText)
  visible.value = false
}

// 重置回默认主题（跟随系统深色偏好）并同步预览
const handleReset = () => {
  const fallback = resetTheme()
  previewName.value = fallback
  nextTick(() => renderPreview(fallback))
}

// 弹窗打开时加载预览
watch(visible, (v) => {
  if (v) {
    previewName.value = currentTheme.value
    nextTick(() => renderPreview(previewName.value))
  }
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
  padding: var(--theme-space-2) var(--theme-space-4);
  margin-left: auto;
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  transition: var(--theme-transition-interactive);
}

.td-refresh-btn:hover {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border-color: var(--theme-accent-primary);
}

.td-refresh-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.td-list {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-1);
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
  color: var(--theme-text-muted, #c8bdb2);
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: 4px;
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
