<template>
  <div class="nm-detail-header" :class="{ 'nm-detail-hero-on': showStatus && running }">
    <div class="nm-detail-title-row">
      <LtButton v-if="showBack" variant="ghost" size="sm" class="nm-back-btn" @click="emit('back')">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {{ t('newCommon.back') }}
      </LtButton>
      <h3 class="nm-detail-title">{{ name }}</h3>
      <template v-if="showStatus">
        <span class="nm-badge" :class="running ? 'on' : 'off'">
          {{ running ? '● ' + t('newCommon.running') : '○ ' + t('newCommon.stopped') }}
        </span>
        <span v-if="rpcPortal" class="nm-detail-rpc">
          RPC {{ rpcPortal.replace('127.0.0.1', 'localhost') }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'

defineProps<{
  name?: string
  running: boolean
  rpcPortal?: string
  showBack: boolean
  showStatus: boolean
}>()

const emit = defineEmits<{
  back: []
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/detailHeader.less');
</style>
