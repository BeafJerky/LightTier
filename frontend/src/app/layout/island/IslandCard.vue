<!-- frontend/src/app/layout/island/IslandCard.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'
import type { IslandAction, IslandNotice } from '@/shared/lib/island/types'

const props = withDefaults(
  defineProps<{
    kind: 'notice' | 'overview'
    notice?: IslandNotice | null
    instances: RunningItem[]
    summary: Record<string, { nodeCount: number; avgLatency: string }>
    pendingCount?: number
  }>(),
  { notice: null, pendingCount: 1 }
)

const emit = defineEmits<{
  close: []
  dismiss: []
  action: [action: IslandAction]
  overview: []
}>()

const { t } = useI18n()

const tone = computed(() => (props.kind === 'overview' ? 'info' : (props.notice?.type ?? 'info')))

const title = computed(() =>
  props.kind === 'overview' ? t('newIsland.overviewTitle') : (props.notice?.title ?? '')
)

const typeLabel = computed(() => {
  const type = props.notice?.type
  if (type === 'error') return t('newIsland.typeError')
  if (type === 'update') return t('newIsland.typeUpdate')
  if (type === 'quality') return t('newIsland.typeQuality')
  return t('newIsland.typeFeedback')
})

const subtitle = computed(() =>
  props.kind === 'overview'
    ? t('newIsland.overviewSub', { count: props.instances.length })
    : typeLabel.value
)

const primaryLabel = computed(() => {
  const kind = props.notice?.action?.kind
  if (kind === 'open-monitor') return t('newIsland.viewMonitor')
  if (kind === 'open-settings') return t('newIsland.openSettings')
  return ''
})

const queueLabel = computed(() =>
  props.pendingCount > 1
    ? t('newIsland.queuePosition', { current: 1, total: props.pendingCount })
    : ''
)

const visibleInstances = computed(() => props.instances.slice(0, 3))

const onPrimary = () => {
  const action = props.notice?.action
  if (!action || action.kind === 'dismiss') return
  emit('action', action)
}
</script>

<template>
  <section
    class="island-card"
    :class="[`kind-${kind}`, `tone-${tone}`]"
    role="region"
    :aria-label="title"
  >
    <header class="island-card-head">
      <span class="island-card-icon" aria-hidden="true">
        <svg
          v-if="kind === 'overview'"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <circle cx="6" cy="7" r="2.5" />
          <circle cx="18" cy="7" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M8.2 8.4l2.6 7.2M15.8 8.4l-2.6 7.2M8.5 7h7" />
        </svg>
        <svg
          v-else
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5M12 16h.01" />
        </svg>
      </span>
      <div class="island-card-heading">
        <span class="island-card-title">{{ title }}</span>
        <span class="island-card-sub">{{ subtitle }}</span>
      </div>
      <button
        type="button"
        class="island-card-close"
        :aria-label="t('newIsland.close')"
        @click="emit('close')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <div class="island-card-body">
      <template v-if="kind === 'overview'">
        <ul v-if="visibleInstances.length" class="island-run-list">
          <li v-for="item in visibleInstances" :key="item.configFileName" class="island-run-row">
            <span class="island-run-dot"></span>
            <span class="island-run-name">{{ item.configFileName }}</span>
            <span class="island-run-meta">
              {{ summary[item.configFileName]?.avgLatency || '—' }}
            </span>
          </li>
        </ul>
        <p v-else class="island-empty">{{ t('newIsland.noRunning') }}</p>
      </template>
      <p v-else-if="notice?.detail" class="island-card-detail">{{ notice.detail }}</p>
    </div>

    <footer class="island-card-foot">
      <span class="island-queue">{{ queueLabel }}</span>
      <div class="island-card-actions">
        <template v-if="kind === 'overview'">
          <LtButton variant="soft" size="xs" @click="emit('overview')">
            {{ t('newIsland.openOverview') }}
          </LtButton>
        </template>
        <template v-else>
          <LtButton v-if="primaryLabel" variant="soft" size="xs" @click="onPrimary">
            {{ primaryLabel }}
          </LtButton>
          <LtButton variant="text" size="xs" @click="emit('dismiss')">
            {{ t('newIsland.dismiss') }}
          </LtButton>
        </template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.island-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  overflow: hidden;
  box-sizing: border-box;
}

.island-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.island-card-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--theme-accent-primary, #e8a0a0);
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.14);
  border-radius: 10px;
}

.tone-error .island-card-icon {
  color: var(--theme-color-error, #d97b7b);
  background: rgb(var(--theme-color-error-rgb, 217, 123, 123), 0.14);
}

.tone-warning .island-card-icon {
  color: var(--theme-color-warning, #e6a23c);
  background: rgb(var(--theme-color-warning-rgb, 230, 162, 60), 0.14);
}

.tone-update .island-card-icon {
  color: var(--theme-accent-secondary, #b8a9c9);
  background: rgb(var(--theme-accent-secondary-rgb, 184, 169, 201), 0.16);
}

.tone-feedback .island-card-icon {
  color: var(--theme-color-success, #7fba8a);
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.14);
}

.island-card-heading {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.island-card-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
  color: var(--theme-text-primary, #4a3728);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-card-sub {
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--theme-text-secondary, #756a5b);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-card-close {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
}

/* 视觉 24px，透明热区补到 44×44 */
.island-card-close::after {
  position: absolute;
  inset: -10px;
  content: '';
}

.island-card-close:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.island-card-close:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.island-card-body {
  flex: 1;
  min-height: 0;
  padding: 8px 0 4px;
  overflow: hidden;
}

.island-card-detail {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--theme-text-secondary, #756a5b);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.island-run-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.island-run-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--theme-text-secondary, #756a5b);
}

.island-run-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: var(--theme-color-success, #7fba8a);
  border-radius: 50%;
}

.island-run-name {
  flex: 1;
  overflow: hidden;
  color: var(--theme-text-primary, #4a3728);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-run-meta {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-muted, #c8bdb2);
}

.island-empty {
  margin: 0;
  font-size: 11.5px;
  color: var(--theme-text-muted, #c8bdb2);
}

.island-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
}

.island-queue {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-muted, #c8bdb2);
}

.island-card-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
</style>
