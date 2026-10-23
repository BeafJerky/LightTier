<script setup lang="ts">
/**
 * ConfigGlobal — Naive UI 全局配置容器（应用根级包裹）
 *
 * 统一注入：组件尺寸、当前语言包、明暗基础主题与主题变量覆盖；
 * 挂载时初始化 CSS 主题变量。使用 abstract 模式避免额外 DOM 层级影响布局。
 * 关闭 Naive 的 preflight：它会把 body 改成 14px / 1.6 行高，覆盖应用自身的
 * 全局排版，导致迁移后整站文字观感变化；重置样式继续由 index.less 负责。
 */
import { computed } from 'vue'
import { NConfigProvider, NNotificationProvider, dateEnUS, dateZhCN, enUS, zhCN } from 'naive-ui'
import { useLocaleStore } from '@/store/modules/locale'
import { useNaiveTheme } from './naiveTheme'

const { naiveTheme, themeOverrides } = useNaiveTheme()

const localeStore = useLocaleStore()
const isEnglish = computed(() => localeStore.currentLocale.lang === 'en')
const naiveLocale = computed(() => (isEnglish.value ? enUS : zhCN))
const naiveDateLocale = computed(() => (isEnglish.value ? dateEnUS : dateZhCN))
</script>

<template>
  <NConfigProvider
    abstract
    preflight-style-disabled
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <NNotificationProvider :max="3">
      <slot></slot>
    </NNotificationProvider>
  </NConfigProvider>
</template>
