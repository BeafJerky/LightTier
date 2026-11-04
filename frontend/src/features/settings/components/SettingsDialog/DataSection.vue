<template>
  <!-- 数据管理 -->
  <div
    id="sd-panel-data"
    class="sd-section"
    :role="single ? undefined : 'tabpanel'"
    :aria-labelledby="single ? undefined : 'sd-tab-data'"
    :tabindex="single ? undefined : 0"
  >
    <!-- 备份与恢复：Android 无可靠的绝对路径保存/读取能力，入口仅桌面与浏览器预览 -->
    <div v-if="!isAndroidPlatform" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.backupRestore') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.backupRestoreDesc') }}</span>
      </div>
      <LtButton variant="ghost" @click="backupDialogVisible = true">
        {{ t('newSettings.backupRestoreOpen') }}
      </LtButton>
    </div>

    <div class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.clearCache') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.clearCacheDesc') }}</span>
      </div>
      <LtButton variant="danger" @click="handleClearCache" :disabled="clearingCache">
        {{ clearingCache ? t('newSettings.clearing') : t('newSettings.clearCache') }}
      </LtButton>
    </div>

    <div class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.clearLogs') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.clearLogsDesc') }}</span>
      </div>
      <LtButton variant="danger" @click="handleClearLogs" :disabled="clearingLogs">
        {{ clearingLogs ? t('newSettings.clearing') : t('newSettings.clearLogs') }}
      </LtButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'
import { SETTINGS_DATA_KEY, SETTINGS_ENV_KEY } from './context'

defineProps<{ single?: boolean }>()

const { t } = useI18n()
const { isAndroidPlatform } = inject(SETTINGS_ENV_KEY)!
const { clearingCache, clearingLogs, backupDialogVisible, handleClearCache, handleClearLogs } =
  inject(SETTINGS_DATA_KEY)!
</script>

<style scoped lang="less">
@import url('./styles/common.less');
</style>
