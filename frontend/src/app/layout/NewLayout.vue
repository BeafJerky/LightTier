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
        <LtButton
          variant="bare"
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
        </LtButton>
        <LtButton
          variant="bare"
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
        </LtButton>
        <LtButton
          variant="bare"
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
        </LtButton>
      </div>
    </div>

    <div class="nl-root">
      <!-- 左侧边栏（仅桌面；Android 使用底部导航） -->
      <aside v-if="!isAndroidPlatform" class="nl-sidebar" :class="{ open: sidebarOpen }">
        <div class="nl-sidebar-header">
          <img class="nl-logo" src="/logo.png" alt="" />
          <span class="nl-brand">LightTier</span>
        </div>

        <div class="nl-section-label">{{ t('newLayout.sectionNav') }}</div>

        <nav class="nl-menu" role="navigation" :aria-label="t('newLayout.ariaMainNav')">
          <LtButton
            v-for="item in menuItems"
            :key="item.fullPath"
            variant="bare"
            class="nl-menu-item"
            :class="{ active: isActive(item.fullPath) }"
            @click="navigate(item.fullPath)"
          >
            <span class="nl-menu-icon">
              <Icon :icon="item.icon" :size="18" />
            </span>
            <span class="nl-menu-label">{{ item.labelKey ? t(item.labelKey) : item.label }}</span>
          </LtButton>
        </nav>

        <!-- 底部入口：整行菜单式，图标 + 文字 + 当前值，命中区占满侧栏宽度 -->
        <div class="nl-sidebar-footer">
          <div class="nl-footer-rows">
            <!-- 语言切换 -->
            <div class="nl-lang-wrap">
              <LtButton
                variant="bare"
                class="nl-footer-row"
                @click.stop="langDropdownVisible = !langDropdownVisible"
                :aria-expanded="langDropdownVisible"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18l3-6 3 6" />
                </svg>
                <span class="nl-footer-row-label">{{ t('newSettings.language') }}</span>
                <span class="nl-footer-row-value">{{ currentLangName }}</span>
              </LtButton>
              <Transition name="lang-drop">
                <div v-if="langDropdownVisible" class="nl-lang-dropdown">
                  <LtButton
                    v-for="item in langMap"
                    :key="item.lang"
                    variant="bare"
                    class="nl-lang-option"
                    :class="{ active: currentLang === item.lang }"
                    @click="switchLang(item.lang)"
                    >{{ item.name }}</LtButton
                  >
                </div>
              </Transition>
            </div>
            <!-- 主题切换 -->
            <LtButton variant="bare" class="nl-footer-row" @click="openTheme">
              <svg
                width="16"
                height="16"
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
              <span class="nl-footer-row-label">{{ t('newLayout.themeShort') }}</span>
              <span class="nl-footer-row-value">{{ themeLabel }}</span>
            </LtButton>
            <!-- 设置 -->
            <LtButton variant="bare" class="nl-footer-row" @click="openSettings">
              <svg
                width="16"
                height="16"
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
              <span class="nl-footer-row-label">{{ t('newSettings.settings') }}</span>
              <span v-if="appVersion" class="nl-footer-row-value">v{{ appVersion }}</span>
            </LtButton>
          </div>
        </div>
      </aside>

      <!-- 窄屏抽屉遮罩（Android 无抽屉） -->
      <Transition name="nl-mask-fade">
        <div
          v-if="sidebarOpen && !isAndroidPlatform"
          class="nl-mask"
          @click="sidebarOpen = false"
        ></div>
      </Transition>

      <!-- 右侧内容区 -->
      <div class="nl-main">
        <!-- 顶部工具栏：Android 作为应用栏（一级页大标题，二级页返回 + 小标题） -->
        <header
          class="nl-toolbar"
          :class="{ 'nl-toolbar-android': isAndroidPlatform, 'is-sub': isSubPage }"
        >
          <div class="nl-toolbar-left">
            <!-- 二级页面：返回上一页；桌面一级页为窄屏菜单开关 -->
            <LtButton
              v-if="isSubPage"
              variant="text"
              size="lg"
              circle
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
            </LtButton>
            <LtButton
              v-else-if="!isAndroidPlatform"
              variant="text"
              size="md"
              circle
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
            </LtButton>
            <div class="nl-page-header">
              <h1 class="nl-page-title">{{ pageTitle }}</h1>
              <p v-if="showSubtitle && pageSubtitle" class="nl-page-subtitle">
                {{ pageSubtitle }}
              </p>
            </div>
          </div>
          <div class="nl-toolbar-right">
            <!-- Android：一级页提供刷新（替代桌面悬浮菜单） -->
            <LtButton
              v-if="showAndroidRefresh"
              variant="text"
              size="lg"
              circle
              class="nl-appbar-action"
              :class="{ spinning: isRefreshing }"
              :disabled="isRefreshing"
              :aria-label="t('newCommon.refresh')"
              :title="t('newCommon.refresh')"
              @click="refreshCurrentPage"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </LtButton>
          </div>
        </header>

        <!-- 页面内容 -->
        <main
          class="nl-content"
          :class="{
            'nl-content-android': isAndroidPlatform,
            'nl-content-full': isAndroidPlatform && isFullBleed
          }"
        >
          <router-view />
        </main>

        <!-- Android 底部导航：一级入口（子页面隐藏） -->
        <nav v-if="showTabBar" class="nl-tabbar" :aria-label="t('newLayout.ariaBottomNav')">
          <LtButton
            v-for="tab in androidTabs"
            :key="tab.path"
            variant="bare"
            class="nl-tab"
            :class="{ active: isTabActive(tab.path) }"
            :aria-current="isTabActive(tab.path) ? 'page' : undefined"
            @click="switchTab(tab.path)"
          >
            <span v-if="isTabActive(tab.path)" class="nl-tab-indicator"></span>
            <svg
              v-if="tab.icon === 'overview'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <rect x="3" y="3" width="7" height="7" rx="2" />
              <rect x="14" y="3" width="7" height="7" rx="2" />
              <rect x="3" y="14" width="7" height="7" rx="2" />
              <rect x="14" y="14" width="7" height="7" rx="2" />
            </svg>
            <svg
              v-else-if="tab.icon === 'config'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M6 3h9l4 4v14H6z" />
              <path d="M14 3v5h5M9 13h6M9 17h5" />
            </svg>
            <svg
              v-else-if="tab.icon === 'monitor'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M3 12h4l2-6 4 12 2-6h6" />
            </svg>
            <svg
              v-else-if="tab.icon === 'web'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
            </svg>
            <svg
              v-else
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <span class="nl-tab-label">{{ t(tab.labelKey) }}</span>
          </LtButton>
        </nav>
      </div>
    </div>
  </div>

  <!-- Toast 容器 -->
  <Teleport to="body">
    <div
      class="cream-toast-container"
      :class="{ 'nl-toast-android': isAndroidPlatform }"
      role="alert"
      aria-live="polite"
    >
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="cream-toast" :class="t.type">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
  <!-- 设置/主题弹窗：仅桌面端；Android 走独立路由页面 -->
  <ThemeDialog v-if="!isAndroidPlatform" v-model="themeDialogVisible" />
  <SettingsDialog v-if="!isAndroidPlatform" v-model="settingsDialogVisible" />
  <FloatingMenu v-if="!isAndroidPlatform" />
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
import { useLocaleStore } from '@/shared/store/locale'
import { changeLocale } from '@/shared/i18n'
import Icon from '@/shared/ui/Icon.vue'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import newLayoutRouterMap from '@/app/router/newLayout'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import ThemeDialog from '@/features/themes/components/ThemeDialog.vue'
import SettingsDialog from '@/features/settings/components/SettingsDialog/index.vue'
import FloatingMenu from '@/app/layout/FloatingMenu.vue'
import { LtButton } from '@/shared/ui'
import { restoreTheme } from '@/shared/composables/useExternalThemes'
import { resolveDefaultTheme, useThemeLoader } from '@/shared/composables/useThemeLoader'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getAppVersion } from '@/shared/platform/sysUtil'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const { toasts } = useCreamToast()
const { t } = useI18n()
const isAndroidPlatform = isAndroid()
const { watchSystemTheme, currentTheme } = useThemeLoader()
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

// 底部入口的右侧当前值：内置主题走 i18n，外部主题直接显示名称
const themeLabel = computed(() => {
  if (currentTheme.value === 'cream') return t('newTheme.cream')
  if (currentTheme.value === 'dark') return t('newTheme.dark')
  return currentTheme.value
})
const appVersion = ref('')

const switchLang = async (lang: LocaleType) => {
  // 相同语言不重复处理
  if (lang === currentLang.value) {
    langDropdownVisible.value = false
    return
  }
  langDropdownVisible.value = false
  await changeLocale(lang)
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

// Android 底部导航仅一级入口展示，二级页（详情/设置子页/编辑器）隐藏
const showTabBar = computed(() => isAndroidPlatform && Boolean(route.meta?.tabRoot))
// 全屏内容：编辑器由页面自行管理内边距，壳层不再留白
const isFullBleed = computed(() => Boolean(route.meta?.fullBleed))
// Android 一级页只留大标题；二级页展示小标题 + 说明
const showSubtitle = computed(() => !isAndroidPlatform || isSubPage.value)

// Android 一级页的刷新入口（设置页为本地状态，无需刷新）
const showAndroidRefresh = computed(
  () => isAndroidPlatform && Boolean(route.meta?.tabRoot) && route.path !== '/new/settings'
)
const isRefreshing = ref(false)
const refreshCurrentPage = async () => {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    await easyTierStore.loadConfigFiles()
    easyTierStore.triggerPageRefresh()
  } catch {
    /* 刷新失败保留现有列表，避免打断当前页面 */
  } finally {
    isRefreshing.value = false
  }
}

// Android 从后台回到前台：离开超过 5 秒才静默刷新运行态，
// 避免切到通知栏、权限弹窗后立刻回来也触发一轮请求。
let hiddenAt = 0
const handleVisibilityChange = () => {
  if (!isAndroidPlatform) return
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  if (hiddenAt && Date.now() - hiddenAt > 5000) easyTierStore.triggerPageRefresh()
  hiddenAt = 0
}

// 底部导航：对应桌面侧边栏一级入口
const androidTabs = [
  { path: '/new', labelKey: 'newLayout.overview', icon: 'overview' },
  { path: '/new/config', labelKey: 'newLayout.config', icon: 'config' },
  { path: '/new/web-config', labelKey: 'newLayout.webConfigTab', icon: 'web' },
  { path: '/new/monitor', labelKey: 'newLayout.monitor', icon: 'monitor' },
  { path: '/new/settings', labelKey: 'newSettings.settings', icon: 'settings' }
]
const isTabActive = (path: string) =>
  path === '/new' ? route.path === '/new' : route.path === path || route.path.startsWith(path + '/')
// 再次点击当前标签：回到页面顶部（Android 列表页惯用交互）
const scrollActivePageToTop = () => {
  document
    .querySelectorAll<HTMLElement>(
      '.nl-content, .nw-left-scroll, .nwc-left-scroll, .nm-left-scroll'
    )
    .forEach((el) => {
      if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' })
    })
}
// 底栏切换用 replace：一级入口之间不留历史栈，系统返回键直接退出应用
const switchTab = (path: string) => {
  if (route.path === path) {
    scrollActivePageToTop()
    return
  }
  router.replace(path)
}

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
  if (isAndroidPlatform) router.push('/new/settings/theme')
  else themeDialogVisible.value = true
}

// 返回上一页；无历史记录时按模块回到对应一级页（Android 返回键/返回按钮共用）
// 直达/刷新后恢复的子页没有历史栈，用 replace 回一级页，避免把子页重新压回栈里
const goBack = () => {
  if (window.history.state?.back) {
    router.back()
    return
  }
  if (route.path.startsWith('/new/settings')) router.replace('/new/settings')
  else if (route.path.startsWith('/new/config')) router.replace('/new/config')
  else if (route.path.startsWith('/new/monitor')) router.replace('/new/monitor')
  else router.replace('/new')
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
  document.addEventListener('visibilitychange', handleVisibilityChange)
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
  // Web 配置列表双端通用（Android 仅管理配置，不探测桌面进程/服务）
  easyTierStore.loadWebConfigFiles()
  // 窗口最大化状态：初始化并在尺寸变化（含系统快捷键）时同步图标
  if (isTauriRuntime()) {
    syncMaximized()
    getAppVersion()
      .then((v) => {
        appVersion.value = v
      })
      .catch(() => {})
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
  document.removeEventListener('visibilitychange', handleVisibilityChange)
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

.nl-win-actions .nl-win-btn {
  width: 32px;
  height: 32px;
  min-height: 32px;
  color: var(--theme-text-muted);
  border-radius: var(--theme-radius-sm);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  -webkit-app-region: no-drag;
}

.nl-win-actions .nl-win-btn:hover {
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
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
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
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  justify-content: flex-start;
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
}

.nl-footer-rows {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 2px;
}

/* 整行入口：比导航项低一级，但文字、当前值与命中区都要看得见、够得着 */
.nl-footer-row {
  display: flex;
  width: 100%;
  min-height: 34px;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 12px;
  color: var(--theme-text-primary);
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--theme-radius-md);
  transition: background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}

.nl-footer-row:hover {
  background: var(--theme-bg-hover);
}

.nl-footer-row svg {
  color: var(--theme-text-secondary);
  flex-shrink: 0;
}

.nl-footer-row-label {
  font-weight: 500;
  white-space: nowrap;
}

.nl-footer-row-value {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 语言下拉 */
.nl-lang-wrap {
  position: relative;
  width: 100%;
}

.nl-lang-dropdown {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  left: 0;
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
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
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

/* 下拉动画：只做 4px 位移与透明度，交给合成层处理 */
.lang-drop-enter-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-out),
    transform var(--theme-duration-fast) var(--theme-ease-out);
}

.lang-drop-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.lang-drop-enter-from,
.lang-drop-leave-to {
  opacity: 0;
  transform: translateY(4px);
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
  margin-right: var(--theme-space-3);
}

/* 二级页面返回按钮（移动端设置/主题页，替代菜单开关） */
.nl-back-btn {
  margin-right: var(--theme-space-3);
}

/* 窄屏抽屉遮罩 */
.nl-mask {
  position: fixed;
  inset: 28px 0 0;
  z-index: 90;
  background: var(--theme-overlay, rgb(0 0 0 / 30%));
}

.nl-mask-fade-enter-active {
  transition: opacity var(--theme-duration) var(--theme-ease-out);
}

.nl-mask-fade-leave-active {
  transition: opacity var(--theme-duration-fast) var(--theme-ease-in);
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
  transition: background-color var(--theme-duration-fast) var(--theme-ease-out);
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
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration-fast) var(--theme-ease-out);
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
    transition: transform var(--theme-duration-slow) var(--theme-ease-out);
  }

  .nl-sidebar.open {
    transform: translateX(0);
  }

  .nl-hamburger {
    display: inline-flex;
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

/* ===== Android 壳层：应用栏 + 底部导航 ===== */
.nl-window.nl-android {
  --lt-fab-clearance: 0px;
}

/* 一级页：大标题应用栏；二级页：返回 + 小标题 + 说明
   各级页面统一用 --theme-bg-toolbar，避免标题栏与内容区同色导致层级不清 */
.nl-toolbar-android {
  height: 56px;
  padding: 0 var(--theme-space-4);
}

.nl-toolbar-android.is-sub {
  height: 56px;
}

.nl-toolbar-android .nl-page-header {
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
}

.nl-toolbar-android .nl-page-title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.nl-toolbar-android.is-sub .nl-page-title {
  font-size: 16px;
}

.nl-toolbar-android .nl-page-subtitle {
  display: block;
  font-size: 11px;
  line-height: 1.3;
  color: var(--theme-text-muted);
}

.nl-toolbar-android .nl-back-btn {
  width: 40px;
  height: 40px;
  margin-right: var(--theme-space-2);
  margin-left: calc(-1 * var(--theme-space-2));
  color: var(--theme-text-primary);
  border-radius: var(--theme-radius-round);
}

/* 应用栏刷新：替代桌面悬浮菜单 */
.nl-appbar-action {
  margin-right: calc(-1 * var(--theme-space-2));
}

.nl-appbar-action:disabled {
  cursor: default;
}

.nl-appbar-action.spinning svg {
  animation: nl-appbar-spin 0.8s linear infinite;
}

@keyframes nl-appbar-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 内容区：Android 收紧留白，页面自身负责卡片间距 */
.nl-content-android {
  padding: var(--theme-space-3) var(--theme-space-4);
  padding-bottom: var(--theme-space-4);
  background: var(--theme-bg);
}

/* 平板 / 折叠屏展开：内容居中限宽，避免卡片被拉伸到整屏 */
@media (width >= 768px) {
  .nl-window.nl-android .nl-content-android:not(.nl-content-full) {
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* 与内容卡片左边缘对齐（容器居中留白 + 内容内边距） */
  .nl-window.nl-android .nl-toolbar-android {
    padding-right: max(var(--theme-space-4), calc((100% - 860px) / 2 + var(--theme-space-4)));
    padding-left: max(var(--theme-space-4), calc((100% - 860px) / 2 + var(--theme-space-4)));
  }
}

/* 横屏矮窗口（手机横屏 / 折叠屏外屏）：压缩应用栏与底栏，给内容留出高度 */
@media (orientation: landscape) and (height <= 520px) {
  .nl-window.nl-android .nl-toolbar-android,
  .nl-window.nl-android .nl-toolbar-android.is-sub {
    height: 44px;
  }

  .nl-toolbar-android .nl-page-title {
    font-size: 16px;
  }

  .nl-toolbar-android.is-sub .nl-page-title {
    font-size: 14px;
  }

  .nl-toolbar-android .nl-page-subtitle {
    display: none;
  }

  .nl-window.nl-android .nl-tabbar {
    height: 48px;
  }

  .nl-window.nl-android .nl-tab-indicator {
    height: 38px;
  }

  .nl-window.nl-android .nl-tab-label {
    font-size: 9.5px;
  }

  .nl-window.nl-android .nl-content-android {
    padding-top: var(--theme-space-2);
    padding-bottom: var(--theme-space-2);
  }
}

/* 全屏页（编辑器）：去掉壳层留白，页面内部自行滚动 */
.nl-content-full {
  display: flex;
  padding: 0;
  overflow: hidden;
  flex-direction: column;
}

.nl-content-full > * {
  flex: 1;
  min-height: 0;
}

/* 底部导航：Material 风格图标指示条，配色沿用主题令牌 */
.nl-tabbar {
  position: relative;
  z-index: 10;
  display: flex;
  height: 58px;
  background: var(--theme-bg-card);
  border-top: 1px solid var(--theme-border);
  flex-shrink: 0;
  align-items: stretch;
}

.nl-tabbar .nl-tab {
  position: relative;
  height: 100%;
  padding: 0;
  color: var(--theme-text-muted);
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  transition: color var(--theme-duration-fast) var(--theme-ease-out);
}

.nl-tab :deep(.n-button__content) {
  width: 100%;
  height: 100%;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

/* 触屏点按会残留 :hover，悬停反馈只在支持悬停的设备上生效 */
@media (hover: hover) {
  .nl-tabbar .nl-tab:hover {
    color: var(--theme-text-secondary);
  }
}

/* 触摸端按下反馈：WebView 没有鼠标悬停，按压反馈靠 :active */
.nl-tabbar .nl-tab:active {
  color: var(--theme-accent-primary);
  opacity: 0.75;
}

.nl-tabbar .nl-tab.active {
  color: var(--theme-accent-primary);
}

.nl-tab-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 0;
  width: min(68px, calc(100% - 12px));
  height: 46px;
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.14);
  border-radius: var(--theme-radius-pill);
  transform: translate(-50%, -50%);
}

.nl-tab svg,
.nl-tab-label {
  position: relative;
  z-index: 1;
}

.nl-tab svg {
  flex-shrink: 0;
}

.nl-tab-label {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.2px;
}

/* Toast 抬高到底栏之上，避免被导航条遮挡 */
.cream-toast-container.nl-toast-android {
  bottom: calc(78px + var(--lt-safe-area-bottom, 0px));
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
  transition:
    opacity var(--theme-duration) var(--theme-ease-out),
    transform var(--theme-duration) var(--theme-ease-out);
}

.toast-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}
</style>
