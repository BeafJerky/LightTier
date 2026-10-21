<template>
  <div class="nl-window" :class="{ 'nl-android': isAndroidPlatform }">
    <!-- 自定义拖拽条（桌面端窗口控制；Android 隐藏） -->
    <div
      v-if="!isAndroidPlatform"
      class="nl-drag-bar"
      data-tauri-drag-region
      @dblclick="toggleMaximize"
    >
      <span class="nl-drag-title">LightTier</span>
      <div class="nl-win-actions" @dblclick.stop>
        <button
          type="button"
          class="nl-win-btn"
          @click.stop="minimizeWindow"
          :title="t('newLayout.minimize')"
          :aria-label="t('newLayout.minimize')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          class="nl-win-btn"
          @click.stop="toggleMaximize"
          :title="isMaximized ? t('newLayout.restore') : t('newLayout.maximize')"
          :aria-label="isMaximized ? t('newLayout.restore') : t('newLayout.maximize')"
        >
          <svg
            v-if="isMaximized"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M8 8V5h11v11h-3" />
            <rect x="5" y="8" width="11" height="11" rx="1" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          class="nl-win-btn nl-win-close"
          @click.stop="closeWindow"
          :title="t('newCommon.closeWindow')"
          :aria-label="t('newCommon.closeWindow')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <div class="nl-root">
      <!-- 左侧边栏（窄屏抽屉化） -->
      <aside class="nl-sidebar" :class="{ open: sidebarOpen }">
        <div class="nl-sidebar-header">
          <div class="nl-logo">ET</div>
          <span class="nl-brand">LightTier</span>
        </div>

        <div class="nl-section-label">{{ t('newLayout.sectionNav') }}</div>

        <nav class="nl-menu" role="navigation" :aria-label="t('newLayout.ariaMainNav')">
          <button
            v-for="item in menuItems"
            :key="item.fullPath"
            class="nl-menu-item"
            :class="{ active: isActive(item.fullPath) }"
            @click="navigate(item.fullPath)"
          >
            <span class="nl-menu-icon">
              <Icon :icon="item.icon" :size="18" />
            </span>
            <span class="nl-menu-label">{{ item.labelKey ? t(item.labelKey) : item.label }}</span>
          </button>
        </nav>

        <div class="nl-sidebar-footer">
          <!-- 上行：语言 + 主题 -->
          <div class="nl-footer-toolbar">
            <div class="nl-footer-actions">
              <!-- 语言切换 -->
              <div class="nl-lang-wrap">
                <button
                  class="nl-action-btn"
                  @click.stop="langDropdownVisible = !langDropdownVisible"
                  :title="currentLangName"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18l3-6 3 6" />
                  </svg>
                </button>
                <Transition name="lang-drop">
                  <div v-if="langDropdownVisible" class="nl-lang-dropdown">
                    <button
                      v-for="item in langMap"
                      :key="item.lang"
                      class="nl-lang-option"
                      :class="{ active: currentLang === item.lang }"
                      @click="switchLang(item.lang)"
                      >{{ item.name }}</button
                    >
                  </div>
                </Transition>
              </div>
              <!-- 主题切换 -->
              <button class="nl-action-btn" @click="openTheme" :title="t('newLayout.theme')">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="5" />
                  <path
                    d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                  />
                </svg>
              </button>
            </div>
          </div>
          <!-- 下行：用户信息 + 设置 -->
          <div class="nl-user">
            <div class="nl-user-avatar">C</div>
            <div class="nl-user-info">
              <span class="nl-user-name">LightTier</span>
              <span class="nl-user-status">{{ t('newLayout.managerLabel') }}</span>
            </div>
            <!-- 设置 -->
            <button class="nl-action-btn" @click="openSettings" :title="t('newSettings.settings')">
              <svg
                width="14"
                height="14"
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
            </button>
          </div>
        </div>
      </aside>

      <!-- 窄屏抽屉遮罩 -->
      <Transition name="nl-mask-fade">
        <div v-if="sidebarOpen" class="nl-mask" @click="sidebarOpen = false"></div>
      </Transition>

      <!-- 右侧内容区 -->
      <div class="nl-main">
        <!-- 顶部工具栏 -->
        <header class="nl-toolbar">
          <div class="nl-toolbar-left">
            <!-- 二级页面（设置/主题）：返回上一页；其余页面为窄屏菜单开关 -->
            <button
              v-if="isSubPage"
              class="nl-back-btn"
              @click="goBack"
              :aria-label="t('newCommon.back')"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              v-else
              class="nl-hamburger"
              @click="sidebarOpen = true"
              :aria-label="t('newLayout.ariaOpenMenu')"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <div class="nl-page-header">
              <h1 class="nl-page-title">{{ pageTitle }}</h1>
              <p class="nl-page-subtitle">{{ pageSubtitle }}</p>
            </div>
          </div>
          <div class="nl-toolbar-right"> </div>
        </header>

        <!-- 页面内容 -->
        <main class="nl-content">
          <router-view />
        </main>
      </div>
    </div>
  </div>

  <!-- Toast 容器 -->
  <Teleport to="body">
    <div class="cream-toast-container" role="alert" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="cream-toast" :class="t.type">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
  <!-- 设置/主题弹窗：仅桌面端；Android 走独立二级页面（settings-view / theme-view） -->
  <ThemeDialog v-if="!isAndroidPlatform" v-model="themeDialogVisible" />
  <SettingsDialog v-if="!isAndroidPlatform" v-model="settingsDialogVisible" />
  <FloatingMenu />
</template>

<script setup lang="ts">
/**
 * NewLayout — 新版主布局（LightTier 唯一布局）
 *
 * 结构：自定义标题栏（桌面拖拽/关闭）→ 左侧导航栏（窄屏抽屉化）→ 顶部工具栏 → 内容区，
 * 并内嵌全局 Toast 容器与设置/主题入口。
 * 平台差异：桌面用弹窗承载设置/主题并显示窗口控制按钮；Android 改为二级路由页面，
 * 同时适配 edge-to-edge 安全区（--lt-safe-area-*，由原生侧注入）。
 */
import { useLocaleStore } from '@/store/modules/locale'
import { useLocale } from '@/hooks/web/useLocale'
import { Icon } from '@/components/Icon'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import newLayoutRouterMap from '@/router/newLayout'
import { useCreamToast } from '@/hooks/useCreamToast'
import ThemeDialog from '@/components/ThemeDialog/index.vue'
import SettingsDialog from '@/components/SettingsDialog/index.vue'
import FloatingMenu from '@/components/FloatingMenu/index.vue'
import { restoreTheme } from '@/hooks/useExternalThemes'
import { resolveDefaultTheme, useThemeLoader } from '@/hooks/useThemeLoader'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { isAndroid } from '@/utils/platformUtil'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const { toasts } = useCreamToast()
const { t } = useI18n()
const isAndroidPlatform = isAndroid()
const { watchSystemTheme } = useThemeLoader()
// 系统深色偏好监听的取消函数（onBeforeUnmount 释放）
let stopSystemThemeWatch: (() => void) | null = null
const themeDialogVisible = ref(false)
const settingsDialogVisible = ref(false)

const localeStore = useLocaleStore()
const easyTierStore = useEasyTierStore()

const langMap = computed(() => localeStore.getLocaleMap)
const currentLang = computed(() => localeStore.getCurrentLocale.lang)
const currentLangName = computed(
  () => langMap.value.find((l) => l.lang === currentLang.value)?.name || '中文'
)
const langDropdownVisible = ref(false)

const switchLang = (lang: LocaleType) => {
  // 相同语言不重复处理
  if (lang === currentLang.value) {
    langDropdownVisible.value = false
    return
  }
  langDropdownVisible.value = false
  localeStore.setCurrentLocale({ lang })
  const { changeLocale } = useLocale()
  changeLocale(lang)
  // 整页刷新，确保所有组件文案（含已缓存列表）完整切换
  window.location.reload()
}

// 点击外部关闭语言下拉
const handleOutsideClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.nl-lang-wrap')) {
    langDropdownVisible.value = false
  }
}
const router = useRouter()
const route = useRoute()

// 页面标题/副标题：优先 i18n key，回退路由 meta 中的中文标题
const pageTitle = computed(() => {
  const key = route.meta?.titleKey as string
  return key ? t(key) : (route.meta?.title as string) || ''
})
const pageSubtitle = computed(() => {
  const key = route.meta?.subtitleKey as string
  return key ? t(key) : (route.meta?.subtitle as string) || ''
})

// 二级页面（设置/主题）：移动端以全屏页面形式进入，宽屏保留弹窗
const isSubPage = computed(() => Boolean(route.meta?.subPage))

// 打开设置：桌面弹窗；Android 跳二级页面（小屏避免弹窗遮挡）
const openSettings = () => {
  // 先收抽屉：避免侧栏悬停在二级页面/弹窗之上
  sidebarOpen.value = false
  if (isAndroidPlatform) router.push('/new/settings')
  else settingsDialogVisible.value = true
}

// 打开主题设置（同设置，平台分流）
const openTheme = () => {
  sidebarOpen.value = false
  if (isAndroidPlatform) router.push('/new/theme')
  else themeDialogVisible.value = true
}

// 返回上一页；无历史记录时回首页（Android 返回键/返回按钮共用）
const goBack = () => {
  if (window.history.state?.back) router.back()
  else router.push('/new')
}

// 主菜单项从路由表派生：仅带 title 的项进菜单（subPage 二级页面自动排除）
const menuItems = (newLayoutRouterMap[0]?.children || [])
  .filter((r) => r.meta?.title)
  .map((r) => ({
    fullPath: r.path ? '/new/' + r.path : '/new',
    label: (r.meta!.titleKey as string) || (r.meta!.title as string),
    labelKey: r.meta!.titleKey as string,
    icon: (r.meta!.icon as string) || ''
  }))

// 选中态判定：按完整路径精确匹配
const isActive = (path: string) => {
  return route.path === path
}

const sidebarOpen = ref(false)

const navigate = (path: string) => {
  sidebarOpen.value = false
  router.push(path)
}

// ===== 窗口控制（桌面自定义标题栏） =====
// 浏览器 Mock 下所有操作静默跳过，避免 Tauri API 抛错
const isMaximized = ref(false)
let unlistenResize: (() => void) | null = null

const syncMaximized = async () => {
  if (!isTauriRuntime()) return
  try {
    isMaximized.value = await getCurrentWindow().isMaximized()
  } catch {
    /* 窗口不可用时保持当前图标 */
  }
}

const minimizeWindow = async () => {
  if (!isTauriRuntime()) return
  try {
    await getCurrentWindow().minimize()
  } catch {
    /* 忽略窗口 API 失败 */
  }
}

// 最大化/还原：双击拖拽条与标题栏按钮共用
const toggleMaximize = async () => {
  if (!isTauriRuntime()) return
  try {
    await getCurrentWindow().toggleMaximize()
    await syncMaximized()
  } catch {
    /* 忽略窗口 API 失败 */
  }
}

// 关闭窗口（走 Tauri close 事件，由托盘逻辑拦截为隐藏驻留）
const closeWindow = async () => {
  if (!isTauriRuntime()) return
  try {
    await getCurrentWindow().close()
  } catch {
    /* 忽略窗口 API 失败 */
  }
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick)
  const saved = localStorage.getItem('theme')
  // 主题初始水合：仅在页面尚未设置 data-theme 时兜底恢复
  //（index.html 已按「存储 > 系统深色偏好」预设，此处避免遗漏导致无主题）
  if (!document.documentElement.getAttribute('data-theme')) {
    document.documentElement.setAttribute('data-theme', resolveDefaultTheme())
  }
  // 用户未显式选择主题时，跟随系统深色偏好实时切换
  stopSystemThemeWatch = watchSystemTheme()
  // 外部主题需异步读取 css 文件后再恢复
  if (saved && saved !== 'cream' && saved !== 'dark') {
    restoreTheme().catch(() => {})
  }
  // 应用启动时全局加载配置列表（只加载一次）
  easyTierStore.loadConfigFiles()
  // Web 配置服务仅桌面端提供（Android 上路由与菜单均已隐藏）
  if (!isAndroidPlatform) easyTierStore.loadWebConfigFiles()
  // 窗口最大化状态：初始化并在尺寸变化（含系统快捷键）时同步图标
  if (isTauriRuntime()) {
    syncMaximized()
    getCurrentWindow()
      .onResized(() => syncMaximized())
      .then((unlisten) => {
        unlistenResize = unlisten
      })
      .catch(() => {})
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  stopSystemThemeWatch?.()
  unlistenResize?.()
})
</script>

<style scoped>
.nl-window {
  /* 内容区底部为悬浮菜单预留的避让高度（窄屏在媒体查询中加大） */
  --lt-fab-clearance: 56px;

  display: flex;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
}

.nl-drag-bar {
  display: flex;
  height: 36px;
  padding: 0 var(--theme-space-1) 0 var(--theme-space-4);
  background: var(--theme-bg);
  border-bottom: 1px solid var(--theme-border);
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  -webkit-app-region: drag;
}

.nl-drag-title {
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted);
}

.nl-win-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  -webkit-app-region: no-drag;
}

.nl-win-btn {
  display: flex;
  width: 32px;
  height: 32px;
  color: var(--theme-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: all 0.15s;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
}

.nl-win-btn:hover {
  color: var(--theme-text-on-accent);
  background: var(--theme-accent-primary);
}

.nl-root {
  display: flex;
  min-height: 0;
  font-family: var(--theme-font-body);
  background: var(--theme-bg);
  flex: 1;
}

/* 左侧边栏 */
.nl-sidebar {
  display: flex;
  width: 220px;
  background: var(--theme-bg-sidebar);
  border-right: 1px solid var(--theme-border);
  flex-shrink: 0;
  flex-direction: column;
}

.nl-sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--theme-space-3);
  padding: var(--theme-space-6) var(--theme-space-5) var(--theme-space-5);
  border-bottom: 1px solid var(--theme-border);
}

.nl-logo {
  display: flex;
  width: 32px;
  height: 32px;
  font-family: var(--theme-font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-white);
  background: linear-gradient(135deg, var(--theme-accent-primary), var(--theme-accent-secondary));
  border-radius: var(--theme-radius-sm);
  align-items: center;
  justify-content: center;
}

.nl-brand {
  font-family: var(--theme-font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--theme-text-primary);
}

.nl-section-label {
  padding: var(--theme-space-5) var(--theme-space-5) var(--theme-space-2);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nl-menu {
  display: flex;
  min-height: 0;
  padding: var(--theme-space-1) var(--theme-space-3);
  overflow-y: auto;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.nl-menu-item {
  position: relative;
  display: flex;
  width: 100%;
  padding: var(--theme-space-3) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 14px;
  color: var(--theme-text-secondary);
  text-decoration: none;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--theme-radius-md);
  transition: all var(--theme-duration) var(--theme-ease-spring);
  align-items: center;
  gap: var(--theme-space-3);
}

.nl-menu-item:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

.nl-menu-item.active {
  color: var(--theme-text-primary);
  background: var(--theme-bg-active);
}

.nl-menu-item.active::before {
  position: absolute;
  top: 50%;
  left: -10px;
  width: 3px;
  height: 20px;
  background: var(--theme-accent-primary);
  border-radius: 0 4px 4px 0;
  content: '';
  transform: translateY(-50%);
}

.nl-menu-icon {
  display: flex;
  width: 18px;
  height: 18px;
  opacity: 0.7;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nl-menu-item.active .nl-menu-icon {
  color: var(--theme-accent-primary);
  opacity: 1;
}

.nl-menu-label {
  font-family: var(--theme-font-body);
  font-size: 14px;
  font-weight: 500;
}

.nl-sidebar-footer {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4) var(--theme-space-4);
  border-top: 1px solid var(--theme-border);
  flex-direction: column;
  gap: 0;
}

/* 上行工具栏 */
.nl-footer-toolbar {
  display: flex;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--theme-border, #ede4db);
  justify-content: flex-end;
}

.nl-footer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 下行：用户信息行 */
.nl-user {
  display: flex;
  align-items: center;
  gap: var(--theme-space-3);
}

.nl-user .nl-action-btn {
  margin-left: auto;
}

.nl-action-btn {
  display: flex;
  width: 28px;
  height: 28px;
  color: var(--theme-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: all 0.15s;
  align-items: center;
  justify-content: center;
}

.nl-action-btn:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

/* 语言下拉 */
.nl-lang-wrap {
  position: relative;
}

.nl-lang-dropdown {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 100;
  display: flex;
  min-width: 110px;
  padding: 4px;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-md);
  box-shadow: var(--theme-shadow-sm);
  flex-direction: column;
  gap: 2px;
}

.nl-lang-option {
  display: flex;
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: all 0.15s;
  align-items: center;
}

.nl-lang-option:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

.nl-lang-option.active {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-active);
}

/* 下拉动画 */
.lang-drop-enter-active {
  animation: langDropIn 0.2s ease;
}

.lang-drop-leave-active {
  animation: langDropIn 0.15s ease reverse;
}

@keyframes langDropIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.nl-user-avatar {
  display: flex;
  width: 32px;
  height: 32px;
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-white);
  background: linear-gradient(135deg, var(--theme-accent-secondary), var(--theme-accent-primary));
  border-radius: var(--theme-radius-round);
  align-items: center;
  justify-content: center;
}

.nl-user-info {
  display: flex;
  flex-direction: column;
}

.nl-user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-primary);
}

.nl-user-status {
  font-size: 11px;
  color: var(--theme-text-muted);
}

/* 右侧区域 */
.nl-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* 窄屏菜单开关（默认隐藏） */
.nl-hamburger {
  display: none;
  width: 32px;
  height: 32px;
  margin-right: var(--theme-space-3);
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: all 0.15s;
  align-items: center;
  justify-content: center;
}

.nl-hamburger:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

/* 二级页面返回按钮（移动端设置/主题页，替代菜单开关） */
.nl-back-btn {
  display: flex;
  width: 32px;
  height: 32px;
  margin-right: var(--theme-space-3);
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: all 0.15s;
  align-items: center;
  justify-content: center;
}

.nl-back-btn:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

/* 窄屏抽屉遮罩 */
.nl-mask {
  position: fixed;
  inset: 28px 0 0;
  z-index: 90;
  background: var(--el-overlay-color, rgb(0 0 0 / 35%));
}

/* Android：无窗口拖拽条（不渲染），抽屉/遮罩顶部对齐安全区（状态栏下方） */
.nl-android .nl-sidebar,
.nl-android .nl-mask {
  top: var(--lt-safe-area-top, 0);
}

/* Android：抽屉底部让出手势导航条区域 */
.nl-android .nl-sidebar {
  bottom: var(--lt-safe-area-bottom, 0);
}

.nl-mask-fade-enter-active,
.nl-mask-fade-leave-active {
  transition: opacity 0.25s;
}

.nl-mask-fade-enter-from,
.nl-mask-fade-leave-to {
  opacity: 0;
}

/* 顶部工具栏 */
.nl-toolbar {
  display: flex;
  height: 50px;
  padding: 0 24px;
  background: var(--theme-bg-toolbar);
  border-bottom: 1px solid var(--theme-border);
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.nl-toolbar-left {
  display: flex;
  align-items: center;
}

.nl-page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.nl-page-title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--theme-text-primary);
}

.nl-page-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.2;
  color: var(--theme-text-muted);
}

.nl-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nl-tool-btn {
  display: flex;
  width: 32px;
  height: 32px;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition: background 0.2s;
  align-items: center;
  justify-content: center;
}

.nl-tool-btn:hover {
  background: var(--theme-bg-hover);
}

.nl-btn-back {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-4);
  margin-left: var(--theme-space-2);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
  align-items: center;
  gap: var(--theme-space-2);
}

.nl-btn-back:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-active);
  border-color: var(--theme-accent-primary);
}

/* 内容区 */
.nl-content {
  min-height: 0;
  padding: var(--theme-space-6);
  padding-bottom: calc(var(--theme-space-6) + var(--lt-fab-clearance, 0px));
  overflow-y: auto;
  flex: 1;
}

/* 窄屏：侧边栏抽屉化 + 内容收紧 */
@media (width <= 900px) {
  .nl-sidebar {
    position: fixed;
    top: 28px;
    bottom: 0;
    left: 0;
    z-index: 100;
    transform: translateX(-100%);
    box-shadow: 0 8px 30px rgb(0 0 0 / 18%);
    transition: transform 0.3s var(--theme-ease-spring);
  }

  .nl-sidebar.open {
    transform: translateX(0);
  }

  .nl-hamburger {
    display: flex;
  }

  .nl-toolbar {
    padding: 0 var(--theme-space-4);
  }

  .nl-page-subtitle {
    display: none;
  }

  .nl-content {
    padding: var(--theme-space-4);
    padding-bottom: calc(var(--theme-space-4) + var(--lt-fab-clearance, 0px));
  }

  .nl-window {
    --lt-fab-clearance: 88px;
  }
}

.nl-content {
  scrollbar-width: thin;
}

/* Toast 通知 */
.cream-toast-container {
  position: fixed;

  /* 安全区：避免被手势导航条遮挡（桌面端变量为 0） */
  bottom: calc(40px + var(--lt-safe-area-bottom, 0px));
  left: 50%;
  z-index: 99999;
  display: flex;
  pointer-events: none;
  transform: translateX(-50%);
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.cream-toast {
  max-width: min(560px, calc(100vw - 32px));
  padding: var(--theme-space-3) var(--theme-space-6);
  font-family: var(--theme-font-body);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--theme-text-primary);
  text-align: center;
  overflow-wrap: anywhere;

  /* 长错误/路径/镜像地址必须换行，不能横向溢出窄窗口 */
  white-space: normal;
  pointer-events: auto;
  background: var(--theme-bg-card);
  border-radius: var(--theme-radius-pill);
  box-shadow: var(--theme-shadow-toast);
}

.cream-toast.success {
  border: 1.5px solid var(--theme-color-success);
}

.cream-toast.error {
  border: 1.5px solid var(--theme-accent-primary);
}

.cream-toast.warning {
  border: 1.5px solid var(--theme-color-warning, #e6a23c);
}

.cream-toast.info {
  border: 1.5px solid var(--theme-color-info, var(--theme-accent-primary));
}

.toast-enter-active {
  animation: toastIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-leave-active {
  animation: toastOut 0.25s ease forwards;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes toastOut {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  to {
    opacity: 0;
    transform: translateY(-8px) scale(0.95);
  }
}
</style>
