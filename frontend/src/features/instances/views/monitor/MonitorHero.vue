<template>
  <div class="nm-hero" :class="{ 'nm-hero-on': running }">
    <div class="nm-hero-head">
      <span class="nm-hero-state">
        <span class="nm-hero-dot" :class="{ on: running }"></span>
        {{ running ? t('newCommon.running') : t('newCommon.stopped') }}
      </span>
      <span v-if="virtualIp" class="nm-hero-chip">{{ virtualIp }}</span>
    </div>

    <div class="nm-hero-name">{{ name }}</div>
    <p class="nm-hero-desc">{{ description }}</p>

    <div v-if="running" class="nm-hero-metrics">
      <div class="nm-hero-metric">
        <span class="nm-hero-label">{{ t('newMonitor.peerNodes') }}</span>
        <strong class="nm-hero-value">{{ peerCount }}</strong>
      </div>
      <span class="nm-hero-divider"></span>
      <div class="nm-hero-metric">
        <span class="nm-hero-label">{{ t('newMonitor.avgLatency') }}</span>
        <strong class="nm-hero-value">{{ avgLatency }}</strong>
      </div>
    </div>

    <div class="nm-hero-actions">
      <LtButton
        variant="danger"
        size="lg"
        class="nm-hero-btn"
        :disabled="stopping"
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
      <LtButton variant="soft" size="lg" class="nm-hero-btn" @click="emit('config')">
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

    <div class="nm-hero-foot">
      <span>{{ t('newMonitor.lastUpdate') }} {{ lastUpdateText }}</span>
      <span class="nm-hero-foot-sep"></span>
      <span>{{ t('newMonitor.autoRefresh', { n: refreshInterval }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'

defineProps<{
  name?: string
  running: boolean
  virtualIp?: string
  description: string
  peerCount: number
  avgLatency: string
  lastUpdateText: string
  refreshInterval: number
  stopping: boolean
}>()

const emit = defineEmits<{
  stop: []
  config: []
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/hero.less');
</style>
