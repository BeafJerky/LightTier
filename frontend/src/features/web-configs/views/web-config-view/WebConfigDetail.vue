<template>
  <div class="nwc-right">
    <div class="nwc-detail-header">
      <div class="nwc-detail-title-row">
        <LtButton
          v-if="!isAndroid"
          class="nwc-back-btn"
          variant="ghost"
          size="sm"
          @click="emit('back')"
        >
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
        <h3 class="nwc-detail-title">{{ config.configFileName }}</h3>
        <span v-if="isAndroid && config.protocol" class="nwc-badge nwc-badge-proto">
          {{ config.protocol.toUpperCase() }}
        </span>
        <span
          v-if="!isAndroid"
          class="nwc-badge"
          :class="
            isWebChecking(config, isAndroid) ? 'checking' : isWebRunning(config) ? 'on' : 'off'
          "
        >
          {{
            isWebChecking(config, isAndroid)
              ? t('newCommon.checking')
              : isWebRunning(config)
                ? '● ' + t('newCommon.running')
                : '○ ' + t('newCommon.stopped')
          }}
        </span>
      </div>
      <div class="nwc-detail-actions">
        <LtButton variant="secondary" class="nwc-detail-btn" @click="emit('edit')">{{
          t('newCommon.edit')
        }}</LtButton>
        <LtButton
          v-if="isAndroid"
          variant="primary"
          class="nwc-detail-btn"
          :disabled="!config.webUrl"
          @click="emit('openConsole')"
          >{{ t('newWebConfig.openConsole') }}</LtButton
        >
        <!-- 窄屏列表不可见，详情保留唯一的上下文生命周期操作；宽屏由列表卡片承担 -->
        <LtButton
          v-if="!isAndroid"
          class="nwc-detail-lifecycle nwc-detail-btn"
          :variant="isWebRunning(config) ? 'soft' : 'success'"
          :disabled="isWebChecking(config, isAndroid)"
          @click="isWebRunning(config) ? emit('stop') : emit('start')"
          >{{ isWebRunning(config) ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
        >
        <LtButton
          v-if="!isAndroid"
          variant="danger"
          class="nwc-detail-btn"
          :disabled="isWebChecking(config, isAndroid)"
          @click="emit('delete')"
          >{{ t('newCommon.delete') }}</LtButton
        >
      </div>
    </div>

    <p v-if="isAndroid" class="nwc-platform-hint">
      {{ t('newWebConfig.androidDesktopOnly') }}
    </p>
    <p v-else-if="!serviceSupported" class="nwc-platform-hint">
      {{ t('newWebConfig.agentServiceHint') }}
    </p>

    <!-- 主要参数 -->
    <div class="nwc-section"
      ><div class="nwc-section-title">{{ t('newWebConfig.mainParams') }}</div>
      <div class="nwc-grid">
        <div class="nwc-field"
          ><span class="nwc-label">{{ t('newWebConfig.protocol') }}</span
          ><span class="nwc-val">{{ config.protocol || '—' }}</span></div
        >
        <div class="nwc-field"
          ><span class="nwc-label">{{ t('newWebConfig.host') }}</span
          ><span class="nwc-val">{{ config.host || '—' }}</span></div
        >
        <div class="nwc-field"
          ><span class="nwc-label">{{ t('newWebConfig.port') }}</span
          ><span class="nwc-val">{{ config.port || '—' }}</span></div
        >
        <div class="nwc-field"
          ><span class="nwc-label">{{ t('newWebConfig.username') }}</span
          ><span class="nwc-val">{{ config.userName || '—' }}</span></div
        >
        <div class="nwc-field"
          ><span class="nwc-label">{{ t('newWebConfig.consoleAddr') }}</span>
          <LtButton
            v-if="config.webUrl"
            variant="bare"
            class="nwc-val nwc-link"
            :title="config.webUrl"
            @click="emit('openConsole')"
            >{{ config.webUrl }}</LtButton
          >
          <span class="nwc-val" v-else>—</span>
        </div>
      </div>
    </div>

    <!-- 服务管理：Windows 服务能力，仅桌面端提供 -->
    <div v-if="!isAndroid && serviceSupported" class="nwc-section"
      ><div class="nwc-section-title">{{ t('newWebConfig.serviceMgmt') }}</div>
      <div class="nwc-svc-bar">
        <div class="nwc-svc-status">
          <span class="nwc-svc-dot" :class="serviceDotClass"></span>
          <span class="nwc-svc-text">{{
            serviceStatus ? mapServiceStatus(serviceStatus) : t('newCommon.checking')
          }}</span>
        </div>
        <div class="nwc-svc-actions">
          <template v-if="serviceStatus === 'notInstalled'">
            <LtButton variant="primary" @click="emit('installService')">{{
              t('newWebConfig.installService')
            }}</LtButton>
          </template>
          <!-- 状态无法确认：不再提供会必然失败的启动，改为重检测或显式清理 -->
          <template v-else-if="serviceStatus === 'unknown'">
            <LtButton variant="secondary" size="sm" @click="emit('recheckService')">{{
              t('newSettings.recheck')
            }}</LtButton>
            <LtButton variant="ghost" size="sm" @click="emit('uninstallService')">{{
              t('newConfig.uninstall')
            }}</LtButton>
          </template>
          <template v-else-if="serviceStatus === 'starting' || serviceStatus === 'stopping'">
            <LtButton variant="secondary" size="sm" @click="emit('recheckService')">{{
              t('newSettings.recheck')
            }}</LtButton>
            <LtButton variant="ghost" size="sm" @click="emit('uninstallService')">{{
              t('newConfig.uninstall')
            }}</LtButton>
          </template>
          <template v-else-if="serviceStatus">
            <LtButton
              variant="success"
              size="sm"
              :disabled="serviceStatus !== 'stopped'"
              @click="emit('startService')"
              >{{ t('newCommon.start') }}</LtButton
            >
            <LtButton
              variant="soft"
              size="sm"
              :disabled="serviceStatus !== 'running' && serviceStatus !== 'paused'"
              @click="emit('stopService')"
              >{{ t('newCommon.stop') }}</LtButton
            >
            <LtButton variant="ghost" size="sm" @click="emit('uninstallService')">{{
              t('newConfig.uninstall')
            }}</LtButton>
          </template>
        </div>
      </div>
    </div>

    <!-- Android：破坏性操作独立成行，避免与常用操作挤在头部 -->
    <div v-if="isAndroid" class="nwc-danger-zone">
      <LtButton variant="danger" size="lg" block class="nwc-danger-btn" @click="emit('delete')">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </svg>
        {{ t('newCommon.delete') }}
      </LtButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'
import type { FormWebData } from '@/entities/config/formTypes'
import { isWebChecking, isWebRunning } from '../../lib/webConfigStatus'

const props = withDefaults(
  defineProps<{
    config: FormWebData
    isAndroid: boolean
    serviceStatus: string
    /** 是否具备本机 Windows 服务能力；agent 由服务端托管进程，无此能力 */
    serviceSupported?: boolean
  }>(),
  { serviceSupported: true }
)

const emit = defineEmits<{
  back: []
  edit: []
  openConsole: []
  start: []
  stop: []
  delete: []
  installService: []
  startService: []
  stopService: []
  uninstallService: []
  recheckService: []
}>()

const { t } = useI18n()

// 将 useMockData 返回的原始状态 key 映射为国际化字符串
const mapServiceStatus = (key: string): string => {
  switch (key) {
    case 'running':
      return t('newCommon.running')
    case 'starting':
      return t('newCommon.starting')
    case 'stopped':
      return t('newWebConfig.stoppedService')
    case 'stopping':
      return t('newCommon.stopping')
    case 'paused':
      return t('newCommon.paused')
    case 'notInstalled':
      return t('newConfig.notInstalled')
    case 'unknown':
      return t('newSettings.unknown')
    default:
      return key
  }
}

const serviceDotClass = computed(() => {
  const s = props.serviceStatus
  if (s === 'running') return 'svc-running'
  if (s === 'stopped') return 'svc-stopped'
  if (s === 'starting' || s === 'stopping') return 'svc-starting'
  if (s === 'paused') return 'svc-paused'
  if (!s) return 'svc-checking'
  return 'svc-uninstalled'
})
</script>

<style scoped lang="less">
@import url('./styles/detail.less');
</style>
