<script setup lang="ts">
/**
 * LtSwitch — Naive UI Switch 封装
 * 开关颜色统一由主题覆盖（开启态使用 success 语义色），避免各页面自行绘制滑块。
 */
import { computed } from 'vue'
import { NSwitch } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
    loading?: boolean
    size?: 'sm' | 'md'
    ariaLabel?: string
  }>(),
  { disabled: false, loading: false, size: 'sm', ariaLabel: undefined }
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const naiveSize = computed(() => (props.size === 'md' ? 'medium' : 'small'))
</script>

<template>
  <NSwitch
    class="lt-switch"
    :class="`lt-switch--${size}`"
    :value="modelValue"
    :size="naiveSize"
    :disabled="disabled"
    :loading="loading"
    :aria-label="ariaLabel"
    @update:value="emit('update:modelValue', $event)"
  />
</template>

<style scoped>
.lt-switch {
  flex-shrink: 0;
}
</style>
