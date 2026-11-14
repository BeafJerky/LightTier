<!-- frontend/src/features/settings/components/SettingsDialog/IslandSection.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtSelect, LtSwitch } from '@/shared/ui'
import { useIslandStore } from '@/shared/store/island'
import type { IslandNoticeType } from '@/shared/lib/island/types'

const { t } = useI18n()
const island = useIslandStore()

const idleOptions = computed(() => [
  { label: t('newSettings.islandIdleCount'), value: 'count' },
  { label: t('newSettings.islandIdleDot'), value: 'dot' }
])

const motionOptions = computed(() => [
  { label: t('newSettings.islandMotionSystem'), value: 'system' },
  { label: t('newSettings.islandMotionStandard'), value: 'standard' },
  { label: t('newSettings.islandMotionReduced'), value: 'reduced' }
])

const typeOptions = computed<{ type: IslandNoticeType; label: string }[]>(() => [
  { type: 'error', label: t('newSettings.islandTypeError') },
  { type: 'quality', label: t('newSettings.islandTypeQuality') },
  { type: 'update', label: t('newSettings.islandTypeUpdate') },
  { type: 'feedback', label: t('newSettings.islandTypeFeedback') }
])

const toggleType = (type: IslandNoticeType) => {
  island.setTypeEnabled(type, !island.settings.types[type])
}

const handleIdleSelect = (value: string | number | null) => {
  if (value === 'count' || value === 'dot') island.setIdle(value)
}

const handleMotionSelect = (value: string | number | null) => {
  if (value === 'system' || value === 'standard' || value === 'reduced') {
    island.setMotion(value)
  }
}
</script>

<template>
  <div
    id="sd-panel-island"
    class="sd-section"
    role="tabpanel"
    aria-labelledby="sd-tab-island"
    tabindex="0"
  >
    <label class="sd-row" @click="island.setEnabled(!island.settings.enabled)">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandEnabled') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandEnabledDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="island.settings.enabled"
        :aria-label="t('newSettings.islandEnabled')"
        @update:model-value="island.setEnabled"
        @click.stop
      />
    </label>

    <div class="sd-row" :class="{ 'is-disabled': !island.settings.enabled }">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandIdle') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandIdleDesc') }}</span>
      </div>
      <div class="sd-select-field">
        <LtSelect
          :model-value="island.settings.idle"
          :options="idleOptions"
          :disabled="!island.settings.enabled"
          :aria-label="t('newSettings.islandIdle')"
          @update:model-value="handleIdleSelect"
        />
      </div>
    </div>

    <div class="sd-row island-type-row" :class="{ 'is-disabled': !island.settings.enabled }">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandTypes') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandTypesDesc') }}</span>
      </div>
      <div class="island-type-grid" role="group" :aria-label="t('newSettings.islandTypes')">
        <button
          v-for="item in typeOptions"
          :key="item.type"
          type="button"
          class="island-type-chip"
          :class="{ active: island.settings.types[item.type] }"
          role="checkbox"
          :aria-checked="island.settings.types[item.type]"
          :disabled="!island.settings.enabled"
          @click="toggleType(item.type)"
        >
          <span class="island-type-dot" :class="`dot-${item.type}`"></span>
          {{ item.label }}
        </button>
      </div>
    </div>

    <label
      class="sd-row"
      :class="{ 'is-disabled': !island.settings.enabled }"
      @click="island.settings.enabled && island.setSilent(!island.settings.silent)"
    >
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandSilent') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandSilentDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="island.settings.silent"
        :disabled="!island.settings.enabled"
        :aria-label="t('newSettings.islandSilent')"
        @update:model-value="island.setSilent"
        @click.stop
      />
    </label>

    <div class="sd-row" :class="{ 'is-disabled': !island.settings.enabled }">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandMotion') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandMotionDesc') }}</span>
      </div>
      <div class="sd-select-field">
        <LtSelect
          :model-value="island.settings.motion"
          :options="motionOptions"
          :disabled="!island.settings.enabled"
          :aria-label="t('newSettings.islandMotion')"
          @update:model-value="handleMotionSelect"
        />
      </div>
    </div>

    <label
      class="sd-row"
      :class="{ 'is-disabled': !island.settings.enabled }"
      @click="island.settings.enabled && island.setFace(!island.settings.face)"
    >
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.islandFace') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.islandFaceDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="island.settings.face"
        :disabled="!island.settings.enabled"
        :aria-label="t('newSettings.islandFace')"
        @update:model-value="island.setFace"
        @click.stop
      />
    </label>

    <div class="sd-row island-reset-row">
      <span class="sd-row-desc">{{ t('newSettings.islandResetDesc') }}</span>
      <LtButton variant="text" size="sm" @click="island.resetSettings">
        {{ t('newSettings.islandReset') }}
      </LtButton>
    </div>
  </div>
</template>

<style scoped lang="less">
@import url('./styles/common.less');

.sd-select-field {
  width: 220px;
  max-width: 100%;
  flex-shrink: 0;
}

.island-type-row {
  align-items: flex-start;
}

.island-type-grid {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  gap: var(--theme-space-2, 8px);
  width: 100%;
  margin-top: 2px;
}

.island-type-chip {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 32px;
  padding: 6px 10px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-secondary, #756a5b);
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: 999px;
  transition:
    color 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease;
}

.island-type-chip.active {
  color: var(--theme-text-primary, #4a3728);
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.12);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.island-type-chip:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.island-type-chip:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.island-type-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-error {
  background: var(--theme-color-error, #d97b7b);
}

.dot-quality {
  background: var(--theme-color-warning, #e6a23c);
}

.dot-update {
  background: var(--theme-accent-secondary, #b8a9c9);
}

.dot-feedback {
  background: var(--theme-color-success, #7fba8a);
}

.is-disabled {
  opacity: 0.55;
}

.island-reset-row {
  justify-content: space-between;
}
</style>
