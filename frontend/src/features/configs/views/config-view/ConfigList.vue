<template>
  <div class="nw-left">
    <!-- 搜索与新增同排；页面标题已由应用栏承担，列表不再重复 -->
    <div v-if="easyTierStore.configList.length > 0" class="nw-left-header">
      <div class="nw-left-tools">
        <div class="nw-search">
          <LtInput
            v-model="configSearch"
            class="nw-search-input"
            variant="filled"
            :size="isAndroidPlatform ? 'lg' : 'md'"
            clearable
            :placeholder="t('newCommon.searchConfig')"
            :aria-label="t('newCommon.searchConfig')"
            @keydown.esc="configSearch = ''"
            @keydown.enter.prevent="blurSearchInput"
          />
        </div>
        <LtButton
          variant="secondary"
          :size="isAndroidPlatform ? 'lg' : 'sm'"
          circle
          class="nw-add-btn"
          @click="openAdd"
          :title="t('newConfig.addConfig')"
          :aria-label="t('newConfig.addConfig')"
        >
          <svg
            :width="isAndroidPlatform ? 19 : 16"
            :height="isAndroidPlatform ? 19 : 16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </LtButton>
      </div>
    </div>
    <div class="nw-left-scroll lt-loading-host">
      <LoadingOverlay :show="easyTierStore.configListLoading" />
      <!-- 重排（启停后运行态优先）与搜索过滤使用 FLIP 过渡，避免卡片瞬移 -->
      <TransitionGroup name="nw-card" tag="div" class="nw-card-list">
        <!-- Android：总览式分组行，触控目标整行可点 -->
        <template v-if="isAndroidPlatform">
          <div
            v-for="item in filteredConfigList"
            :key="item.configFileName"
            class="nw-row"
            :class="{
              'nw-row-on': getRunning(item),
              active: selectedConfig?.configFileName === item.configFileName
            }"
            @click="selectConfig(item)"
          >
            <span class="nw-row-icon" :class="{ on: getRunning(item) }">
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
            <span class="nw-row-text">
              <span class="nw-row-name">{{ item.configFileName }}</span>
              <span class="nw-row-sub">
                <span class="nw-dot" :class="getRunning(item) ? 'on' : 'off'"></span>
                <span class="nw-row-state">{{
                  getRunning(item) ? t('newCommon.running') : t('newCommon.stopped')
                }}</span>
                <span v-if="getRunningItem(item)?.pid" class="nw-row-extra"
                  >· PID {{ getRunningItem(item)?.pid }}</span
                >
                <span v-else-if="getRunningItem(item)?.virtualIp" class="nw-row-extra"
                  >· {{ getRunningItem(item)?.virtualIp }}</span
                >
              </span>
            </span>
            <LtButton
              :variant="getRunning(item) ? 'danger' : 'success-soft'"
              size="lg"
              circle
              :aria-label="getRunning(item) ? t('newCommon.stop') : t('newCommon.run')"
              @click.stop="getRunning(item) ? stopAction(item) : startAction(item)"
            >
              <svg
                v-if="getRunning(item)"
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
              <svg
                v-else
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7 4.8v14.4L19 12z" />
              </svg>
            </LtButton>
            <svg
              class="nw-row-chev"
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
        </template>
        <!-- 桌面：保留原有卡片列表 -->
        <template v-else>
          <div
            v-for="item in filteredConfigList"
            :key="item.configFileName"
            class="nw-card"
            :class="{ active: selectedConfig?.configFileName === item.configFileName }"
            @click="selectConfig(item)"
          >
            <div class="nw-card-top">
              <div class="nw-card-status">
                <span class="nw-dot" :class="getRunning(item) ? 'on' : 'off'"></span>
                <span class="nw-status-text">{{
                  getRunning(item) ? t('newCommon.running') : t('newCommon.stopped')
                }}</span>
              </div>
              <span v-if="getRunningItem(item)?.pid" class="nw-card-pid"
                >PID {{ getRunningItem(item)?.pid }}</span
              >
              <span v-else-if="getRunningItem(item)?.virtualIp" class="nw-card-pid"
                >IP {{ getRunningItem(item)?.virtualIp }}</span
              >
            </div>
            <div class="nw-card-name">{{ item.configFileName }}</div>
            <div class="nw-card-sub">{{ item.fileName }}</div>
            <div class="nw-card-actions" @click.stop>
              <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
              <LtButton
                :variant="getRunning(item) ? 'soft' : 'success'"
                size="compact"
                @click="getRunning(item) ? stopAction(item) : startAction(item)"
                >{{ getRunning(item) ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
              >
            </div>
          </div>
        </template>
      </TransitionGroup>
      <div
        v-if="easyTierStore.configList.length === 0 && !easyTierStore.configListLoading"
        class="nw-empty-cards"
      >
        <span class="nw-empty-icon">✦</span>
        <p class="nw-empty-title">{{ t('newConfig.emptyNoConfig') }}</p>
        <span class="nw-empty-desc">{{ t('newConfig.emptyHint') }}</span>
        <LtButton variant="primary" size="md" class="nw-empty-cta" @click="openAdd">
          {{ t('newCommon.createConfig') }}
        </LtButton>
      </div>
      <!-- 搜索无结果：与“无配置”区分，提供清除入口 -->
      <div
        v-else-if="filteredConfigList.length === 0 && !easyTierStore.configListLoading"
        class="nw-empty-cards"
      >
        <span class="nw-empty-icon">⌕</span>
        <p class="nw-empty-title">{{ t('newCommon.noSearchResult') }}</p>
        <LtButton variant="text" size="sm" class="nw-empty-cta" @click="configSearch = ''">
          {{ t('newCommon.clearSearch') }}
        </LtButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput } from '@/shared/ui'
import LoadingOverlay from '@/shared/ui/LoadingOverlay.vue'
import { useEasyTierStore } from '@/shared/store/easytier'
import { CONFIG_LIST_KEY } from './context'

defineOptions({ name: 'ConfigList' })

const easyTierStore = useEasyTierStore()
const { t } = useI18n()
const {
  isAndroidPlatform,
  configSearch,
  filteredConfigList,
  blurSearchInput,
  selectedConfig,
  getRunning,
  getRunningItem,
  selectConfig,
  openAdd,
  startAction,
  stopAction
} = inject(CONFIG_LIST_KEY)!
</script>

<style scoped lang="less">
@import url('./styles/list.less');
</style>
