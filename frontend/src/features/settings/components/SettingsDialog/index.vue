<template>
  <CreamDialog
    v-model="visible"
    :title="t('newSettings.settings')"
    :subtitle="t('newSettings.settingsDesc')"
    width="700px"
    height="720px"
    :inline="inline"
    :body-scroll="false"
  >
    <div class="sd-body" :class="{ 'sd-single': !!section }">
      <!-- 左侧分类导航（tablist：方向键移动并激活，roving tabindex） -->
      <div
        ref="navRef"
        v-if="!section"
        class="sd-nav"
        role="tablist"
        aria-orientation="vertical"
        :aria-label="t('newSettings.tabsLabel')"
      >
        <LtButton
          v-for="(tab, idx) in tabs"
          :key="tab.key"
          variant="bare"
          :id="`sd-tab-${tab.key}`"
          :ref="(el) => setTabRef(el, idx)"
          class="sd-nav-item"
          :class="{ active: activeTab === tab.key }"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`sd-panel-${tab.key}`"
          :tabindex="activeTab === tab.key ? 0 : -1"
          @click="selectTab(tab.key)"
          @keydown="handleTabKeydown($event, idx)"
        >
          <span class="sd-nav-icon">
            <svg
              v-if="tab.key === 'general'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <svg
              v-else-if="tab.key === 'core'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <path d="M6 6h.01M6 18h.01" />
            </svg>
            <svg
              v-else-if="tab.key === 'data'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7" />
              <path d="M16 3H8c-2 0-3 1-3 3v1h14V6c0-2-1-3-3-3z" />
              <path d="M9 12h6M9 16h6" />
            </svg>
            <svg
              v-else-if="tab.key === 'security'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <svg
              v-else
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </span>
          <span class="sd-nav-label">{{ tab.label }}</span>
        </LtButton>
      </div>

      <!-- 右侧内容区（唯一纵向滚动容器） -->
      <div ref="contentRef" class="sd-content">
        <GeneralSection v-if="panelTab === 'general'" :single="!!section" />
        <CoreSection v-if="panelTab === 'core'" :single="!!section" />
        <DataSection v-if="panelTab === 'data'" :single="!!section" />
        <SecuritySection v-if="panelTab === 'security'" :single="!!section" />
        <AboutSection v-if="panelTab === 'about'" :single="!!section" />
      </div>
    </div>
  </CreamDialog>

  <!-- 备份与恢复（数据管理的下级弹窗） -->
  <BackupDialog v-model="backupDialogVisible" />

  <!-- 加速源管理（内核下载与安装的下级弹窗） -->
  <CreamDialog v-model="mirrorDialogVisible" :title="t('newSettings.mirrorSource')" width="560px">
    <div class="sd-mirror-dialog">
      <div class="sd-mirror-dialog-head">
        <span class="sd-mirror-dialog-desc">{{ t('newSettings.mirrorSourceDesc') }}</span>
        <div class="sd-btn-group">
          <LtButton
            v-if="canRestoreDefaults"
            type="button"
            variant="ghost"
            @click="handleRestoreMirrors"
          >
            {{ t('newSettings.mirrorRestoreDefaults') }}
          </LtButton>
          <LtButton
            type="button"
            variant="ghost"
            :disabled="mirrorProbing"
            @click="handleProbeMirrors"
          >
            {{ mirrorProbing ? t('newSettings.mirrorProbing') : t('newSettings.mirrorProbe') }}
          </LtButton>
        </div>
      </div>

      <div class="sd-mirror-list" role="radiogroup" :aria-label="t('newSettings.mirrorSource')">
        <div
          v-for="s in mirrorSources"
          :key="s.value"
          class="sd-mirror-item"
          :class="{ active: mirrorSelected === s.value }"
          @click="handleMirrorRowClick($event, s.value)"
        >
          <label class="sd-mirror-pick">
            <input
              class="lt-sr-only"
              type="radio"
              name="sd-mirror"
              :value="s.value"
              :checked="mirrorSelected === s.value"
              @change="mirrorSelect(s.value)"
            />
            <span class="sd-mirror-radio" aria-hidden="true"></span>
            <span class="sd-mirror-name" :title="s.label || t('newSettings.mirrorOfficial')">
              <span class="sd-mirror-name-text">{{
                s.label || t('newSettings.mirrorOfficial')
              }}</span>
              <span v-if="s.custom" class="sd-mirror-tag">{{ t('newSettings.mirrorCustom') }}</span>
            </span>
          </label>
          <span class="sd-mirror-lat" :class="latencyClass(s.latency)">{{
            latencyText(s.latency)
          }}</span>
          <span v-if="mirrorSelected === s.value" class="sd-mirror-inuse">{{
            t('newSettings.mirrorInUse')
          }}</span>
          <LtButton
            v-if="!s.official"
            type="button"
            variant="danger"
            size="xs"
            circle
            :aria-label="t('newSettings.mirrorRemoveSource', { source: s.label || s.value })"
            :title="t('newSettings.mirrorRemoveSource', { source: s.label || s.value })"
            @click="handleRemoveMirror(s.value)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </LtButton>
        </div>
      </div>

      <form class="sd-mirror-add" @submit.prevent="handleAddMirror">
        <LtInput
          v-model="mirrorInput"
          class="sd-mirror-input"
          variant="filled"
          inputmode="url"
          autocomplete="off"
          :spellcheck="false"
          :placeholder="t('newSettings.mirrorAddPlaceholder')"
          :aria-label="t('newSettings.mirrorAddLabel')"
          :aria-invalid="!!mirrorAddError"
          :aria-describedby="mirrorAddError ? 'sd-mirror-add-error' : 'sd-mirror-add-hint'"
          @input="mirrorAddError = ''"
        />
        <LtButton type="submit" variant="primary" :disabled="!mirrorInput.trim()">
          {{ t('newSettings.mirrorAdd') }}
        </LtButton>
      </form>
      <div v-if="mirrorAddError" id="sd-mirror-add-error" class="sd-mirror-error" role="alert">
        {{ mirrorAddError }}
      </div>
      <div v-else id="sd-mirror-add-hint" class="sd-mirror-add-hint">
        {{ t('newSettings.mirrorAddHint') }}
      </div>
    </div>
    <template #footer>
      <span class="sd-mirror-footer-hint">{{ t('newSettings.mirrorApplyHint') }}</span>
      <LtButton type="button" variant="primary" @click="mirrorDialogVisible = false">
        {{ t('newSettings.mirrorDone') }}
      </LtButton>
    </template>
  </CreamDialog>

  <!-- 确认弹窗 -->
  <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="380px">
    <div class="sd-confirm-body">
      <span class="sd-confirm-icon">
        <svg
          width="40"
          height="40"
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
      <div class="sd-confirm-message">{{ cfmMessage }}</div>
    </div>
    <template #footer>
      <div class="sd-btn-group">
        <LtButton variant="ghost" @click="resolveConfirm(false)">{{
          t('newCommon.cancel')
        }}</LtButton>
        <LtButton variant="primary" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</LtButton>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * SettingsDialog — 全局设置弹窗（左侧分类导航 + 右侧设置面板）
 *
 * 分类：通用（自动运行/刷新间隔/默认服务方式/通知）、核心管理（版本检测、
 * 路径、下载与安装及加速源管理下级弹窗）、数据管理（清缓存/清日志）、
 * 安全（5.12 锁定密码）、关于（检查更新 5.11，入口由 UPDATE_CHECK_ENABLED 控制）。
 * 平台差异：Android 内核编译期内置，核心路径、快捷目录、镜像源与下载安装等
 * 桌面专属项一律隐藏；面板内确认操作统一使用 Promise 化内置确认弹窗替代原生 confirm。
 *
 * 分类面板在 sections 组件中，分类状态在 composables/；本组件只负责弹窗外壳、
 * 分类导航与下级弹窗编排。各分类 composable 在此实例化后 provide 给面板子组件，
 * 保证关闭弹窗时的清理与跨分类共享状态（加速源选择）只有一份。
 */
import { computed, nextTick, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import BackupDialog from './BackupDialog.vue'
import GeneralSection from './GeneralSection.vue'
import CoreSection from './CoreSection.vue'
import DataSection from './DataSection.vue'
import SecuritySection from './SecuritySection.vue'
import AboutSection from './AboutSection.vue'
import { LtButton, LtInput } from '@/shared/ui'
import { usePageConfirm } from '@/shared/ui/usePageConfirm'
import { useMirrorProbe } from '@/shared/composables/useMirrorProbe'
import { useEasyTierStore } from '@/shared/store/easytier'
import { isAndroid } from '@/shared/platform/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { useSettingsPreferences } from '../../composables/useSettingsPreferences'
import { useSettingsKernel } from '../../composables/useSettingsKernel'
import { useSettingsUpdate } from '../../composables/useSettingsUpdate'
import { useSettingsData } from '../../composables/useSettingsData'
import { useSettingsSecurity } from '../../composables/useSettingsSecurity'
import {
  SETTINGS_ENV_KEY,
  SETTINGS_PREFERENCES_KEY,
  SETTINGS_KERNEL_KEY,
  SETTINGS_UPDATE_KEY,
  SETTINGS_DATA_KEY,
  SETTINGS_SECURITY_KEY
} from './context'

type SettingsSection = 'general' | 'core' | 'data' | 'security' | 'about'
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    inline?: boolean
    section?: SettingsSection
    // 首次打开时定位的分类（快捷菜单“检查更新”直达关于页）
    initialTab?: SettingsSection
    // 打开后自动触发一次检查更新，由父组件在消费后置回 false
    checkUpdateOnOpen?: boolean
  }>(),
  {
    inline: false,
    checkUpdateOnOpen: false
  }
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'auto-checked': []
}>()

// 内部可见态：与父组件 v-model 双向同步
const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  }
)

const store = useEasyTierStore()
const { t } = useI18n()
// Android：内核编译期内置（无独立安装包/路径概念）
const isAndroidPlatform = isAndroid()
// 桌面 Tauri 运行时：浏览器预览不扫描本地内核目录（withGlobalTauri 已关闭，统一用 isTauri()）
const isDesktopRuntime =
  !isAndroidPlatform &&
  (() => {
    try {
      return isTauriRuntime()
    } catch {
      return false
    }
  })()

// 确认弹窗（替代原生 confirm）：将面板内确认操作 Promise 化，
// 被其它方式关闭时按“取消”处理
const {
  visible: cfmVisible,
  title: cfmTitle,
  message: cfmMessage,
  show: showConfirm,
  resolve: resolveConfirm
} = usePageConfirm()

// 各分类状态：单实例创建后 provide 给分类面板，关闭弹窗时统一清理
const mirror = useMirrorProbe()
const preferences = useSettingsPreferences()
const kernel = useSettingsKernel({
  confirm: showConfirm,
  mirror,
  isDesktopRuntime,
  isAndroidPlatform
})
const update = useSettingsUpdate({
  confirm: showConfirm,
  mirror,
  isDesktopRuntime,
  isAndroidPlatform
})
const data = useSettingsData(showConfirm)
const security = useSettingsSecurity(showConfirm)

// 下级弹窗与加速源状态由分类 composable 持有，模板直接引用解构后的绑定
const {
  mirrorDialogVisible,
  mirrorInput,
  mirrorAddError,
  mirrorSources,
  mirrorSelected,
  mirrorSelect,
  mirrorProbing,
  canRestoreDefaults,
  handleProbeMirrors,
  handleAddMirror,
  handleRemoveMirror,
  handleMirrorRowClick,
  handleRestoreMirrors,
  latencyText,
  latencyClass
} = kernel
const { backupDialogVisible } = data

provide(SETTINGS_ENV_KEY, { isDesktopRuntime, isAndroidPlatform })
provide(SETTINGS_PREFERENCES_KEY, preferences)
provide(SETTINGS_KERNEL_KEY, kernel)
provide(SETTINGS_UPDATE_KEY, update)
provide(SETTINGS_DATA_KEY, data)
provide(SETTINGS_SECURITY_KEY, security)

watch(visible, (v) => {
  emit('update:modelValue', v)
  // 关闭时丢弃未提交的密码输入（明文不在内存/界面残留）
  if (!v) {
    security.resetLockForm()
    // 下级加速源弹窗一并关闭，未提交的输入与错误提示不残留
    kernel.mirrorDialogVisible.value = false
    kernel.mirrorInput.value = ''
    kernel.mirrorAddError.value = ''
    // 备份与恢复同样作为下级弹窗，关闭设置时一并收起
    data.backupDialogVisible.value = false
  }
})

// Tab 导航
const activeTab = ref('general')
const tabs = [
  { key: 'general', label: t('newSettings.general') },
  { key: 'core', label: t('newSettings.coreMgmt') },
  { key: 'data', label: t('newSettings.dataMgmt') },
  { key: 'security', label: t('newSettings.security') },
  { key: 'about', label: t('newSettings.about') }
]
// 单页模式（Android 设置子路由）：section 直接决定渲染的分类，忽略内部 tab 状态
const panelTab = computed(() => props.section || activeTab.value)

// Tab 导航键盘操作：Up/Down/Left/Right 循环，Home/End 跳首尾（UX-104）
const tabRefs = ref<HTMLButtonElement[]>([])
const navRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
// LtButton 的模板 ref 是组件实例，取出根按钮元素供焦点管理使用
const setTabRef = (el: unknown, idx: number) => {
  if (!el) return
  const rootEl = (el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)
  tabRefs.value[idx] = rootEl as HTMLButtonElement
}
// 窄屏横向 tab：切换后把当前分类滚入可视区。
// 只滚动导航自身，避免 scrollIntoView 连带滚动弹窗或内容区等祖先容器。
const scrollActiveTabIntoView = () => {
  nextTick(() => {
    const nav = navRef.value
    const idx = tabs.findIndex((tab) => tab.key === activeTab.value)
    const item = tabRefs.value[idx]
    if (!nav || !item) return
    const navRect = nav.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    let left = nav.scrollLeft
    let top = nav.scrollTop
    if (itemRect.left < navRect.left) left += itemRect.left - navRect.left - 8
    else if (itemRect.right > navRect.right) left += itemRect.right - navRect.right + 8
    if (itemRect.top < navRect.top) top += itemRect.top - navRect.top - 8
    else if (itemRect.bottom > navRect.bottom) top += itemRect.bottom - navRect.bottom + 8
    if (left !== nav.scrollLeft || top !== nav.scrollTop) {
      nav.scrollTo({ left, top, behavior: 'smooth' })
    }
  })
}
const selectTab = (key: string) => {
  activeTab.value = key
  // 切换分类后内容区回到顶部，避免沿用上一个分类的滚动位置
  nextTick(() => contentRef.value?.scrollTo({ top: 0 }))
  scrollActiveTabIntoView()
}
const handleTabKeydown = (e: KeyboardEvent, idx: number) => {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  let next = idx
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1
  selectTab(tabs[next].key)
  nextTick(() => tabRefs.value[next]?.focus())
}

// 切到内核页时重新扫描，外部新增/删除安装包也能及时反映
watch(panelTab, (tab) => {
  kernel.closeCoreVerDropdown()
  if (contentRef.value) contentRef.value.scrollTop = 0
  if (tab === 'core') void kernel.refreshDownloadedCores()
})

// 弹窗打开时：按入口定位分类、恢复持久化的自动运行设置，并加载应用/内核版本信息
//（Android 版本取编译期内核；桌面走 easytier-cli 与资源目录）
watch(visible, async (v) => {
  if (v) {
    activeTab.value = props.initialTab || 'general'
    kernel.resetMirrorSession()
    // 打开时让当前分类在窄屏横向 tab 中自动可见
    scrollActiveTabIntoView()
    preferences.syncRefreshInput()
    await update.loadAppVersion()
    // 快捷入口“检查更新”：版本号就绪后再发起一次检查，先通知父组件消费标记避免重复触发
    if (props.checkUpdateOnOpen) {
      emit('auto-checked')
      void update.handleCheckUpdate()
    }
    // 内核版本探测走全局 store：桌面 easytier-cli -V / Android 编译期内置版本
    try {
      await store.detectCoreVersion()
    } catch {
      /* 探测失败按未安装处理，表单保持宽松展示 */
    }
    await kernel.loadCoreState()
  } else {
    kernel.closeCoreVerDropdown()
  }
})

// 供外壳在设置已打开时复用同一入口（FAB 悬浮在弹窗之上，仍可点击）
const focusAboutAndCheck = () => {
  activeTab.value = 'about'
  scrollActiveTabIntoView()
  void update.loadAppVersion().then(() => update.handleCheckUpdate())
}
defineExpose({ focusAboutAndCheck })
</script>

<style scoped lang="less">
@import url('./styles/common.less');

.sd-body {
  display: flex;
  min-height: 0;
  overflow: hidden;
  flex: 1;
  gap: var(--theme-space-4);
}

/* 左侧导航：独立滚动，不随右侧内容滚动 */
.sd-nav {
  display: flex;
  width: 140px;
  min-height: 0;
  padding: var(--theme-space-3);
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex-shrink: 0;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.sd-nav::-webkit-scrollbar {
  width: 4px;
}

.sd-nav::-webkit-scrollbar-track {
  background: transparent;
}

.sd-nav::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.sd-nav-item {
  display: flex;
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-md, 10px);
  transition: var(--theme-transition-interactive);
  align-items: center;
  justify-content: flex-start;
  gap: var(--theme-space-2);
}

.sd-nav-item:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.sd-nav-item.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.sd-nav-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.7;
}

.sd-nav-item.active .sd-nav-icon {
  opacity: 1;
}

.sd-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧内容 */
.sd-content {
  min-width: 0;
  min-height: 0;
  padding: var(--theme-space-3) var(--theme-space-4) var(--theme-space-3) var(--theme-space-3);
  overflow: hidden auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex: 1;
  overscroll-behavior: contain;
}

.sd-content::-webkit-scrollbar {
  width: 4px;
}

.sd-content::-webkit-scrollbar-track {
  background: transparent;
}

.sd-content::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.sd-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 单页模式：去掉分类导航，内容卡片与外层弹窗合并为一层 */
.sd-body.sd-single .sd-content {
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

/* 加速源列表（5.10） */
.sd-mirror-list {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-2);
  padding: var(--theme-space-2) 0 var(--theme-space-3);
}

.sd-mirror-item {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  cursor: pointer;
  background: var(--theme-bg-tag, rgb(245 237 230 / 50%));
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 12px);
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: var(--theme-space-3);
}

.sd-mirror-pick {
  position: relative;
  display: flex;
  min-width: 0;
  cursor: pointer;
  align-items: center;
  gap: var(--theme-space-3);
  flex: 1;
}

.sd-mirror-item.active {
  border-color: var(--theme-color-success, #7fba8a);
}

/* 原生 radio 键盘聚焦：给自定义圆点画焦点环 */
.sd-mirror-item input:focus-visible + .sd-mirror-radio {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.sd-mirror-radio {
  width: 14px;
  height: 14px;
  border: 2px solid var(--theme-border, #e8ddd3);
  border-radius: 50%;
  flex-shrink: 0;
}

.sd-mirror-item.active .sd-mirror-radio {
  background: var(--theme-color-success, #7fba8a);
  border-color: var(--theme-color-success, #7fba8a);
  box-shadow: inset 0 0 0 2px var(--theme-bg-tag, #fff);
}

.sd-mirror-name {
  display: flex;
  min-width: 0;
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  align-items: center;
  gap: 6px;
  flex: 1;
}

.sd-mirror-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 自定义源标签：与内置镜像区分 */
.sd-mirror-tag {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #e8ddd3);
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
}

.sd-mirror-lat {
  font-size: 12px;
  font-weight: 600;
}

.sd-mirror-lat.lat-good {
  color: var(--theme-color-success, #7fba8a);
}

.sd-mirror-lat.lat-bad {
  color: var(--theme-color-danger, #e8a0a0);
}

.sd-mirror-lat.lat-mid {
  color: var(--theme-color-warning, #e6a23c);
}

.sd-mirror-lat.lat-unknown {
  color: var(--theme-text-secondary, #7a6e5e);
}

.sd-mirror-inuse {
  font-size: 11px;
  color: var(--theme-color-success, #7fba8a);
  flex-shrink: 0;
}

/* 加速源下级弹窗 */
.sd-mirror-dialog {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.sd-mirror-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
}

.sd-mirror-dialog-desc {
  min-width: 200px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-secondary, #7a6e5e);
  flex: 1;
}

.sd-mirror-add {
  display: flex;
  margin-top: var(--theme-space-2);
  gap: var(--theme-space-2);
}

.sd-mirror-add .sd-mirror-input {
  min-width: 0;
  flex: 1;
}

.sd-mirror-error {
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-color-danger, #e8a0a0);
}

.sd-mirror-add-hint,
.sd-mirror-footer-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-secondary, #7a6e5e);
}

.sd-mirror-footer-hint {
  min-width: 0;
  flex: 1;
}

/* 确认弹窗内容 */
.sd-confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-3);
  padding: var(--theme-space-3) 0 var(--theme-space-2);
  text-align: center;
}

.sd-confirm-icon {
  color: var(--theme-accent-primary, #e8a0a0);
}

.sd-confirm-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #8b7355);
}

/* 移动端（含 Android 二级页面）：导航转为顶部横向滚动 tab，内容区占满全宽 */
@media (width <= 640px) {
  .sd-body {
    flex-direction: column;
    gap: var(--theme-space-3);
  }

  .sd-nav {
    width: auto;
    flex-direction: row;
    gap: var(--theme-space-1);
    padding: var(--theme-space-2);
    overflow: auto hidden;
    scrollbar-width: none;
    flex-shrink: 0;

    /* 左右渐隐提示可横向滚动 */
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 10px,
      #000 calc(100% - 10px),
      transparent 100%
    );
  }

  .sd-nav::-webkit-scrollbar {
    display: none;
  }

  .sd-nav-item {
    width: auto;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .sd-content {
    padding: var(--theme-space-3);
  }
}
</style>
