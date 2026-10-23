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
import { systemDefaultTheme, useThemeLoader } from '@/hooks/useThemeLoader'
import { downloadThemeGuide, importThemeFile, useExternalThemes } from '@/hooks/useExternalThemes'
import { useCreamToast } from '@/hooks/useCreamToast'
import { isAndroid } from '@/utils/platformUtil'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { LtButton } from '@/components/ui'

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

// 预览区结构与样式模板：桌面/移动分别用对应平台的真实界面骨架展示主题效果（文案随当前语言）
const pvIcons = {
  overview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  monitor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  config:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></svg>',
  theme:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  network:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11.1l7.6-4.1M8.2 12.9l7.6 4.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
}

const buildDesktopPreviewHTML = () => `
  <div class="pv-d" aria-hidden="true">
    <div class="pv-d-side">
      <div class="pv-d-brand">
        <span class="pv-d-logo">L</span>
        <span class="pv-d-brand-name">LightTier</span>
      </div>
      <div class="pv-d-nav">
        <div class="pv-d-nav-item active">${pvIcons.overview}<span>${t('newLayout.overview')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.monitor}<span>${t('newLayout.monitor')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.config}<span>${t('newLayout.config')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.theme}<span>${t('newLayout.theme')}</span></div>
      </div>
    </div>
    <div class="pv-d-main">
      <div class="pv-d-head">
        <div class="pv-d-heading">
          <div class="pv-d-title">${t('newLayout.overview')}</div>
          <div class="pv-d-sub">${t('newLayout.overviewSub')}</div>
        </div>
        <span class="pv-d-create">${pvIcons.plus}<span>${t('newCommon.createConfig')}</span></span>
      </div>
      <div class="pv-d-stats">
        <div class="pv-d-stat success"><b>1</b><small>${t('newCommon.running')}</small></div>
        <div class="pv-d-stat muted"><b>1</b><small>${t('newCommon.stopped')}</small></div>
        <div class="pv-d-stat accent"><b>2</b><small>${t('newOverview.totalConfig')}</small></div>
      </div>
      <div class="pv-d-sec">${t('newOverview.myConfigs')}</div>
      <div class="pv-d-grid">
        <div class="pv-d-card on">
          <div class="pv-d-card-top">
            <span class="pv-d-status"><i class="pv-d-dot on"></i>${t('newCommon.running')}</span>
            <span class="pv-d-vip">10.144.0.1/24</span>
          </div>
          <div class="pv-d-name">global-mesh</div>
          <div class="pv-d-meta">3 · ${t('newOverview.nodes')} · 18 ms</div>
          <div class="pv-d-card-actions">
            <span class="pv-d-btn stop">${t('newCommon.stop')}</span>
            <span class="pv-d-btn ghost">${t('newOverview.configDetail')}</span>
          </div>
        </div>
        <div class="pv-d-card">
          <div class="pv-d-card-top">
            <span class="pv-d-status"><i class="pv-d-dot"></i>${t('newCommon.stopped')}</span>
          </div>
          <div class="pv-d-name">office-net</div>
          <div class="pv-d-meta">10.144.1.1/24</div>
          <div class="pv-d-card-actions">
            <span class="pv-d-btn run">${t('newCommon.run')}</span>
            <span class="pv-d-btn ghost">${t('newOverview.configDetail')}</span>
          </div>
        </div>
      </div>
      <div class="pv-d-toast-row">
        <span class="pv-d-toast"><i>${pvIcons.check}</i>${t('newCommon.startSuccess')}</span>
      </div>
    </div>
  </div>
`

const buildMobilePreviewHTML = () => `
  <div class="pv-m" aria-hidden="true">
    <div class="pv-m-head">
      <div class="pv-m-title">${t('newLayout.overview')}</div>
      <div class="pv-m-sub">${t('newLayout.overviewSub')}</div>
    </div>
    <div class="pv-m-hero">
      <div class="pv-m-hero-top">
        <span class="pv-m-state"><i></i>${t('newOverview.connected')}</span>
        <span class="pv-m-ip">10.144.0.1/24</span>
      </div>
      <div class="pv-m-name">global-mesh</div>
      <div class="pv-m-metrics">
        <span class="pv-m-metric"><small>${t('newOverview.nodes')}</small><b>3</b></span>
        <span class="pv-m-metric"><small>${t('newMonitor.avgLatency')}</small><b>18 ms</b></span>
      </div>
      <div class="pv-m-actions">
        <span class="pv-m-btn stop">${pvIcons.stop}${t('newCommon.stop')}</span>
        <span class="pv-m-btn ghost">${t('newOverview.viewMonitor')}</span>
      </div>
    </div>
    <div class="pv-m-sec"><span>${t('newOverview.myConfigs')}</span><span class="pv-m-add">${pvIcons.plus}</span></div>
    <div class="pv-m-group">
      <div class="pv-m-row on">
        <span class="pv-m-tile on">${pvIcons.network}</span>
        <span class="pv-m-row-text"><b>global-mesh</b><small>10.144.0.1/24</small></span>
        <span class="pv-m-chev">${pvIcons.chevron}</span>
        <span class="pv-m-act stop">${pvIcons.stop}</span>
      </div>
      <div class="pv-m-row">
        <span class="pv-m-tile">${pvIcons.network}</span>
        <span class="pv-m-row-text"><b>office-net</b><small>${t('newOverview.disconnected')}</small></span>
        <span class="pv-m-chev">${pvIcons.chevron}</span>
        <span class="pv-m-act run">${pvIcons.play}</span>
      </div>
    </div>
  </div>
`

const buildPreviewHTML = () => (props.inline ? buildMobilePreviewHTML() : buildDesktopPreviewHTML())

const previewStyle = `
  .pv-d, .pv-m { height: 100%; overflow: hidden; font-family: var(--theme-font-body, 'Sora', sans-serif); background: var(--theme-bg, #fdf8f4); color: var(--theme-text-primary, #4a3728); box-sizing: border-box; }

  /* ===== 桌面端：迷你工作区（侧栏 + 总览） ===== */
  .pv-d { display: flex; }
  .pv-d-side { display: flex; width: 112px; padding: 12px 8px 10px; flex-shrink: 0; flex-direction: column; gap: 10px; background: var(--theme-bg-sidebar, linear-gradient(180deg, color-mix(in srgb, var(--theme-text-primary, #4a3728) 3%, var(--theme-bg, #fdf8f4)), var(--theme-bg, #fdf8f4))); border-right: 1px solid var(--theme-border, #ede4db); }
  .pv-d-brand { display: flex; padding: 0 4px; align-items: center; gap: 6px; }
  .pv-d-logo { display: flex; width: 20px; height: 20px; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 11px; font-weight: 700; color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); background: linear-gradient(135deg, var(--theme-accent-primary, #e8a0a0), color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 55%, var(--theme-accent-secondary, var(--theme-accent-primary, #e8a0a0)))); border-radius: 6px; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-d-brand-name { overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 10px; font-weight: 700; letter-spacing: -0.2px; white-space: nowrap; }
  .pv-d-nav { display: flex; flex-direction: column; gap: 2px; }
  .pv-d-nav-item { display: flex; height: 26px; padding: 0 6px; overflow: hidden; font-size: 9.5px; color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); border-radius: 7px; align-items: center; gap: 5px; }
  .pv-d-nav-item svg { width: 12px; height: 12px; opacity: 0.6; flex-shrink: 0; }
  .pv-d-nav-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-nav-item.active { color: var(--theme-text-primary, #4a3728); background: var(--theme-bg-active, color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent)); box-shadow: inset 2px 0 0 var(--theme-accent-primary, #e8a0a0); }
  .pv-d-nav-item.active svg { color: var(--theme-accent-primary, #e8a0a0); opacity: 1; }
  .pv-d-main { display: flex; min-width: 0; padding: 14px 16px 12px; flex: 1; flex-direction: column; gap: 9px; }
  .pv-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .pv-d-heading { min-width: 0; }
  .pv-d-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 16px; font-weight: 600; line-height: 1.2; }
  .pv-d-sub { margin-top: 2px; overflow: hidden; font-size: 9px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-create { display: inline-flex; height: 22px; padding: 0 9px; font-size: 9px; font-weight: 600; color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); white-space: nowrap; background: var(--theme-accent-primary, #e8a0a0); border-radius: var(--theme-radius-pill, 100px); align-items: center; gap: 3px; flex-shrink: 0; }
  .pv-d-create svg { width: 9px; height: 9px; }
  .pv-d-stats { display: flex; gap: 6px; }
  .pv-d-stat { display: flex; min-width: 0; padding: 8px 10px; flex-direction: column; gap: 1px; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); border-radius: 10px; flex: 1; }
  .pv-d-stat b { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 14px; font-weight: 600; line-height: 1.1; }
  .pv-d-stat.success b { color: var(--theme-color-success, #7fba8a); }
  .pv-d-stat.muted b { color: var(--theme-text-muted, #c8bdb2); }
  .pv-d-stat.accent b { color: var(--theme-accent-secondary, var(--theme-accent-primary, #e8a0a0)); }
  .pv-d-stat small { overflow: hidden; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-sec { padding: 0 1px; font-size: 10px; font-weight: 600; color: var(--theme-text-primary, #4a3728); }
  .pv-d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .pv-d-card { display: flex; min-width: 0; padding: 10px 11px; flex-direction: column; gap: 4px; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); border-radius: var(--theme-radius-lg, 10px); }
  .pv-d-card.on { background: linear-gradient(160deg, color-mix(in srgb, var(--theme-color-success, #7fba8a) 7%, var(--theme-bg-card, #fff)), var(--theme-bg-card, #fff)); border-color: color-mix(in srgb, var(--theme-color-success, #7fba8a) 24%, var(--theme-border, #ede4db)); }
  .pv-d-card-top { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 4px; }
  .pv-d-status { display: flex; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); align-items: center; gap: 4px; white-space: nowrap; }
  .pv-d-dot { width: 5px; height: 5px; background: var(--theme-text-muted, #c8bdb2); border-radius: 50%; flex-shrink: 0; }
  .pv-d-dot.on { background: var(--theme-color-success, #7fba8a); box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-success, #7fba8a) 15%, transparent); }
  .pv-d-vip { padding: 1px 5px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 8px; color: var(--theme-accent-primary, #e8a0a0); text-overflow: ellipsis; white-space: nowrap; background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent); border-radius: var(--theme-radius-pill, 100px); }
  .pv-d-name { overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 12px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-meta { overflow: hidden; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-card-actions { display: flex; margin-top: 2px; gap: 4px; }
  .pv-d-btn { display: inline-flex; height: 20px; padding: 0 8px; font-size: 8.5px; font-weight: 600; border: 1px solid transparent; border-radius: var(--theme-radius-pill, 100px); align-items: center; white-space: nowrap; }
  .pv-d-btn.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: color-mix(in srgb, var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)) 10%, transparent); border-color: color-mix(in srgb, var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)) 24%, transparent); }
  .pv-d-btn.run { color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); background: var(--theme-color-success, #7fba8a); }
  .pv-d-btn.ghost { color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); background: var(--theme-bg-hover, color-mix(in srgb, var(--theme-text-primary, #4a3728) 5%, transparent)); }
  .pv-d-toast-row { display: flex; margin-top: auto; justify-content: flex-end; }
  .pv-d-toast { display: inline-flex; padding: 5px 10px; font-size: 8.5px; color: var(--theme-text-primary, #4a3728); background: var(--theme-bg-card, #fff); border: 1px solid color-mix(in srgb, var(--theme-color-success, #7fba8a) 26%, var(--theme-border, #ede4db)); border-radius: var(--theme-radius-pill, 100px); box-shadow: var(--theme-shadow-sm, 0 4px 12px rgba(0, 0, 0, 0.06)); align-items: center; gap: 4px; }
  .pv-d-toast i { display: flex; width: 13px; height: 13px; color: var(--theme-color-success, #7fba8a); background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent); border-radius: 50%; align-items: center; justify-content: center; }
  .pv-d-toast svg { width: 8px; height: 8px; }

  /* ===== 移动端：总览页（连接卡片 + 分组配置列表） ===== */
  .pv-m { display: flex; padding: 12px 14px; flex-direction: column; gap: 8px; }
  .pv-m-head { display: flex; flex-direction: column; align-items: flex-start; }
  .pv-m-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 15px; font-weight: 600; line-height: 1.2; }
  .pv-m-sub { margin-top: 1px; overflow: hidden; font-size: 9px; line-height: 1.3; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-add { display: inline-flex; width: 24px; height: 24px; color: var(--theme-accent-primary, #e8a0a0); background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent); border-radius: 50%; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-add svg { width: 12px; height: 12px; }
  .pv-m-hero { padding: 9px 12px 10px; background: radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--theme-color-success, #7fba8a) 16%, transparent), transparent 62%), var(--theme-bg-card, #fff); border: 1px solid color-mix(in srgb, var(--theme-color-success, #7fba8a) 26%, var(--theme-border, #ede4db)); border-radius: var(--theme-radius-xl, 14px); }
  .pv-m-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pv-m-state { display: flex; font-size: 8.5px; font-weight: 600; letter-spacing: 0.4px; color: var(--theme-text-muted, #c8bdb2); text-transform: uppercase; align-items: center; gap: 5px; }
  .pv-m-state i { width: 5px; height: 5px; background: var(--theme-color-success, #7fba8a); border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-color-success, #7fba8a) 14%, transparent); flex-shrink: 0; }
  .pv-m-ip { padding: 1px 6px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 8.5px; color: var(--theme-accent-primary, #e8a0a0); text-overflow: ellipsis; white-space: nowrap; background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent); border-radius: var(--theme-radius-pill, 100px); }
  .pv-m-name { margin-top: 3px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 16px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-metrics { display: flex; margin-top: 5px; align-items: center; gap: 10px; }
  .pv-m-metric { display: flex; align-items: baseline; gap: 4px; }
  .pv-m-metric small { font-size: 8px; color: var(--theme-text-muted, #c8bdb2); }
  .pv-m-metric b { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 11px; font-weight: 600; }
  .pv-m-metric + .pv-m-metric { padding-left: 10px; border-left: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); }
  .pv-m-actions { display: flex; margin-top: 7px; gap: 6px; }
  .pv-m-btn { display: flex; height: 26px; font-size: 9.5px; font-weight: 600; border: 1px solid transparent; border-radius: var(--theme-radius-pill, 100px); flex: 1; align-items: center; justify-content: center; gap: 4px; }
  .pv-m-btn svg { width: 9px; height: 9px; }
  .pv-m-btn.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: color-mix(in srgb, var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)) 10%, transparent); border-color: color-mix(in srgb, var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)) 24%, transparent); }
  .pv-m-btn.ghost { color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); background: var(--theme-bg-hover, color-mix(in srgb, var(--theme-text-primary, #4a3728) 5%, transparent)); }
  .pv-m-sec { display: flex; padding: 0 2px; font-size: 10px; font-weight: 600; color: var(--theme-text-primary, #4a3728); align-items: center; justify-content: space-between; }
  .pv-m-sec .pv-m-add { width: 20px; height: 20px; }
  .pv-m-sec .pv-m-add svg { width: 10px; height: 10px; }
  .pv-m-group { overflow: hidden; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border, #ede4db); border-radius: var(--theme-radius-lg, 12px); }
  .pv-m-row { display: flex; height: 42px; padding: 0 6px 0 10px; align-items: center; gap: 8px; }
  .pv-m-row + .pv-m-row { border-top: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); }
  .pv-m-row.on { background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 5%, transparent); }
  .pv-m-tile { display: flex; width: 26px; height: 26px; color: var(--theme-text-muted, #c8bdb2); background: var(--theme-bg-hover, color-mix(in srgb, var(--theme-text-primary, #4a3728) 5%, transparent)); border-radius: 8px; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-tile.on { color: var(--theme-color-success, #7fba8a); background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent); }
  .pv-m-tile svg { width: 13px; height: 13px; }
  .pv-m-row-text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
  .pv-m-row-text b { overflow: hidden; font-size: 11px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-row-text small { overflow: hidden; font-size: 8px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-chev { display: flex; width: 8px; color: var(--theme-text-muted, #c8bdb2); opacity: 0.45; flex-shrink: 0; }
  .pv-m-chev svg { width: 8px; height: 8px; }
  .pv-m-act { display: flex; width: 26px; height: 26px; border-radius: 50%; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-act svg { width: 10px; height: 10px; }
  .pv-m-act.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: color-mix(in srgb, var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)) 10%, transparent); }
  .pv-m-act.run { color: var(--theme-color-success-dark, var(--theme-color-success, #7fba8a)); background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent); }
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
    // 奶油主题：显式设置全部预用变量（不依赖全局 :root，避免全局暗色时预览不变化）
    styleEl.textContent = `
      :host { display: block; height: 100%;
        --theme-bg: #fdf8f4; --theme-bg-card: #ffffff; --theme-bg-hover: rgba(232,160,160,0.06);
        --theme-bg-active: rgba(232,160,160,0.1); --theme-bg-tag: #f5ede6;
        --theme-bg-sidebar: linear-gradient(180deg, #faf5f0, #f5efe8);
        --theme-text-primary: #4a3728; --theme-text-secondary: #7a6e5e; --theme-text-muted: #c8bdb2;
        --theme-text-white: #fff; --theme-text-on-accent: #fff;
        --theme-accent-primary: #e8a0a0; --theme-accent-secondary: #b8a9c9;
        --theme-color-success: #7fba8a; --theme-color-success-dark: #6aaa78; --theme-color-danger: #e8a0a0;
        --theme-border: #ede4db; --theme-border-light: #f5ede6;
        --theme-shadow-sm: 0 8px 28px rgba(74,55,40,0.06);
        --theme-radius-lg: 14px; --theme-radius-xl: 18px; --theme-radius-pill: 100px;
        --theme-font-body: 'Sora', sans-serif; --theme-font-display: 'Quicksand', sans-serif;
      }
      ${previewStyle}`
  } else if (name === 'dark') {
    // 暗色主题：覆盖全部预用变量
    styleEl.textContent = `
      :host { display: block; height: 100%;
        --theme-bg: #0d1b2a; --theme-bg-card: #1b2838; --theme-bg-hover: rgba(100,180,255,0.08);
        --theme-bg-active: rgba(100,180,255,0.12); --theme-bg-tag: #1e3040;
        --theme-bg-sidebar: linear-gradient(180deg, #0f1923, #0f1923);
        --theme-text-primary: #e0e8f0; --theme-text-secondary: #8a9bb0; --theme-text-muted: #5a6b80;
        --theme-text-white: #fff; --theme-text-on-accent: #fff;
        --theme-accent-primary: #6ba8e0; --theme-accent-secondary: #5a8ab0;
        --theme-color-success: #5ab08a; --theme-color-success-dark: #4a9a78; --theme-color-danger: #d48080;
        --theme-border: #2a4055; --theme-border-light: #243848;
        --theme-shadow-sm: 0 8px 28px rgba(0,0,0,0.25);
        --theme-radius-lg: 14px; --theme-radius-xl: 18px; --theme-radius-pill: 100px;
        --theme-font-body: 'Sora', sans-serif; --theme-font-display: 'Quicksand', sans-serif;
      }
      ${previewStyle}`
  } else {
    // 外部主题：读取 CSS 并注入 Shadow DOM；先给出缺省变量，主题自身定义会覆盖
    const ext = externalThemes.value.find((t) => t.name === name)
    if (ext) {
      const hostCss = ext.cssText.replace(/:root/g, ':host')
      styleEl.textContent = `
        :host { display: block; height: 100%;
          --theme-bg-sidebar: linear-gradient(180deg, color-mix(in srgb, var(--theme-text-primary, #4a3728) 4%, var(--theme-bg, #fdf8f4)), var(--theme-bg, #fdf8f4));
          --theme-text-secondary: var(--theme-text-muted, #7a6e5e);
          --theme-text-on-accent: var(--theme-text-white, #fff);
          --theme-accent-secondary: var(--theme-accent-primary, #e8a0a0);
          --theme-color-danger: var(--theme-accent-primary, #e8a0a0);
          --theme-border-light: var(--theme-border, #ede4db);
          --theme-bg-active: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent);
          --theme-shadow-sm: 0 4px 12px rgba(0,0,0,0.08);
          --theme-radius-lg: 12px; --theme-radius-xl: 16px; --theme-radius-pill: 100px;
        }
        ${hostCss}
        ${previewStyle}`
    }
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
  color: var(--theme-text-muted, #c8bdb2);
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
