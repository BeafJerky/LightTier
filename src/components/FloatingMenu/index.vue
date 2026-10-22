<template>
  <div class="fab-root" ref="fabRoot" @keydown.esc="handleEscape">
    <!-- 展开菜单 -->
    <Transition name="fab-menu">
      <div
        v-if="menuOpen"
        ref="menuRef"
        class="fab-menu"
        role="menu"
        :aria-label="t('newCommon.quickActions')"
      >
        <!-- 刷新配置 -->
        <button type="button" role="menuitem" class="fab-menu-item" @click="handleRefresh">
          <svg
            class="fab-menu-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>{{ t('newCommon.refreshConfig') }}</span>
        </button>
      </div>
    </Transition>

    <!-- 主按钮 -->
    <button
      ref="triggerRef"
      type="button"
      class="fab-trigger"
      :class="{ active: menuOpen }"
      @click.stop="toggleMenu"
      :title="t('newCommon.quickActions')"
      :aria-label="t('newCommon.quickActions')"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * FloatingMenu — 全局悬浮快捷菜单（FAB）
 *
 * 右下角悬浮主按钮，展开后提供“刷新配置”快捷操作：并发重载普通配置与 Web 配置
 * 文件列表，再触发当前页运行时状态刷新；菜单展开时点击组件外部自动收起，
 * 组件卸载时移除全局点击监听。
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEasyTierStore } from '@/store/modules/easytier'

defineOptions({ name: 'FloatingMenu' })

const { t } = useI18n()
const easyTierStore = useEasyTierStore()

const menuOpen = ref(false)
const fabRoot = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)

// 展开后聚焦首个菜单项：键盘用户可直接操作，Esc 也能从菜单内冒泡到根节点
const toggleMenu = async () => {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) return
  await nextTick()
  menuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
}

// Esc 关闭并把焦点还给主按钮；外部点击关闭时不抢焦点
const handleEscape = () => {
  if (!menuOpen.value) return
  menuOpen.value = false
  triggerRef.value?.focus()
}

// 刷新配置（重新加载所有配置文件 + 刷新当前页运行时状态）
const handleRefresh = async () => {
  menuOpen.value = false
  await Promise.all([easyTierStore.loadConfigFiles(), easyTierStore.loadWebConfigFiles()])
  easyTierStore.triggerPageRefresh()
}

// 点击外部关闭菜单
const handleOutsideClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (fabRoot.value && !fabRoot.value.contains(target)) {
    menuOpen.value = false
  }
}

onMounted(() => {
  // 全局监听点击，配合 contains 判断实现“点击外部收起”
  document.addEventListener('click', handleOutsideClick)
})

onBeforeUnmount(() => {
  // 卸载时移除监听，避免组件销毁后残留引用
  document.removeEventListener('click', handleOutsideClick)
})
</script>

<style scoped>
.fab-root {
  position: fixed;
  right: 24px;

  /* 避开 Android 手势条 / 底部安全区；桌面端该变量为 0，位置不变 */
  bottom: calc(24px + var(--lt-safe-area-bottom, 0px));
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-2);
}

/* 主按钮 */
.fab-trigger {
  display: flex;
  width: 40px;
  height: 40px;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-round, 50%);
  opacity: 0.65;
  box-shadow: var(--theme-shadow-sm);
  transition:
    opacity var(--theme-duration) var(--theme-ease-out),
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration-fast) var(--theme-ease-out),
    box-shadow var(--theme-duration) var(--theme-ease-out),
    transform var(--theme-duration) var(--theme-ease-out);
  align-items: center;
  justify-content: center;
}

.fab-root:hover .fab-trigger,
.fab-trigger:hover,
.fab-trigger:focus-visible,
.fab-trigger.active {
  opacity: 1;
}

.fab-trigger:focus-visible {
  outline: 2px solid var(--theme-accent-primary);
  outline-offset: 2px;
}

.fab-trigger:hover {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
  transform: scale(1.08);
  box-shadow: var(--theme-shadow-md);
}

.fab-trigger.active {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border-color: var(--theme-accent-primary);
}

/* 菜单面板 */
.fab-menu {
  display: flex;
  min-width: 160px;
  padding: var(--theme-space-1);
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-lg);
  box-shadow: var(--theme-shadow-md);
  flex-direction: column;
  gap: 2px;
  transform-origin: bottom center;
}

/* 菜单项 */
.fab-menu-item {
  display: flex;
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: var(--theme-space-2);
}

.fab-menu-item:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
}

.fab-menu-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.fab-menu-item:hover .fab-menu-icon {
  color: var(--theme-accent-primary);
  opacity: 1;
}

/* 菜单动画 */
.fab-menu-enter-active {
  transition:
    opacity var(--theme-duration) var(--theme-ease-out),
    transform var(--theme-duration) var(--theme-ease-out);
}

.fab-menu-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.fab-menu-enter-from,
.fab-menu-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

/* 触屏：没有 hover 可用于「唤起」，半透明会让入口几乎不可见；
   故常态即保持可见，并把尺寸提到 48dp 主操作按钮标准。
   桌面端（hover: hover）仍沿用 0.3 + 悬停显现的低干扰策略 */
@media (hover: none) {
  .fab-trigger {
    width: 48px;
    height: 48px;
    opacity: 0.9;
  }
}
</style>
