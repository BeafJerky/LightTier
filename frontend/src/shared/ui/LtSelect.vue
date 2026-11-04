<script setup lang="ts">
/**
 * LtSelect — Naive UI Select 封装
 * 弹层与选项样式由 Naive 主题覆盖统一控制，不再使用系统原生 select。
 * filled 为浅底描边（设置项），outline 为卡片底描边（编辑表单）。
 */
import { computed } from 'vue'
import { NSelect, type SelectOption } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null
    options: SelectOption[]
    placeholder?: string
    variant?: 'filled' | 'outline'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    clearable?: boolean
    ariaLabel?: string
  }>(),
  {
    modelValue: null,
    placeholder: '',
    variant: 'filled',
    size: 'md',
    disabled: false,
    clearable: false,
    ariaLabel: undefined
  }
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number | null] }>()

const naiveSize = computed(() =>
  props.size === 'sm' ? 'small' : props.size === 'lg' ? 'large' : 'medium'
)
</script>

<template>
  <NSelect
    class="lt-select"
    :class="[`lt-select--${variant}`, `lt-select--${size}`]"
    :value="modelValue"
    :options="options"
    :placeholder="placeholder"
    :size="naiveSize"
    :disabled="disabled"
    :clearable="clearable"
    :aria-label="ariaLabel"
    @update:value="emit('update:modelValue', $event)"
  />
</template>

<style scoped>
.lt-select {
  width: 100%;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
}

.lt-select--outline :deep(.n-base-selection-label) {
  background-color: var(--theme-bg-card, #fff) !important;
}

.lt-select--outline :deep(.n-base-selection__border),
.lt-select--outline :deep(.n-base-selection__state-border) {
  border-width: 1.5px !important;
}
</style>
