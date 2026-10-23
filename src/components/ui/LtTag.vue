<script setup lang="ts">
/**
 * LtTag — Naive UI Tag 封装
 * 语义色与描边统一走主题覆盖，尺寸使用项目的小/中两档。
 */
import { computed } from 'vue'
import { NTag } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    type?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'
    size?: 'sm' | 'md'
    bordered?: boolean
    round?: boolean
  }>(),
  { type: 'default', size: 'sm', bordered: false, round: false }
)

const naiveSize = computed(() => (props.size === 'md' ? 'medium' : 'small'))
</script>

<template>
  <NTag
    class="lt-tag"
    :class="`lt-tag--${size}`"
    :type="type"
    :size="naiveSize"
    :bordered="bordered"
    :round="round"
  >
    <slot></slot>
  </NTag>
</template>

<style scoped>
.lt-tag {
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  flex-shrink: 0;
}

.lt-tag :deep(.n-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
