<template>
  <div
    class="og-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="og-title"
    @keydown="handleKeydown"
  >
    <div ref="cardRef" class="og-card" tabindex="-1">
      <!-- 步骤内容 -->
      <Transition name="og-step" mode="out-in">
        <div :key="step" class="og-body">
          <!-- 第 1 步：欢迎 -->
          <div v-if="step === 1" class="og-welcome">
            <div class="og-logo">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              >
                <circle cx="6" cy="6" r="2.6" />
                <circle cx="18" cy="6" r="2.6" />
                <circle cx="12" cy="18" r="2.6" />
                <path d="M8.4 7.3l3.3 8.3M15.6 7.3l-3.3 8.3" />
              </svg>
            </div>
            <h2 id="og-title" class="og-title">{{ t('newOnboarding.welcomeTitle') }}</h2>
            <p class="og-desc">{{ t('newOnboarding.welcomeDesc') }}</p>
          </div>

          <!-- 第 2 步：核心功能简介 -->
          <div v-else-if="step === 2" class="og-features">
            <h2 id="og-title" class="og-title">{{ t('newOnboarding.featuresTitle') }}</h2>
            <p class="og-sub">{{ t('newOnboarding.featuresDesc') }}</p>
            <div class="og-feature-grid">
              <div v-for="f in features" :key="f.title" class="og-feature">
                <div class="og-feature-icon" v-html="f.icon"></div>
                <div class="og-feature-text">
                  <div class="og-feature-title">{{ f.title }}</div>
                  <div class="og-feature-desc">{{ f.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 第 3 步：内核获取方式（桌面按需下载，Android 编译期内置） -->
          <div v-else-if="step === 3" class="og-install">
            <div class="og-badge">
              {{
                isAndroidPlatform
                  ? t('newOnboarding.androidBuiltinBadge')
                  : t('newOnboarding.coreSetupBadge')
              }}
            </div>
            <h2 id="og-title" class="og-title">{{
              isAndroidPlatform
                ? t('newOnboarding.androidBuiltinTitle')
                : t('newOnboarding.coreSetupTitle')
            }}</h2>
            <p class="og-desc">{{
              isAndroidPlatform
                ? t('newOnboarding.androidBuiltinDesc')
                : t('newOnboarding.coreSetupDesc')
            }}</p>
          </div>

          <!-- 第 4 步：完成 -->
          <div v-else class="og-done">
            <div class="og-done-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
            </div>
            <h2 id="og-title" class="og-title">{{ t('newOnboarding.doneTitle') }}</h2>
            <p class="og-desc">{{
              isAndroidPlatform
                ? t('newOnboarding.androidDoneDesc')
                : easyTierStore.detectedCoreVersion
                  ? t('newOnboarding.installDoneDesc')
                  : t('newOnboarding.corePendingDesc')
            }}</p>
          </div>
        </div>
      </Transition>

      <!-- 底部操作区 -->
      <div class="og-footer">
        <template v-if="step < 4">
          <div class="og-dots">
            <button
              v-for="i in 4"
              :key="i"
              type="button"
              class="og-dot-btn"
              :disabled="i === 4"
              :aria-label="t('newOnboarding.stepLabel', { n: i })"
              :aria-current="i === step ? 'step' : undefined"
              @click="goToStep(i)"
            >
              <span class="og-dot" :class="{ active: i === step }"></span>
            </button>
          </div>
          <div class="og-footer-actions">
            <button v-if="step > 1" type="button" class="og-btn og-btn-ghost" @click="step--">
              {{ t('newOnboarding.prev') }}
            </button>
            <button type="button" class="og-btn og-btn-primary" @click="step++">
              {{ t('newOnboarding.next') }}
            </button>
          </div>
        </template>
        <template v-else>
          <label class="og-check">
            <input v-model="notShowAgain" type="checkbox" />
            <span>{{ t('newOnboarding.notShowAgain') }}</span>
          </label>
          <div class="og-footer-actions">
            <button v-if="!hasConfigs" type="button" class="og-btn og-btn-ghost" @click="finish">
              {{ t('newOnboarding.doneBtn') }}
            </button>
            <button
              type="button"
              class="og-btn og-btn-primary"
              @click="hasConfigs ? finish() : finishAndCreate()"
            >
              {{ hasConfigs ? t('newOnboarding.doneBtn') : t('newOnboarding.createFirst') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * OnboardingGuide — 首次启动引导（4 步流程）
 *
 * 步骤：1 欢迎 → 2 功能简介 → 3 内核获取方式（桌面按需下载，Android 编译期内置）
 * → 4 完成；桌面内核不再随安装包内置，第 3 步仅说明获取入口，不执行安装。
 * 结束时勾选“下次不再显示”则写入 localStorage（settings.onboardingDone）持久化，
 * finish 事件交由父组件控制显隐。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useEasyTierStore } from '@/store/modules/easytier'
import { isAndroid } from '@/utils/platformUtil'

const emit = defineEmits<{ finish: [] }>()

const { t } = useI18n()
const router = useRouter()
const easyTierStore = useEasyTierStore()

// 当前步骤（1-4）；圆点仅允许在 1–3 步之间跳转，第 4 步通过底部“下一步”到达
const step = ref(1)
// Android：内核编译期内置，无需下载安装
const isAndroidPlatform = isAndroid()
// 是否已有配置：决定完成页主 CTA（创建第一个配置 / 结束引导）
const hasConfigs = computed(() => easyTierStore.configList.length > 0)
// 下次不再显示（默认勾选：完成引导后不再出现，取消勾选则每次启动显示）
const notShowAgain = ref(true)

// 焦点管理：打开时记录来源并聚焦引导卡片，关闭时还原
const cardRef = ref<HTMLElement | null>(null)
let prevFocus: HTMLElement | null = null

// 核心功能简介（以快速上手为目标）；Web 配置与 Windows 服务仅桌面端，Android 展示主题与锁屏
const features = computed(() => {
  const common = [
    {
      title: t('newOnboarding.feature1Title'),
      desc: t('newOnboarding.feature1Desc'),
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 7.2l3.4 8.5M15.7 7.2l-3.4 8.5"/></svg>'
    },
    {
      title: t('newOnboarding.feature2Title'),
      desc: t('newOnboarding.feature2Desc'),
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V12M12 20V5M19 20v-6"/></svg>'
    }
  ]
  const platform = isAndroidPlatform
    ? [
        {
          title: t('newOnboarding.androidThemeTitle'),
          desc: t('newOnboarding.androidThemeDesc'),
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
        },
        {
          title: t('newOnboarding.androidLockTitle'),
          desc: t('newOnboarding.androidLockDesc'),
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
        }
      ]
    : [
        {
          title: t('newOnboarding.feature3Title'),
          desc: t('newOnboarding.feature3Desc'),
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>'
        },
        {
          title: t('newOnboarding.feature4Title'),
          desc: t('newOnboarding.feature4Desc'),
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>'
        }
      ]
  return [...common, ...platform]
})

// 圆点跳转：只允许 1–3 步，第 4 步通过底部“下一步”到达
const goToStep = (i: number) => {
  if (i >= 1 && i <= 3) step.value = i
}

// 键盘焦点圈定：Tab/Shift+Tab 在引导卡片内循环，不逃逸到背景页面
const getFocusable = (): HTMLElement[] => {
  const root = cardRef.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab') return
  const root = cardRef.value
  if (!root) return
  const items = getFocusable()
  if (!items.length) {
    e.preventDefault()
    root.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!root.contains(active)) {
    e.preventDefault()
    first.focus()
    return
  }
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

// 按勾选状态持久化：勾选记为已完成；取消勾选则移除标记，下次启动仍显示
const persistOnboardingChoice = () => {
  if (notShowAgain.value) {
    localStorage.setItem('settings.onboardingDone', 'true')
  } else {
    localStorage.removeItem('settings.onboardingDone')
  }
}

// 结束引导
const finish = () => {
  persistOnboardingChoice()
  emit('finish')
}

// 结束引导并直达新建配置（桌面进入配置列表并打开新增弹窗，Android 进入新增页）
const finishAndCreate = () => {
  persistOnboardingChoice()
  emit('finish')
  router.push(isAndroidPlatform ? '/new/config-add' : '/new/config?create=1')
}

onMounted(() => {
  prevFocus = document.activeElement as HTMLElement | null
  // 完成页需要判断是否已有配置；尚未加载时补一次
  if (!easyTierStore.configListLoaded) {
    easyTierStore.loadConfigFiles()
  }
  nextTick(() => cardRef.value?.focus())
})

// 关闭引导后把焦点还原到打开前的元素
onBeforeUnmount(() => {
  prevFocus?.focus?.()
})
</script>

<style scoped>
.og-overlay {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9000;
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--theme-bg, #fdf8f4);
  justify-content: center;
  align-items: center;
}

.og-card {
  display: flex;
  flex-direction: column;
  width: 520px;
  max-width: calc(100vw - 64px);
  min-height: 380px;
  padding: 36px 40px 24px;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-xl, 18px);
  box-shadow: var(--theme-shadow-md, 0 12px 36px rgb(74 55 40 / 7%));
  animation: og-card-in var(--theme-duration-slow) var(--theme-ease-out);
}

/* 容器仅作为程序化焦点落点，不显示焦点环 */
.og-card:focus {
  outline: none;
}

@keyframes og-card-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.og-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* 步骤切换动画 */
.og-step-enter-active {
  transition:
    opacity var(--theme-duration) var(--theme-ease-out),
    transform var(--theme-duration) var(--theme-ease-out);
}

.og-step-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.og-step-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.og-step-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

/* 第 1 步：欢迎 */
.og-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
}

.og-logo {
  display: flex;
  width: 64px;
  height: 64px;
  margin-bottom: 20px;
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 12%, transparent);
  border-radius: var(--theme-radius-round, 50%);
  align-items: center;
  justify-content: center;
}

.og-logo svg {
  width: 34px;
  height: 34px;
}

/* 第 2 步：功能简介 */
.og-features {
  width: 100%;
}

.og-features .og-title,
.og-features .og-sub {
  text-align: center;
}

.og-sub {
  margin: 0 0 22px;
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.og-feature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.og-feature {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: var(--theme-radius-md, 12px);
  align-items: flex-start;
}

.og-feature-icon {
  display: flex;
  width: 36px;
  height: 36px;
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 12%, transparent);
  border-radius: var(--theme-radius-sm, 10px);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.og-feature-icon svg {
  width: 20px;
  height: 20px;
}

.og-feature-title {
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.og-feature-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-secondary, #7a6e5e);
}

/* 第 3 步：安装核心 */
.og-install {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
}

.og-badge {
  padding: 5px 16px;
  margin-bottom: 16px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 14%, transparent);
  border-radius: var(--theme-radius-pill, 100px);
}

/* 第 4 步：完成 */
.og-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
}

.og-done-icon {
  display: flex;
  width: 56px;
  height: 56px;
  margin-bottom: 16px;
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 14%, transparent);
  border-radius: var(--theme-radius-round, 50%);
  align-items: center;
  justify-content: center;
}

.og-done-icon svg {
  width: 28px;
  height: 28px;
}

/* 通用标题与描述 */
.og-title {
  margin: 0 0 8px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.og-desc {
  max-width: 380px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--theme-text-secondary, #7a6e5e);
}

/* 底部操作区 */
.og-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid var(--theme-border-light, #f5ede6);
}

.og-dots {
  display: flex;
  gap: 0;
}

/* 圆点按钮：视觉保持 8px 圆点，命中区扩大到 32×32（键盘可聚焦） */
.og-dot-btn {
  display: flex;
  width: 32px;
  height: 32px;
  padding: 0;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  align-items: center;
  justify-content: center;
}

/* 第 4 步不能直接点击，保留进度指示 */
.og-dot-btn:disabled {
  cursor: default;
}

.og-dot {
  width: 8px;
  height: 8px;
  background: var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-round, 50%);
  transition:
    width var(--theme-duration) var(--theme-ease-out),
    background-color var(--theme-duration) var(--theme-ease-out),
    border-radius var(--theme-duration) var(--theme-ease-out);
}

.og-dot.active {
  width: 22px;
  background: var(--theme-accent-primary, #e8a0a0);
  border-radius: var(--theme-radius-pill, 100px);
}

.og-footer-actions {
  display: flex;
  gap: 10px;
}

/* 按钮 */
.og-btn {
  padding: 8px 22px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill, 100px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration-fast) var(--theme-ease-out),
    transform var(--theme-duration-fast) var(--theme-ease-out),
    opacity var(--theme-duration-fast) var(--theme-ease-out);
}

.og-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.og-btn-primary {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #e8a0a0);
}

.og-btn-primary:hover:not(:disabled) {
  background: var(--theme-accent-hover, #d49090);
  transform: translateY(-1px);
}

.og-btn-ghost {
  color: var(--theme-text-secondary, #7a6e5e);
  background: transparent;
  border: 1px solid var(--theme-border, #ede4db);
}

.og-btn-ghost:hover:not(:disabled) {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

/* 单选框 */
.og-check {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  user-select: none;
}

.og-check input {
  accent-color: var(--theme-accent-primary, #e8a0a0);
  cursor: pointer;
}
</style>
