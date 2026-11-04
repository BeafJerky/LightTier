<template>
  <div
    class="nda-row"
    :class="{ 'nda-row-on': cfg.running, 'nda-row-conflict': cfg.conflictPorts.length > 0 }"
  >
    <LtButton
      variant="bare"
      class="nda-row-main"
      :aria-label="t('newOverview.openConfig', { name: cfg.configFileName })"
      @click="emit('open', cfg)"
    >
      <span class="nda-row-icon" :class="{ on: cfg.running }">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="18" cy="18" r="2.4" />
          <path d="M8.2 11.1l7.6-4.1M8.2 12.9l7.6 4.1" />
        </svg>
      </span>
      <span class="nda-row-text">
        <span class="nda-row-name">
          {{ cfg.configFileName }}
          <span
            v-if="cfg.conflictPorts.length > 0"
            class="nda-row-warn"
            :title="cfg.conflictPorts.join(', ')"
            >!</span
          >
        </span>
        <span class="nda-row-sub">
          {{ cfg.running ? summaryText : t('newOverview.disconnected') }}
        </span>
      </span>
      <svg
        class="nda-row-chev"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </LtButton>
    <LtButton
      :variant="cfg.running ? 'danger' : 'success-soft'"
      size="lg"
      circle
      class="nda-row-action"
      :disabled="disabled"
      :aria-label="cfg.running ? t('newCommon.stop') : t('newCommon.run')"
      @click="emit('toggle', cfg)"
    >
      <svg
        v-if="cfg.running"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
      <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z" />
      </svg>
    </LtButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'
import type { OverviewConfigItem, OverviewSummary } from './types'

const props = defineProps<{
  cfg: OverviewConfigItem
  summary?: OverviewSummary
  disabled: boolean
}>()

const emit = defineEmits<{
  open: [cfg: OverviewConfigItem]
  toggle: [cfg: OverviewConfigItem]
}>()

const { t } = useI18n()

const summaryText = computed(() =>
  props.summary
    ? `${props.summary.nodeCount} ${t('newOverview.nodes')} · ${props.summary.avgLatency}`
    : t('newOverview.summaryPending')
)
</script>

<style scoped lang="less">
@import url('./styles/row.less');
</style>
