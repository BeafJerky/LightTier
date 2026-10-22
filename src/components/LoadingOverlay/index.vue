<script setup lang="ts">
/**
 * LoadingOverlay — 列表/网格加载态遮罩
 *
 * 用法：父容器加 `.lt-loading-host`（position: relative），内部放置
 * <LoadingOverlay :show="loading" />。保留原 v-loading 的覆盖范围与无文本样式，
 * 仅把动画实现换成 NaiveUI Spin。
 */
import { computed } from 'vue'
import { NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    show: boolean
    // 可选的自定义说明；默认使用通用“加载中…”
    label?: string
  }>(),
  { label: '' }
)

const { t } = useI18n()
const labelText = computed(() => props.label || t('newCommon.loading'))
</script>

<template>
  <Transition name="lt-loading-fade">
    <div v-if="show" class="lt-loading-overlay" role="status" aria-live="polite">
      <NSpin />
      <span class="lt-sr-only">{{ labelText }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.lt-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  background: rgb(253 248 244 / 68%);
  background: color-mix(in srgb, var(--theme-bg, #fdf8f4) 68%, transparent);
  align-items: center;
  justify-content: center;
}

.lt-loading-fade-enter-active,
.lt-loading-fade-leave-active {
  transition: opacity var(--theme-duration) var(--theme-ease-out);
}

.lt-loading-fade-enter-from,
.lt-loading-fade-leave-to {
  opacity: 0;
}
</style>
