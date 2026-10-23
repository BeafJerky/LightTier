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
</script>

<template>
  <NButton text :class="classes" :disabled="disabled" :loading="loading" :attr-type="type">
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

  display: inline-flex;
  height: var(--lt-btn-height);
  min-height: var(--lt-btn-height);
  padding: 0 var(--lt-btn-padding);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: var(--lt-btn-font-size);
  font-weight: 500;
  line-height: 1;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
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
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.lt-btn--primary:hover:not(:disabled) {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-hover, #d49090);
  border-color: var(--theme-accent-hover, #d49090);
}

.lt-btn--secondary {
  color: var(--theme-text-secondary, #7a6e5e);
  background: var(--theme-bg-card, #fff);
  border-color: var(--theme-border, #ede4db);
}

.lt-btn--secondary:hover:not(:disabled) {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.lt-btn--ghost {
  color: var(--theme-text-secondary, #7a6e5e);
  background: transparent;
  border-color: var(--theme-border, #ede4db);
}

.lt-btn--ghost:hover:not(:disabled) {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.lt-btn--text {
  color: var(--theme-text-secondary, #7a6e5e);
  background: transparent;
  border-color: transparent;
}

.lt-btn--text:hover:not(:disabled) {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.lt-btn--success {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-color-success, #7fba8a);
  border-color: var(--theme-color-success, #7fba8a);
}

.lt-btn--success:hover:not(:disabled) {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-color-success-dark, #6aaa78);
  border-color: var(--theme-color-success-dark, #6aaa78);
}

.lt-btn--soft {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-color: transparent;
}

.lt-btn--soft:hover:not(:disabled) {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
  border-color: transparent;
}

.lt-btn--success-soft {
  color: var(--theme-color-success-dark, #6aaa78);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
  border-color: transparent;
}

.lt-btn--success-soft:hover:not(:disabled) {
  color: var(--theme-color-success-dark, #6aaa78);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 20%, transparent);
  border-color: transparent;
}

.lt-btn--danger {
  color: var(--theme-color-danger, #e8a0a0);
  background: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 8%, transparent);
  border-color: transparent;
}

.lt-btn--danger:hover:not(:disabled) {
  color: var(--theme-color-danger, #e8a0a0);
  background: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 14%, transparent);
  border-color: color-mix(in srgb, var(--theme-color-danger, #e8a0a0) 55%, transparent);
}

.lt-btn--bare {
  height: auto;
  min-height: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 0;
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
