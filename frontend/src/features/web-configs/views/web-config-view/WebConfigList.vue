<template>
  <div class="nwc-left">
    <!-- 页面标题已由应用栏承担，列表顶部为「计数 + 新增」工具行，与总览页同构 -->
    <div class="nwc-left-header">
      <span class="nwc-left-count">{{ t('newWebConfig.configsTotal', { n: items.length }) }}</span>
      <LtButton
        variant="secondary"
        :size="isAndroid ? 'lg' : 'sm'"
        class="nwc-add-btn"
        @click="emit('add')"
        :title="t('newWebConfig.addConfig')"
      >
        <svg
          :width="isAndroid ? 17 : 14"
          :height="isAndroid ? 17 : 14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>{{ t('newWebConfig.addConfig') }}</span>
      </LtButton>
    </div>
    <div class="nwc-left-scroll lt-loading-host">
      <LoadingOverlay :show="loading" />
      <!-- Android：总览式分组行，触控目标整行可点 -->
      <template v-if="isAndroid">
        <div v-if="items.length > 0" class="nwc-card-list">
          <div
            v-for="item in items"
            :key="item.configFileName"
            class="nwc-row"
            :class="{ active: selectedName === item.configFileName }"
            @click="emit('select', item)"
          >
            <span class="nwc-row-icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
              </svg>
            </span>
            <span class="nwc-row-text">
              <span class="nwc-row-name">{{ item.configFileName }}</span>
              <span class="nwc-row-sub">{{ item.protocol }}://{{ item.host }}:{{ item.port }}</span>
            </span>
            <svg
              class="nwc-row-chev"
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
          </div>
        </div>
      </template>
      <!-- 桌面：保留原有卡片列表 -->
      <template v-else>
        <div
          v-for="item in items"
          :key="item.configFileName"
          class="nwc-card"
          :class="{ active: selectedName === item.configFileName }"
          @click="emit('select', item)"
        >
          <div class="nwc-card-top">
            <div class="nwc-card-status">
              <span class="nwc-dot" :class="getWebStatusClass(item, isAndroid)"></span>
              <span class="nwc-status-text">{{ getWebStatusText(item, isAndroid, t) }}</span>
            </div>
            <span v-if="item.pid && !isWebChecking(item, isAndroid)" class="nwc-card-pid"
              >PID {{ item.pid }}</span
            >
          </div>
          <div class="nwc-card-name">{{ item.configFileName }}</div>
          <div class="nwc-card-sub">{{ item.host }}:{{ item.port }}</div>
          <div class="nwc-card-actions" @click.stop>
            <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
            <LtButton
              size="compact"
              :variant="isWebRunning(item) ? 'soft' : 'success'"
              :disabled="isWebChecking(item, isAndroid)"
              @click="isWebRunning(item) ? emit('stop', item) : emit('start', item)"
              >{{ isWebRunning(item) ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
            >
          </div>
        </div>
      </template>
      <div v-if="items.length === 0 && !loading" class="nwc-empty-cards">
        <span class="nwc-empty-icon">✦</span>
        <p class="nwc-empty-title">{{
          isAndroid ? t('newWebConfig.emptyTitle') : t('newCommon.noWebConfig')
        }}</p>
        <template v-if="isAndroid">
          <span class="nwc-empty-desc">{{ t('newWebConfig.emptyDesc') }}</span>
          <LtButton variant="primary" size="md" class="nwc-empty-cta" @click="emit('add')">
            {{ t('newWebConfig.addConfig') }}
          </LtButton>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import LoadingOverlay from '@/shared/ui/LoadingOverlay.vue'
import { LtButton } from '@/shared/ui'
import type { FormWebData } from '@/entities/config/formTypes'
import {
  getWebStatusClass,
  getWebStatusText,
  isWebChecking,
  isWebRunning
} from '../../lib/webConfigStatus'

defineProps<{
  items: FormWebData[]
  selectedName: string | null
  loading: boolean
  isAndroid: boolean
}>()

const emit = defineEmits<{
  add: []
  select: [item: FormWebData]
  start: [item: FormWebData]
  stop: [item: FormWebData]
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/list.less');
</style>
