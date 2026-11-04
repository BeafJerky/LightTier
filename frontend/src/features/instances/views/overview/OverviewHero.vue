<template>
  <section class="nda-hero" :class="{ 'nda-hero-on': active }">
    <div class="nda-hero-head">
      <span class="nda-state">
        <span class="nda-state-dot" :class="{ on: active }"></span>
        {{ active ? t('newOverview.connected') : t('newOverview.disconnected') }}
      </span>
      <span v-if="active && virtualIp" class="nda-chip nda-chip-vip">
        {{ virtualIp }}
      </span>
      <span v-else-if="!active && name" class="nda-chip">{{ caption }}</span>
    </div>

    <div class="nda-hero-name">{{ name }}</div>
    <p class="nda-hero-desc">{{ description }}</p>

    <div v-if="active" class="nda-metrics">
      <div class="nda-metric">
        <span class="nda-metric-label">{{ t('newOverview.nodes') }}</span>
        <strong class="nda-metric-value">{{ nodeCount ?? '—' }}</strong>
      </div>
      <span class="nda-metric-sep"></span>
      <div class="nda-metric">
        <span class="nda-metric-label">{{ t('newMonitor.avgLatency') }}</span>
        <strong class="nda-metric-value">{{ avgLatency ?? '—' }}</strong>
      </div>
    </div>

    <div v-if="name" class="nda-hero-actions">
      <LtButton
        v-if="active"
        variant="danger"
        size="lg"
        class="nda-btn"
        :disabled="disabled"
        @click="emit('stop')"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        <span>{{ t('newOverview.disconnect') }}</span>
      </LtButton>
      <LtButton
        v-else
        variant="success"
        size="lg"
        class="nda-btn nda-btn-connect"
        :disabled="disabled"
        @click="emit('connect')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z" />
        </svg>
        <span>{{ t('newOverview.connectNow') }}</span>
      </LtButton>

      <LtButton v-if="active" variant="soft" size="lg" class="nda-btn" @click="emit('monitor')">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          aria-hidden="true"
        >
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
        <span>{{ t('newOverview.viewMonitor') }}</span>
      </LtButton>
      <LtButton v-else variant="soft" size="lg" class="nda-btn" @click="emit('config')">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          aria-hidden="true"
        >
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M14 3v5h5M9 13h6M9 17h5" />
        </svg>
        <span>{{ t('newOverview.configDetail') }}</span>
      </LtButton>
    </div>

    <div class="nda-hero-foot">
      <span>{{ t('newOverview.runningSummary', { n: runningCount }) }}</span>
      <span class="nda-sep"></span>
      <span>{{ t('newOverview.stoppedSummary', { n: stoppedCount }) }}</span>
      <span class="nda-sep"></span>
      <span>{{ t('newOverview.configsTotal', { n: totalCount }) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'

defineProps<{
  active: boolean
  virtualIp?: string
  caption?: string
  name?: string
  description: string
  nodeCount?: number
  avgLatency?: string
  runningCount: number
  stoppedCount: number
  totalCount: number
  disabled: boolean
}>()

const emit = defineEmits<{
  stop: []
  connect: []
  monitor: []
  config: []
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/hero.less');
</style>
