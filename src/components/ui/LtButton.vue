<script setup lang="ts">
/**
 * LtButton — Naive UI Button 的项目级封装
 *
 * 以 NButton 作为交互基座（键盘、禁用、loading、焦点语义），视觉统一由
 * variant / size / circle 控制，颜色与圆角全部取自 --theme-* 语义变量。
 * bare 变体保留旧页面自有样式能力，用于导航项、列表行等结构型按钮。
 */
import { computed } from 'vue'
import { NButton } from 'naive-ui'

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'text'
  | 'success'
  | 'success-soft'
  | 'soft'
  | 'danger'
  | 'bare'
type Size = 'xs' | 'compact' | 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    circle?: boolean
    block?: boolean
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    circle: false,
    block: false,
    loading: false,
    disabled: false,
    type: 'button'
  }
)

const classes = computed(() => [
  'lt-btn',
  `lt-btn--${props.variant}`,
  `lt-btn--${props.size}`,
  {
    'lt-btn--circle': props.circle,
    'lt-btn--block': props.block
  }
])

/**
 * 指针点击后 WebView 会把焦点留在按钮上，Naive 的 focus 状态会改写配色（透明底 + 强调色文字），
 * 裸按钮还会覆盖页面自定义颜色，表现为“松手后仍是按下态”。
 * 延后一拍失焦，让弹窗等副作用先记录触发元素；触屏合成的 mousedown 也在 click 之前完成。
 * 被取消的指针手势（拖拽滚动）由 main.ts 的 pointerup / pointercancel 兜底。
 * 键盘激活（detail === 0）不处理，保留焦点与 focus-visible 外环。
 */
const handleClick = (event: MouseEvent) => {
  if (event.detail === 0) return
  const el = event.currentTarget as HTMLElement | null
  setTimeout(() => el?.blur(), 0)
}
</script>

<template>
  <NButton
    text
    :class="classes"
    :disabled="disabled"
    :loading="loading"
    :attr-type="type"
    @click="handleClick"
  >
    <slot></slot>
  </NButton>
</template>

<style scoped>
.lt-btn {
  --lt-btn-height: 32px;
  --lt-btn-padding: 14px;
  --lt-btn-font-size: 13px;
  --lt-btn-gap: 6px;
  --lt-btn-radius: var(--theme-radius-pill, 100px);
  --lt-btn-color: var(--theme-text-secondary, #7a6e5e);
  --lt-btn-bg: transparent;
  --lt-btn-border-color: transparent;

  display: inline-flex;
  height: var(--lt-btn-height);
  min-height: var(--lt-btn-height);
  padding: 0 var(--lt-btn-padding);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: var(--lt-btn-font-size);
  font-weight: 500;
  line-height: 1;
  color: var(--lt-btn-color);
  white-space: nowrap;
  cursor: pointer;
  background: var(--lt-btn-bg);
  border: 1px solid var(--lt-btn-border-color);
  border-radius: var(--lt-btn-radius);
  box-sizing: border-box;
  transition: var(--theme-transition-interactive);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--lt-btn-gap);
  -webkit-tap-highlight-color: transparent;
}

.lt-btn :deep(.n-button__content) {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: inherit;
  gap: inherit;
}

.lt-btn--xs {
  --lt-btn-height: 24px;
  --lt-btn-padding: 8px;
  --lt-btn-font-size: 11px;
  --lt-btn-gap: 4px;
}

.lt-btn--compact {
  --lt-btn-height: 24px;
  --lt-btn-padding: 12px;
  --lt-btn-font-size: 12px;
  --lt-btn-gap: 6px;
}

.lt-btn--sm {
  --lt-btn-height: 28px;
  --lt-btn-padding: 10px;
  --lt-btn-font-size: 12px;
  --lt-btn-gap: 6px;
}

.lt-btn--md {
  --lt-btn-height: 32px;
  --lt-btn-padding: 14px;
  --lt-btn-font-size: 13px;
}

.lt-btn--lg {
  --lt-btn-height: 40px;
  --lt-btn-padding: 18px;
  --lt-btn-font-size: 13px;
  --lt-btn-gap: 8px;
}

/* 固定正方形：不受任何 min-height / 文本行高影响，杜绝被拉成椭圆 */
.lt-btn--circle {
  width: var(--lt-btn-height);
  max-width: var(--lt-btn-height);
  min-width: var(--lt-btn-height);
  padding: 0;
  border-radius: var(--theme-radius-round, 50%);
  aspect-ratio: 1;
  flex: 0 0 auto;
}

.lt-btn--block {
  display: flex;
  width: 100%;
}

.lt-btn--primary {
  --lt-btn-color: var(--theme-text-on-accent, #fff);
  --lt-btn-bg: var(--theme-accent-primary, #e8a0a0);
  --lt-btn-border-color: var(--theme-accent-primary, #e8a0a0);
  --lt-btn-color-hover: var(--theme-text-on-accent, #fff);
  --lt-btn-bg-hover: var(--theme-accent-hover, #d49090);
  --lt-btn-border-color-hover: var(--theme-accent-hover, #d49090);
}

.lt-btn--secondary {
  --lt-btn-color: var(--theme-text-secondary, #7a6e5e);
  --lt-btn-bg: var(--theme-bg-card, #fff);
  --lt-btn-border-color: var(--theme-border, #ede4db);
  --lt-btn-color-hover: var(--theme-accent-primary, #e8a0a0);
  --lt-btn-bg-hover: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  --lt-btn-border-color-hover: var(--theme-accent-primary, #e8a0a0);
}

.lt-btn--ghost {
  --lt-btn-color: var(--theme-text-secondary, #7a6e5e);
  --lt-btn-bg: transparent;
  --lt-btn-border-color: var(--theme-border, #ede4db);
  --lt-btn-color-hover: var(--theme-text-primary, #4a3728);
  --lt-btn-bg-hover: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  --lt-btn-border-color-hover: var(--theme-accent-primary, #e8a0a0);
}

.lt-btn--text {
  --lt-btn-color: var(--theme-text-secondary, #7a6e5e);
  --lt-btn-bg: transparent;
  --lt-btn-border-color: transparent;
  --lt-btn-color-hover: var(--theme-accent-primary, #e8a0a0);
  --lt-btn-bg-hover: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.lt-btn--success {
  --lt-btn-color: var(--theme-text-on-accent, #fff);
  --lt-btn-bg: var(--theme-color-success, #7fba8a);
  --lt-btn-border-color: var(--theme-color-success, #7fba8a);
  --lt-btn-color-hover: var(--theme-text-on-accent, #fff);
  --lt-btn-bg-hover: var(--theme-color-success-dark, #6aaa78);
  --lt-btn-border-color-hover: var(--theme-color-success-dark, #6aaa78);
}

.lt-btn--soft {
  --lt-btn-color: var(--theme-accent-primary, #e8a0a0);
  --lt-btn-bg: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  --lt-btn-border-color: transparent;
  --lt-btn-bg-hover: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.lt-btn--success-soft {
  --lt-btn-color: var(--theme-color-success-dark, #6aaa78);
  --lt-btn-bg: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
  --lt-btn-border-color: transparent;
  --lt-btn-bg-hover: color-mix(in srgb, var(--theme-color-success, #7fba8a) 20%, transparent);
}

.lt-btn--danger {
  --lt-btn-color: var(--theme-color-danger, #e8a0a0);
  --lt-btn-bg: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 8%, transparent);
  --lt-btn-border-color: transparent;
  --lt-btn-bg-hover: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 14%, transparent);
  --lt-btn-border-color-hover: color-mix(
    in srgb,
    var(--theme-color-danger, #e8a0a0) 55%,
    transparent
  );
}

.lt-btn--bare {
  --lt-btn-color: inherit;
  --lt-btn-bg: transparent;
  --lt-btn-border-color: transparent;

  height: auto;
  min-height: 0;
  padding: 0;
  font: inherit;
  border: 0;
  border-radius: 0;
}

/*
 * 指针点击后 WebView（桌面 WebView2 / 安卓 WebView）会把焦点留在按钮上，Naive 文本按钮
 * 的 focus 规则会写入透明底色与强调色文字，看起来就像按钮一直没松开。指针交互结束时
 * 由 main.ts 统一失焦；键盘聚焦时用 variant 配色托底，焦点仅由 focus-visible 外环表达。
 */
html[data-input='keyboard'] .lt-btn:not(.lt-btn--bare):focus-visible {
  color: var(--lt-btn-color);
  background: var(--lt-btn-bg);
  border-color: var(--lt-btn-border-color);
}

/* 按下反馈（松开立即恢复），触屏与鼠标一致 */
.lt-btn:not(.lt-btn--bare):active:not(:disabled) {
  color: var(--lt-btn-color-hover, var(--lt-btn-color));
  background: var(--lt-btn-bg-hover, var(--lt-btn-bg));
  border-color: var(--lt-btn-border-color-hover, var(--lt-btn-border-color));
}

/* 触屏点按会残留 :hover，悬停反馈只在真正支持悬停的设备上生效 */
@media (hover: hover) {
  .lt-btn:not(.lt-btn--bare):hover:not(:disabled) {
    color: var(--lt-btn-color-hover, var(--lt-btn-color));
    background: var(--lt-btn-bg-hover, var(--lt-btn-bg));
    border-color: var(--lt-btn-border-color-hover, var(--lt-btn-border-color));
  }
}

/* 触屏残留的 :hover 仍需盖住 Naive 自身的 hover 配色（透明底 + 强调色文字） */
@media (hover: none) {
  .lt-btn:not(.lt-btn--bare):hover:not(:active, :disabled) {
    color: var(--lt-btn-color);
    background: var(--lt-btn-bg);
    border-color: var(--lt-btn-border-color);
  }
}

html[data-input='keyboard'] .lt-btn:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.lt-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (hover: none) {
  /* 触屏命中区扩展到 ≥40dp，只外扩透明热区，绝不改变按钮视觉尺寸 */
  .lt-btn:not(.lt-btn--bare) {
    position: relative;
  }

  .lt-btn:not(.lt-btn--bare)::after {
    position: absolute;
    inset: -6px;
    content: '';
  }

  .lt-btn--xs::after,
  .lt-btn--compact::after {
    inset: -8px;
  }
}
</style>
