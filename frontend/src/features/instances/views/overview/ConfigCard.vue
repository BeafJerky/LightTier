<template>
  <div
    class="nd-config-card"
    :class="{ 'ndc-on': cfg.running, 'ndc-conflict': cfg.conflictPorts.length > 0 }"
  >
    <LtButton
      variant="bare"
      class="ndc-main"
      :aria-label="t('newOverview.openConfig', { name: cfg.configFileName })"
      @click="emit('open', cfg)"
    >
      <span class="ndc-main-inner">
        <span class="ndc-top">
          <span class="ndc-status" :class="{ on: cfg.running }">
            <span class="ndc-dot" :class="cfg.running ? 'on' : 'off'"></span>
            <span class="ndc-status-text">{{
              cfg.running ? t('newCommon.running') : t('newCommon.stopped')
            }}</span>
          </span>
          <span class="ndc-top-right">
            <span v-if="cfg.conflictPorts.length > 0" class="ndc-conflict-badge"
              >⚠ {{ cfg.conflictPorts.join(', ') }}</span
            >
            <span v-if="cfg.pid" class="ndc-pid">PID {{ cfg.pid }}</span>
            <svg
              class="ndc-chev"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </span>
        </span>
        <span class="ndc-name" :title="cfg.configFileName">{{ cfg.configFileName }}</span>
        <span class="ndc-summary" :class="{ on: cfg.running }">{{ summaryText }}</span>
      </span>
    </LtButton>
    <div class="ndc-actions">
      <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
      <LtButton
        :variant="cfg.running ? 'soft' : 'success'"
        size="compact"
        @click="cfg.running ? emit('stop', cfg) : emit('start', cfg)"
        >{{ cfg.running ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
      >
      <!-- 运行中直达该配置的监控详情 -->
      <LtButton
        v-if="cfg.running"
        variant="secondary"
        size="compact"
        @click="emit('monitor', cfg)"
        >{{ t('newOverview.viewMonitor') }}</LtButton
      >
    </div>
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
}>()

const emit = defineEmits<{
  open: [cfg: OverviewConfigItem]
  start: [cfg: OverviewConfigItem]
  stop: [cfg: OverviewConfigItem]
  monitor: [cfg: OverviewConfigItem]
}>()

const { t } = useI18n()

// 固定保留一行摘要，运行中无数据时也不塌陷，避免卡片高度跳动
const summaryText = computed(() => {
  if (!props.cfg.running) return t('newOverview.disconnected')
  return props.summary
    ? `${props.summary.nodeCount} ${t('newOverview.nodes')} · ${props.summary.avgLatency}`
    : '…'
})
</script>

<style scoped lang="less">
@import url('./styles/card.less');
</style>
