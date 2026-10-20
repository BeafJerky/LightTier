<script lang="ts" setup>
/**
 * 应用根组件
 *
 * 职责：全局容器（ConfigGlobal）+ 锁屏门禁 + 首次引导屏，以及平台初始化：
 * - 桌面：托盘注册、窗口状态恢复与越界校正、最小化到托盘、聚焦时重新锁屏
 * - Android：VPN 事件监听注册、回前台同步 VPN 状态、edge-to-edge 安全区（CSS 变量注入）
 */
import { ConfigGlobal } from '@/components/ConfigGlobal'
import OnboardingGuide from '@/components/OnboardingGuide/index.vue'
import { useDesign } from '@/hooks/web/useDesign'
import { useAppStore } from '@/store/modules/app'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useTrayStore } from '@/store/modules/trayStore'
import { checkDir } from '@/utils/fileUtil'
import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state'
// 引入 Tauri API（getCurrentWindow 供窗口显隐/聚焦事件，currentMonitor 供窗口越界校正）
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { emit } from '@tauri-apps/api/event'
import { isAndroid } from '@/utils/platformUtil'
import { migrateLockPassword, verifyLockPassword } from '@/utils/lockUtil'
import { registerMobileVpnListeners, syncMobileVpnStatus } from '@/utils/mobileVpn'
import { computed, nextTick, onBeforeMount, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const { getPrefixCls } = useDesign()

const prefixCls = getPrefixCls('app')

const appStore = useAppStore()
const currentSize = computed(() => appStore.getCurrentSize)

const greyMode = computed(() => appStore.getGreyMode)
const trayStore = useTrayStore()
const easytierStore = useEasyTierStore()

const isLocked = ref(false)
const inputPassword = ref('')
const lockError = ref(false)
const lockInputRef = ref<HTMLInputElement | null>(null)
const isFirstLoad = ref(true)
// 首次引导屏：未勾选“下次不再显示”时每次打开都显示
const showOnboarding = ref(localStorage.getItem('settings.onboardingDone') !== 'true')
let unlistenFocus: (() => void) | null = null
// Android：托盘/窗口状态插件仅桌面注册；VPN 事件监听需在此注册
const isAndroidPlatform = isAndroid()
let onVisibilityChange: (() => void) | null = null

// 锁定窗口：清空输入并显示锁屏（聚焦监听 / 首次启动共用）
const lockNow = () => {
  isLocked.value = true
  inputPassword.value = ''
  lockError.value = false
}

// 校验密码解锁；store 存的是加盐校验串（sha256$salt$hash，旧版明文在启动时迁移，绝不存明文）
const unlock = () => {
  if (verifyLockPassword(inputPassword.value, easytierStore.lockPassword)) {
    isLocked.value = false
    inputPassword.value = ''
    lockError.value = false
    isFirstLoad.value = false
  } else {
    lockError.value = true
  }
}

watch(isLocked, (v) => {
  if (v) {
    nextTick(() => lockInputRef.value?.focus())
  }
})

onBeforeMount(async () => {
  appStore.initTheme()
  // Android 无托盘与窗口状态恢复（对应插件仅在桌面注册）
  if (!isAndroidPlatform) {
    trayStore.initTray()
    restoreStateCurrent(StateFlags.ALL)
  }
  checkDir()
  easytierStore.setConfigPath()
  // 锁屏密码迁移（M-06）：旧版明文持久化值升级为加盐校验串（已是哈希/为空则不变）
  easytierStore.lockPassword = migrateLockPassword(easytierStore.lockPassword)
})

onMounted(async () => {
  // 显示窗口（配置文件中设置为初始不可见，现在前端已加载完成）
  getCurrentWindow()
    .show()
    .catch((e) => {
      console.error('Failed to show window:', e)
    })

  // 5.14 兜底 B：窗口状态恢复后校验是否越出屏幕（多显示器/分辨率变化场景），越界则居中，避免窗口"丢失"
  currentMonitor()
    .then(async (monitor) => {
      if (!monitor) return
      const win = getCurrentWindow()
      const pos = await win.outerPosition()
      const size = await win.outerSize()
      const outOfScreen =
        pos.x + size.width < monitor.position.x ||
        pos.y + size.height < monitor.position.y ||
        pos.x > monitor.position.x + monitor.size.width ||
        pos.y > monitor.position.y + monitor.size.height
      if (outOfScreen) {
        await win.center()
        console.log('[WindowState] restored position out of screen, centered')
      }
    })
    .catch(() => {
      /* non-Tauri */
    })

  // 发送事件通知后端，前端已准备就绪
  emit('frontend-ready').catch((e) => {
    console.error('Failed to emit frontend-ready event:', e)
  })

  // 检查是否需要锁定（首次启动）
  if (easytierStore.lockPassword && isFirstLoad.value) {
    lockNow()
  }

  // 窗口重新聚焦时重新锁定（覆盖托盘唤醒 hide→show、从其他窗口切回等场景）
  getCurrentWindow()
    .onFocusChanged(({ payload }) => {
      if (payload && easytierStore.lockPassword && !isLocked.value) {
        lockNow()
      }
    })
    .then((unlisten) => {
      unlistenFocus = unlisten
    })
    .catch((e) => {
      console.error('Failed to listen focus event:', e)
    })

  // Android：注册 VPN 插件事件监听（vpn_service_start → TUN fd 注入），并同步一次 VPN 状态
  if (isAndroidPlatform) {
    registerMobileVpnListeners().catch((e) => {
      console.error('Failed to register mobile vpn listeners:', e)
    })
    syncMobileVpnStatus()
    // 回到前台时重新同步（覆盖系统设置里手动断开 VPN 的场景）
    onVisibilityChange = () => {
      if (!document.hidden) syncMobileVpnStatus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  // 检查是否启动后最小化到托盘（桌面专属行为）
  const minimizeOnStart = localStorage.getItem('settings.minimizeOnStart') === 'true'
  if (minimizeOnStart && !isAndroidPlatform) {
    const window = getCurrentWindow()
    await window.hide().catch((e) => {
      console.error('Failed to hide window:', e)
    })
  }
})

onUnmounted(() => {
  unlistenFocus?.()
  if (onVisibilityChange) {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    onVisibilityChange = null
  }
})
</script>

<template>
  <ConfigGlobal :size="currentSize">
    <RouterView v-if="!isLocked" :class="greyMode ? `${prefixCls}-grey-mode` : ''" />
    <div v-else class="lock-screen">
      <div class="lock-card">
        <div class="lock-icon">✦</div>
        <h2 class="lock-title">{{ t('newLock.title') }}</h2>
        <p class="lock-sub">{{ t('newLock.subtitle') }}</p>
        <input
          ref="lockInputRef"
          class="lock-input"
          :class="{ error: lockError }"
          type="password"
          v-model="inputPassword"
          :placeholder="t('newLock.placeholder')"
          @keyup.enter="unlock"
        />
        <p v-if="lockError" class="lock-error">{{ t('newLock.error') }}</p>
        <button class="lock-btn" @click="unlock">{{ t('newLock.unlock') }}</button>
      </div>
    </div>
    <!-- 首次引导屏：解锁后显示（锁屏优先级更高） -->
    <OnboardingGuide v-if="!isLocked && showOnboarding" @finish="showOnboarding = false" />
  </ConfigGlobal>
</template>

<style lang="less">
@prefix-cls: ~'@{adminNamespace}-app';

.size {
  width: 100%;
  height: 100%;
}

html,
body {
  padding: 0 !important;
  margin: 0;
  overflow: hidden;
  .size;

  #app {
    .size;

    padding-top: var(--lt-safe-area-top, 0);
    padding-bottom: var(--lt-safe-area-bottom, 0);
    // Android edge-to-edge 安全区：原生侧把系统栏尺寸注入 --lt-safe-area-*（桌面端未注入，默认 0）
    box-sizing: border-box;
  }
}

.@{prefix-cls}-grey-mode {
  filter: grayscale(100%);
}

.lock-screen {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--theme-bg, #faf6f2);
  justify-content: center;
  align-items: center;
}

.lock-card {
  width: 340px;
  padding: 40px 36px;
  text-align: center;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-xl, 18px);
  box-shadow: var(--theme-shadow-md, 0 8px 32px rgb(0 0 0 / 10%));
  animation: lock-card-in 0.3s var(--theme-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

@keyframes lock-card-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.lock-icon {
  display: flex;
  width: 48px;
  height: 48px;
  margin: 0 auto 14px;
  font-size: 22px;
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 12%, transparent);
  border-radius: var(--theme-radius-round, 50%);
  align-items: center;
  justify-content: center;
}

.lock-title {
  margin: 0 0 6px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.lock-sub {
  margin: 0 0 20px;
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.lock-input {
  width: 100%;
  padding: 9px 16px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-tag, #f5ede6);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.lock-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.lock-input.error {
  border-color: var(--theme-color-danger, #e57373);
}

.lock-error {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--theme-color-danger, #e57373);
}

.lock-btn {
  width: 100%;
  padding: 9px 0;
  margin-top: 16px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-on-accent, #fff);
  cursor: pointer;
  background: var(--theme-accent-primary, #e8a0a0);
  border: none;
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
}

.lock-btn:hover {
  background: var(--theme-accent-hover, #c9955f);
  transform: translateY(-1px);
}
</style>
