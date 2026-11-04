<script setup lang="ts">
/**
 * Icon — 统一图标组件（基于 Iconify + Naive UI 容器）
 *
 * 用法：<Icon icon="clarity:dashboard-line" :size="18" hover-color="..." />。
 * 特点：尺寸/颜色由 NIcon 统一注入，hoverColor 通过 CSS v-bind 实现悬停变色。
 */
import { NIcon } from 'naive-ui'
import { Icon } from '@iconify/vue'

withDefaults(
  defineProps<{
    // icon name（iconify 图标名，如 clarity:dashboard-line）
    icon: string
    // icon color
    color?: string
    // icon size
    size?: number
    // 悬停颜色
    hoverColor?: string
  }>(),
  { size: 16 }
)
</script>

<template>
  <NIcon :size="size" :color="color">
    <Icon :icon="icon" class="lt-icon" />
  </NIcon>
</template>

<style lang="less" scoped>
.lt-icon {
  &:hover {
    // stylelint-disable-next-line
    color: v-bind(hoverColor) !important;
  }
}
</style>
