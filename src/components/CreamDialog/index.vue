<template>
  <Teleport to="body" :disabled="inline">
    <Transition name="cd" :css="!inline">
      <div
        v-if="visible"
        ref="overlayRef"
        class="cd-overlay"
        :class="{ 'cd-overlay-inline': inline, 'cd-overlay-sheet': sheetMode }"
        @click.self="handleOverlayClick"
        @keydown.escape="requestClose"
        @keydown="handleKeydown"
        tabindex="-1"
      >
        <div
          class="cd-dialog"
          :class="{ 'cd-dialog-inline': inline, 'cd-dialog-sheet': sheetMode }"
          :style="
            inline || sheetMode
              ? undefined
              : {
                  width: typeof width === 'number' ? width + 'px' : width,
                  height: typeof height === 'number' ? height + 'px' : height
                }
          "
          :role="inline ? undefined : 'dialog'"
          :aria-modal="inline ? undefined : 'true'"
          :aria-label="inline ? undefined : title"
        >
          <!-- 标题栏（内联模式由所在页面承载标题与返回，不渲染） -->
          <div v-if="!inline" class="cd-header">
            <span class="cd-title">{{ title }}</span>
            <button class="cd-close" @click="requestClose" :title="t('newCommon.close')">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容区（内容自行管理滚动时可关闭 body 滚动） -->
          <div class="cd-body" :class="{ 'cd-body-no-scroll': !bodyScroll && !sheetMode }">
            <slot></slot>
          </div>

          <!-- 底部 -->
          <div v-if="$slots.footer" class="cd-footer"><slot name="footer"></slot></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
/**
 * CreamDialog — 通用弹窗组件（桌面居中弹窗 / Android 底部动作面板 / 内联卡片三形态）
 *
 * 形态切换：
 * - 桌面：Teleport 到 body + 半透明遮罩 + 居中卡片，带 role="dialog" / aria-modal 语义；
 * - Android（非内联）：呈现为底部动作面板，打开时向 history 注入同 URL 条目，
 *   物理返回键优先关闭面板而非离开页面（由下方模块级共享栈协调多面板嵌套）；
 * - 内联模式（inline）：不渲染 Teleport / 遮罩 / 标题栏，作为页面级卡片嵌入文档流
 *   （移动端二级页面用，标题与返回由所在页面承载）。
 *
 * 交互：遮罩点击（closeOnOverlay）与 Esc 键均可关闭（内联模式除外）；
 * 键盘无障碍：打开聚焦遮罩层（Esc 可用）、Tab 圈定在弹窗内、关闭还原到打开前焦点；
 * 顶部/底部留白叠加 --lt-safe-area-* 安全区变量（桌面端为 0）。
 * 滚动：应用外壳 html/body 为 overflow:hidden（内容区自行滚动），遮罩铺满视口即天然阻止背景滚动。
 */
// Android 底部动作面板：模块级共享的 history 注入栈（物理返回键仅关闭最顶层面板）
interface SheetHistoryEntry {
  isPushed: () => boolean
  close: () => void
}
const sheetStack: SheetHistoryEntry[] = []
// 面板经由界面按钮关闭时自行弹出历史条目，标记跳过随之而来的 popstate
let sheetPopping = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (sheetPopping) {
      sheetPopping = false
      return
    }
    const top = sheetStack[sheetStack.length - 1]
    if (top?.isPushed()) top.close()
  })
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAndroid } from '@/utils/platformUtil'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    width?: string | number
    // 桌面弹窗高度：短窗口由 .cd-dialog 的 max-height 兜底收缩
    height?: string | number
    // body 是否滚动：默认 true；内容区自行管理滚动时传 false，避免嵌套滚动
    bodyScroll?: boolean
    closeOnOverlay?: boolean
    // 内联模式：不渲染 Teleport 遮罩与标题栏，作为页面级卡片嵌入文档流（移动端二级页面用）
    inline?: boolean
    // 关闭守卫：返回 false（或 resolve false）时取消本次关闭（未保存保护等）
    beforeClose?: () => boolean | Promise<boolean>
  }>(),
  {
    title: '',
    width: 600,
    height: undefined,
    bodyScroll: true,
    closeOnOverlay: true,
    inline: false,
    beforeClose: undefined
  }
)

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

// 内部可见态：与 v-model 双向同步（本地先变更，再经 watch 回传父组件）
const visible = ref(props.modelValue)
const overlayRef = ref<HTMLElement>()
// 打开前的焦点元素（关闭后还原，避免焦点丢失到 body）
let prevActive: HTMLElement | null = null
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
  if (props.inline) return
  if (v) {
    // 桌面弹窗打开后聚焦遮罩层（Esc 键关闭可用），并记住原焦点以便关闭后还原
    prevActive = document.activeElement as HTMLElement | null
    nextTick(() => overlayRef.value?.focus())
  } else if (prevActive) {
    // 原元素可能已随页面卸载，仅对仍在文档中的元素还原焦点
    if (prevActive.isConnected) prevActive.focus()
    prevActive = null
  }
})

// Tab 焦点圈定：键盘导航不逃逸到弹窗外的页面内容（内联形态即页面内容，不圈定）
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || props.inline) return
  const root = overlayRef.value
  if (!root) return
  const focusables = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = active ? root.contains(active) : false
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault()
      last.focus()
    }
  } else if (!inside || active === last) {
    e.preventDefault()
    first.focus()
  }
}

const handleOverlayClick = () => {
  // 内联模式无遮罩层，点击空白不触发关闭（避免页面留白区域误关）
  if (props.closeOnOverlay && !props.inline) void requestClose()
}

// 关闭守卫执行器：异步守卫期间忽略重复关闭请求
const closing = ref(false)
const canClose = async (): Promise<boolean> => {
  if (closing.value) return false
  if (!props.beforeClose) return true
  closing.value = true
  try {
    return await props.beforeClose()
  } catch {
    // 守卫自身异常时不关闭，避免误丢数据
    return false
  } finally {
    closing.value = false
  }
}

// 统一关闭入口：遮罩 / Esc / 标题栏 / 父组件按钮都走这里
const requestClose = async () => {
  if (!(await canClose())) return
  visible.value = false
}

// 供父组件（如底部取消按钮）调用，确保同样经过关闭守卫
defineExpose({ requestClose })

// Android：非内联弹窗呈现为底部动作面板（贴合移动端设计语言）
const isAndroidPlatform = isAndroid()
const sheetMode = computed(() => isAndroidPlatform && !props.inline)

let sheetPushed = false
const dropSheetEntry = () => {
  const i = sheetStack.indexOf(sheetEntry)
  if (i >= 0) sheetStack.splice(i, 1)
}
const sheetEntry: SheetHistoryEntry = {
  isPushed: () => sheetPushed,
  close: async () => {
    // 物理返回键消费：历史条目已被系统弹出，无需再 back()
    sheetPushed = false
    dropSheetEntry()
    if (!(await canClose())) {
      // 守卫取消关闭：补回 history 条目，保持“返回键关闭面板”的语义
      if (!sheetPushed) {
        sheetPushed = true
        sheetStack.push(sheetEntry)
        window.history.pushState({ ...(window.history.state || {}), ltSheet: true }, '')
      }
      return
    }
    visible.value = false
  }
}

// 面板打开时向 history 注入同 URL 条目：返回键优先关闭面板而不是离开页面
watch(visible, (v) => {
  if (!sheetMode.value) return
  if (v && !sheetPushed) {
    sheetPushed = true
    sheetStack.push(sheetEntry)
    window.history.pushState({ ...(window.history.state || {}), ltSheet: true }, '')
  } else if (!v && sheetPushed) {
    // 界面内关闭（按钮/遮罩）：回收注入的历史条目
    sheetPushed = false
    dropSheetEntry()
    sheetPopping = true
    window.history.back()
  }
})

// 卸载兜底：面板未关闭即随页面卸载时回收历史条目
onUnmounted(() => {
  if (!sheetPushed) return
  sheetPushed = false
  dropSheetEntry()
  sheetPopping = true
  window.history.back()
})
</script>

<style scoped>
.cd-overlay {
  /* 弹窗可用高度 = 视口 - 上下留白；顶部叠加 Android 状态栏安全区（桌面端为 0） */
  --cd-overlay-top: calc(8vh + var(--lt-safe-area-top, 0px));
  --cd-overlay-bottom: calc(40px + var(--lt-safe-area-bottom, 0px));

  position: fixed;
  z-index: 2000;
  display: flex;
  padding-top: var(--cd-overlay-top);
  overflow-y: auto;
  background: var(--el-overlay-color, rgb(0 0 0 / 50%));
  inset: 0;
  align-items: flex-start;
  justify-content: center;
}

.cd-dialog {
  display: flex;
  max-height: calc(100vh - var(--cd-overlay-top) - var(--cd-overlay-bottom));
  min-height: 0;

  /* 底部留白叠加手势导航条安全区（桌面端变量为 0） */
  margin-bottom: var(--cd-overlay-bottom);
  background: var(--theme-bg-card, #fff);
  border-radius: var(--theme-radius-xl, 18px);
  box-shadow: var(--theme-shadow-md, 0 20px 60px rgb(0 0 0 / 12%));
  flex-direction: column;
}

.cd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--theme-space-5) var(--theme-space-6) 0;
  flex-shrink: 0;
}

.cd-title {
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.cd-close {
  display: flex;
  width: 28px;
  height: 28px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-round, 50%);
  transition: all 0.2s;
  align-items: center;
  justify-content: center;
}

.cd-close:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.cd-body {
  display: flex;
  height: 0;
  min-height: 0;
  padding: var(--theme-space-5) var(--theme-space-6);
  overflow-y: auto;
  flex: 1;
  flex-direction: column;
  overscroll-behavior: contain;
}

/* 内容自行管理滚动（如设置页的导航 + 内容区）：body 只负责撑满高度 */
.cd-body-no-scroll {
  overflow: hidden;
}

.cd-body::-webkit-scrollbar {
  width: 4px;
}

.cd-body::-webkit-scrollbar-track {
  background: transparent;
}

.cd-body::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.cd-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--theme-space-4) var(--theme-space-6);
  border-top: 1px solid var(--theme-border-light, #f5ede6);
  flex-shrink: 0;
}

/* 动画 */
.cd-enter-active {
  transition: all 0.3s var(--theme-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.cd-leave-active {
  transition: all 0.2s ease;
}

.cd-enter-from {
  opacity: 0;
}

.cd-enter-from .cd-dialog {
  transform: translateY(20px) scale(0.97);
}

.cd-leave-to {
  opacity: 0;
}

.cd-leave-to .cd-dialog {
  transform: translateY(-10px) scale(0.97);
}

/* 移动端（含 Android）：弹窗收窄为近全屏并适配系统栏安全区 */
@media (width <= 640px) {
  .cd-overlay {
    --cd-overlay-top: calc(16px + var(--lt-safe-area-top, 0px));
    --cd-overlay-bottom: calc(16px + var(--lt-safe-area-bottom, 0px));

    padding-top: var(--cd-overlay-top);
    padding-bottom: var(--cd-overlay-bottom);
  }

  .cd-dialog {
    /* 约束内联 width（如 800px）不超过视口 */
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - var(--cd-overlay-top) - var(--cd-overlay-bottom));
    margin-bottom: 0;
  }
}

/* 内联模式（移动端二级页面）：去遮罩/去 Teleport，作为页面级卡片占满父容器 */
.cd-overlay-inline {
  position: static;
  display: block;
  height: 100%;
  padding: 0;
  overflow: visible;
  background: transparent;
}

.cd-dialog-inline {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: none;
  margin-bottom: 0;
  border: 1px solid var(--theme-border-light, #f5ede6);
  box-shadow: none;
}

/* Android 端（cd-*-sheet）：非内联弹窗呈现为底部动作面板 */
.cd-overlay-sheet {
  align-items: flex-end;
  padding: 0;
}

.cd-dialog-sheet {
  /* 覆盖 .cd-dialog 基础宽度与 640px 媒体查询的视口约束 */
  width: 100%;
  max-width: 100%;
  max-height: calc(100vh - var(--lt-safe-area-top, 0px) - 24px);

  /* 底部内边距承载手势导航条安全区 */
  padding-bottom: var(--lt-safe-area-bottom, 0);
  margin-bottom: 0;
  border-radius: var(--theme-radius-xl, 18px) var(--theme-radius-xl, 18px) 0 0;
}

.cd-enter-from .cd-dialog-sheet {
  transform: translateY(100%);
}

.cd-leave-to .cd-dialog-sheet {
  transform: translateY(100%);
}
</style>
