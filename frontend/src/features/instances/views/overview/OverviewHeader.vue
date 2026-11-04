<template>
  <div class="nd-block nd-block-stats">
    <div class="nd-stats">
      <div class="nd-stat-card">
        <div class="nd-stat-icon running" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z" />
          </svg>
        </div>
        <div class="nd-stat-body">
          <span class="nd-stat-num">{{ running }}</span>
          <span class="nd-stat-lbl">{{ t('newCommon.running') }}</span>
        </div>
      </div>
      <div class="nd-stat-card">
        <div class="nd-stat-icon stopped" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="7" y="7" width="10" height="10" rx="2" />
          </svg>
        </div>
        <div class="nd-stat-body">
          <span class="nd-stat-num">{{ stopped }}</span>
          <span class="nd-stat-lbl">{{ t('newCommon.stopped') }}</span>
        </div>
      </div>
      <div class="nd-stat-card">
        <div class="nd-stat-icon total" aria-hidden="true">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <circle cx="6" cy="12" r="2.4" />
            <circle cx="18" cy="6" r="2.4" />
            <circle cx="18" cy="18" r="2.4" />
            <path d="M8.2 11.1l7.6-4.1M8.2 12.9l7.6 4.1" />
          </svg>
        </div>
        <div class="nd-stat-body">
          <span class="nd-stat-num">{{ total }}</span>
          <span class="nd-stat-lbl">{{ t('newOverview.totalConfig') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  running: number
  stopped: number
  total: number
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/header.less');
</style>
