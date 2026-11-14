<!-- frontend/src/app/layout/island/IslandHost.vue -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIslandStore } from '@/shared/store/island'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useIslandBridge } from '@/shared/composables/useIslandBridge'
import { noticeDuration } from '@/shared/lib/island/queue'
import type { IslandAction } from '@/shared/lib/island/types'
import IslandFace from './IslandFace.vue'
import IslandCard from './IslandCard.vue'
import { useIslandMorph } from './useIslandMorph'

const props = withDefaults(defineProps<{ suspended?: boolean }>(), { suspended: false })
const emit = defineEmits<{
  'open-monitor': [configFileName?: string]
  'open-settings': [tab: 'about' | 'core']
  'open-overview': []
}>()

const { t } = useI18n()
const island = useIslandStore()
const easy = useEasyTierStore()
useIslandBridge()

const IDLE_WIDTH = 118
const IDLE_NARROW_WIDTH = 74
const DOT_WIDTH = 46
const COMPACT_WIDTH = 280
const CARD_WIDTH = 352
const BAR_HEIGHT = 40
const CARD_HEIGHT = 196

const rootRef = ref<HTMLElement | null>(null)
const hitRef = ref<HTMLButtonElement | null>(null)
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const peek = ref(false)
const paused = ref(false)
const systemReduced = ref(false)

let mediaQuery: MediaQueryList | null = null
let collapseTimer = 0
let feedbackTimer = 0
let removeOutsideListener: (() => void) | null = null

const onResize = () => {
  viewportWidth.value = window.innerWidth
}

const onMotionChange = () => {
  systemReduced.value = mediaQuery?.matches ?? false
}

const reducedMotion = computed(
  () =>
    island.settings.motion === 'reduced' ||
    (island.settings.motion === 'system' && systemReduced.value)
)

const initialIdleWidth =
  island.settings.idle === 'dot'
    ? DOT_WIDTH
    : viewportWidth.value < 560
      ? IDLE_NARROW_WIDTH
      : IDLE_WIDTH

const { setTarget } = useIslandMorph(rootRef, reducedMotion, initialIdleWidth, BAR_HEIGHT)

const narrow = computed(() => viewportWidth.value < 560)
const maxWidth = computed(() => Math.max(160, viewportWidth.value - 96))
const cardWidth = computed(() => Math.min(CARD_WIDTH, maxWidth.value))
const barWidth = computed(() => Math.min(COMPACT_WIDTH, maxWidth.value))

const idleWidth = computed(() => {
  if (island.settings.idle === 'dot') return DOT_WIDTH
  return narrow.value ? IDLE_NARROW_WIDTH : IDLE_WIDTH
})

const targetWidth = computed(() => {
  if (isCardMode.value) return cardWidth.value
  if (mode.value === 'compact') return Math.min(COMPACT_WIDTH, maxWidth.value)
  return Math.min(idleWidth.value, maxWidth.value)
})

const targetHeight = computed(() => (isCardMode.value ? CARD_HEIGHT : BAR_HEIGHT))

const mode = computed<'idle' | 'compact' | 'card' | 'overview'>(() => {
  if (island.expanded) return island.current ? 'card' : 'overview'
  if (island.current && peek.value && !island.settings.silent) return 'compact'
  return 'idle'
})

const isCardMode = computed(() => mode.value === 'card' || mode.value === 'overview')

const runningCount = computed(() => easy.runningList.length)

const health = computed<'idle' | 'healthy' | 'attention' | 'error'>(() => {
  if (island.hasError) return 'error'
  if (runningCount.value === 0) return 'idle'
  if (island.hasAttention) return 'attention'
  return 'healthy'
})

const badge = computed(() => {
  if (isCardMode.value || mode.value !== 'idle' || island.pendingCount === 0) return null
  return island.badgeType
})

const faceMood = computed<'calm' | 'sleepy' | 'happy' | 'worried' | 'excited' | 'concerned'>(() => {
  const type = island.current?.type
  if (type === 'error') return 'worried'
  if (type === 'update') return 'excited'
  if (type === 'quality') return 'concerned'
  if (type === 'feedback') return 'happy'
  return health.value === 'idle' ? 'sleepy' : 'calm'
})

const faceAnimate = computed(() => island.settings.face && !reducedMotion.value)

const shellStyle = computed(() => ({
  '--island-card-width': `${cardWidth.value}px`,
  '--island-card-height': `${CARD_HEIGHT}px`,
  '--island-bar-width': `${barWidth.value}px`
}))

const ariaLabel = computed(() => {
  const notice = island.current
  return notice
    ? t('newIsland.ariaNotice', { count: runningCount.value, title: notice.title })
    : t('newIsland.ariaIdle', { count: runningCount.value })
})

const politeAnnouncement = ref('')
const assertiveAnnouncement = ref('')
const announce = (previous: string, text: string) =>
  previous === `${text}\u00a0` ? text : `${text}\u00a0`

watch(
  () => [island.current?.id, island.current?.updatedAt] as const,
  () => {
    const notice = island.current
    if (!notice) return
    const text = notice.detail ? `${notice.title}，${notice.detail}` : notice.title
    if (notice.type === 'error') {
      assertiveAnnouncement.value = announce(assertiveAnnouncement.value, text)
    } else {
      politeAnnouncement.value = announce(politeAnnouncement.value, text)
    }
  }
)

function clearCollapse() {
  window.clearTimeout(collapseTimer)
  collapseTimer = 0
}

function scheduleCollapse() {
  clearCollapse()
  const notice = island.current
  if (!notice || paused.value || island.settings.silent || island.expanded) return
  collapseTimer = window.setTimeout(() => {
    collapseTimer = 0
    if (!paused.value && !island.expanded) peek.value = false
  }, noticeDuration(notice.type))
}

watch(
  () => [island.current?.id, island.current?.updatedAt] as const,
  ([id]) => {
    if (!id) {
      peek.value = false
      clearCollapse()
      return
    }
    if (island.settings.silent || island.expanded) {
      peek.value = false
      return
    }
    peek.value = true
    scheduleCollapse()
  },
  { immediate: true }
)

watch(
  () => [island.current?.id, island.current?.updatedAt] as const,
  ([id]) => {
    window.clearTimeout(feedbackTimer)
    feedbackTimer = 0
    const notice = island.current
    if (!id || !notice || notice.type !== 'feedback' || island.expanded) return
    // 反馈即使处于静默/点状模式也会自行退场，不把确认信息留成常驻角标
    feedbackTimer = window.setTimeout(() => {
      feedbackTimer = 0
      if (island.expanded || island.current?.id !== id) return
      island.dismiss(id)
    }, noticeDuration('feedback'))
  },
  { immediate: true }
)

watch(
  () => island.settings.silent,
  (silent) => {
    if (!silent) return
    peek.value = false
    clearCollapse()
  }
)

watch(
  () => island.settings.enabled,
  (enabled) => {
    if (enabled) return
    island.setExpanded(false)
    peek.value = false
    clearCollapse()
  }
)

watch(
  [targetWidth, targetHeight],
  ([nextWidth, nextHeight]) => {
    setTarget(nextWidth, nextHeight)
  },
  { immediate: true }
)

function pauseTimers() {
  paused.value = true
  clearCollapse()
}

function resumeTimers() {
  paused.value = false
  if (peek.value) scheduleCollapse()
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && rootRef.value?.contains(next)) return
  resumeTimers()
}

function open() {
  island.setExpanded(true)
  peek.value = false
  clearCollapse()
  // 指针与键盘都移焦到卡片首个按钮：Esc 才能从卡片冒泡到外壳，
  // 关闭时也能把焦点还给胶囊。
  void nextTick(() => {
    rootRef.value?.querySelector<HTMLElement>('.island-card button')?.focus()
  })
}

function activate() {
  open()
}

function collapse() {
  const hadFocus = Boolean(rootRef.value?.contains(document.activeElement))
  const notice = island.current
  island.setExpanded(false)
  peek.value = false
  clearCollapse()
  // 操作反馈是一次性确认：收起即清除；其余类型保留角标等待处理或忽略
  if (notice?.type === 'feedback') island.dismiss(notice.id)
  if (hadFocus) {
    void nextTick(() => hitRef.value?.focus())
  }
}

function dismissCurrent() {
  const id = island.current?.id
  if (id) island.dismiss(id)
}

// “忽略”会真正清除当前通知；队列里还有下一条就继续展示
function dismissAndAdvance() {
  dismissCurrent()
  if (island.current) open()
  else collapse()
}

function onEsc() {
  if (!island.expanded) return
  collapse()
}

function handleAction(action: IslandAction) {
  if (action.kind === 'open-monitor') emit('open-monitor', action.configFileName)
  else if (action.kind === 'open-settings') emit('open-settings', action.tab)
  else {
    dismissCurrent()
    return
  }
  collapse()
}

// 概览卡“打开总览”：先交给布局跳转，再收起卡片
function openOverview() {
  emit('open-overview')
  collapse()
}

function onOutsidePointer(event: PointerEvent) {
  if (!island.expanded) return
  if (rootRef.value?.contains(event.target as Node)) return
  collapse()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  systemReduced.value = mediaQuery.matches
  mediaQuery.addEventListener('change', onMotionChange)

  const listener = (event: PointerEvent) => onOutsidePointer(event)
  document.addEventListener('pointerdown', listener, true)
  removeOutsideListener = () => document.removeEventListener('pointerdown', listener, true)

  if (import.meta.env.DEV) {
    ;(window as unknown as { __lighttierIsland?: unknown }).__lighttierIsland = {
      store: island,
      notify: island.notify,
      expand: () => island.setExpanded(true),
      collapse: () => island.setExpanded(false)
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  mediaQuery?.removeEventListener('change', onMotionChange)
  removeOutsideListener?.()
  clearCollapse()
  window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <div
    v-if="island.settings.enabled && !props.suspended"
    ref="rootRef"
    class="island-root"
    :class="[`is-${mode}`, `health-${health}`, { 'is-card-shape': isCardMode }]"
    :style="shellStyle"
    :data-motion="reducedMotion ? 'reduced' : 'full'"
    @pointerenter="pauseTimers"
    @pointerleave="resumeTimers"
    @focusin="pauseTimers"
    @focusout="onFocusOut"
    @keydown.esc="onEsc"
  >
    <button
      v-if="!isCardMode"
      ref="hitRef"
      type="button"
      class="island-hit"
      :aria-label="ariaLabel"
      :aria-expanded="island.expanded"
      @click="activate"
    ></button>

    <div class="island-bar" :class="{ 'is-visible': !isCardMode }" aria-hidden="true">
      <IslandFace :mood="faceMood" :animate="faceAnimate" />
      <template v-if="mode === 'idle'">
        <span class="island-count">{{ runningCount }}</span>
        <span v-if="!narrow && island.settings.idle === 'count'" class="island-label">
          {{ t('newIsland.running') }}
        </span>
      </template>
      <template v-else>
        <span class="island-title">{{ island.current?.title }}</span>
        <span v-if="island.queueLength" class="island-more">+{{ island.queueLength }}</span>
      </template>
    </div>

    <svg
      v-if="mode === 'idle'"
      class="island-chevron"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
    <span v-if="badge" class="island-badge" :class="`badge-${badge}`">
      {{ island.pendingCount }}
    </span>

    <Transition name="island-card-fade">
      <div v-if="isCardMode" class="island-card-wrap">
        <IslandCard
          :kind="mode === 'overview' ? 'overview' : 'notice'"
          :notice="island.current"
          :instances="easy.runningList"
          :summary="easy.monitorSummaryMap"
          :pending-count="island.pendingCount"
          @close="collapse"
          @dismiss="dismissAndAdvance"
          @action="handleAction"
          @overview="openOverview"
        />
      </div>
    </Transition>

    <div class="island-sr" role="status" aria-live="polite">{{ politeAnnouncement }}</div>
    <div class="island-sr" role="alert" aria-live="assertive">
      {{ assertiveAnnouncement }}
    </div>
  </div>
</template>

<style scoped>
.island-root {
  position: fixed;
  right: calc(24px + 40px + 12px);
  bottom: calc(24px + var(--lt-safe-area-bottom, 0px));
  z-index: 8900;
  overflow: hidden;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  color: var(--theme-text-primary, #4a3728);
  background: linear-gradient(
    180deg,
    rgb(var(--theme-bg-card-rgb, 255, 255, 255), 0.96),
    rgb(var(--theme-bg-rgb, 253, 248, 244), 0.94)
  );
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: 999px;
  box-shadow:
    0 10px 30px rgb(var(--theme-text-primary-rgb, 74, 55, 40), 0.08),
    inset 0 1px 0 rgb(255 255 255, 90%);
  backdrop-filter: blur(14px) saturate(1.1);
  contain: layout paint;
  transition:
    border-radius 500ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 200ms ease,
    opacity 200ms ease;
}

.island-root.is-card-shape {
  border-radius: 18px;
}

/* 内容层按目标尺寸固定排版，外壳只负责裁切，避免形变时文字逐帧重排 */
.island-bar {
  position: absolute;
  top: 50%;
  left: 0;
  display: flex;
  width: var(--island-bar-width, 280px);
  height: 40px;
  padding: 0 12px;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
  gap: 7px;
  align-items: center;
}

.island-bar.is-visible {
  opacity: 1;
}

.island-hit {
  position: absolute;
  inset: 0;
  z-index: 3;
  padding: 0;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: inherit;
}

.island-hit::after {
  position: absolute;
  border-radius: inherit;
  content: '';
  inset: -3px;
}

.island-hit:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: -3px;
}

.island-count {
  margin-left: 1px;
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.island-label {
  overflow: hidden;
  font-size: 11px;
  font-weight: 500;
  color: var(--theme-text-secondary, #756a5b);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-chevron {
  position: absolute;
  top: 50%;
  right: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  opacity: 0;
  transform: translateY(-50%) translateX(-2px);
  transition:
    opacity 180ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* 悬停箭头：与原型一致，默认让位给“运行中”文案 */
.island-root:hover .island-chevron,
.island-root:focus-within .island-chevron {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .island-chevron {
    transition-duration: 120ms;
  }
}

.island-title {
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-more {
  flex: 0 0 auto;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-secondary, #756a5b);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: 999px;
}

.island-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  height: 14px;
  min-width: 14px;
  padding: 0 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: var(--theme-color-error, #d97b7b);
  border: 1.5px solid var(--theme-bg-card, #fff);
  border-radius: 999px;
  place-items: center;
  font-variant-numeric: tabular-nums;
}

.island-badge.badge-update {
  background: var(--theme-accent-secondary, #b8a9c9);
}

.island-badge.badge-quality {
  color: #3b2a1a;
  background: var(--theme-color-warning, #e6a23c);
}

.island-badge.badge-feedback {
  background: var(--theme-color-success, #7fba8a);
}

.island-card-wrap {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--island-card-width, 352px);
  height: var(--island-card-height, 196px);
}

.island-card-fade-enter-active,
.island-card-fade-leave-active {
  transition: opacity 160ms ease;
}

.island-card-fade-enter-from,
.island-card-fade-leave-to {
  opacity: 0;
}

.island-health-error .island-badge {
  box-shadow: 0 0 0 2px rgb(var(--theme-color-error-rgb, 217, 123, 123), 0.16);
}

.island-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.island-root[data-motion='reduced'] {
  transition:
    border-radius 120ms ease-out,
    opacity 120ms ease-out;
}

.island-root[data-motion='reduced'] .island-face,
.island-root[data-motion='reduced'] .island-face-eye {
  animation: none;
}

.island-root[data-motion='reduced'] .island-bar,
.island-root[data-motion='reduced'] .island-card-fade-enter-active,
.island-root[data-motion='reduced'] .island-card-fade-leave-active {
  transition-duration: 120ms;
}

@media (width <= 560px) {
  .island-root {
    right: calc(16px + 48px + 10px);
    bottom: calc(16px + var(--lt-safe-area-bottom, 0px));
  }

  .island-bar {
    padding: 0 10px;
  }

  .island-chevron {
    right: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .island-bar,
  .island-card-fade-enter-active,
  .island-card-fade-leave-active {
    transition-duration: 120ms;
  }
}
</style>
