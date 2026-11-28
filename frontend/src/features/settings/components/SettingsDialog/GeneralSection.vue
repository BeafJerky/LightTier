<template>
  <!-- 通用设置 -->
  <div
    id="sd-panel-general"
    class="sd-section"
    :role="single ? undefined : 'tabpanel'"
    :aria-labelledby="single ? undefined : 'sd-tab-general'"
    :tabindex="single ? undefined : 0"
  >
    <label class="sd-row" @click="handleAutoRunToggle(!store.autoRunNetworkSetting)">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.autoRun') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.autoRunDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="store.autoRunNetworkSetting"
        :aria-label="t('newSettings.autoRun')"
        @update:model-value="handleAutoRunToggle"
        @click.stop
      />
    </label>

    <div v-if="store.autoRunNetworkSetting && !isAgentMode" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.autoRunConfig') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.autoRunConfigDesc') }}</span>
      </div>
      <div class="sd-select-field">
        <LtSelect
          :model-value="store.autoRunConfigName"
          :options="autoRunConfigOptions"
          :aria-label="t('newSettings.autoRunConfig')"
          @update:model-value="handleAutoRunConfigSelect"
        />
      </div>
    </div>

    <div v-if="isAgentMode && store.autoRunNetworkSetting" class="sd-row">
      <span class="sd-row-desc">{{ t('newSettings.agentAutoRunHint') }}</span>
    </div>

    <label v-if="isDesktopRuntime" class="sd-row" @click="setMinimizeOnStart(!minimizeOnStart)">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.minimizeOnStart') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.minimizeOnStartDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="minimizeOnStart"
        :aria-label="t('newSettings.minimizeOnStart')"
        @update:model-value="setMinimizeOnStart"
        @click.stop
      />
    </label>

    <div class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.refreshInterval') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.refreshIntervalDesc') }}</span>
      </div>
      <div class="sd-number-wrap">
        <LtInput
          v-model="refreshInput"
          class="sd-number"
          variant="filled"
          inputmode="numeric"
          :maxlength="2"
          :aria-label="t('newSettings.refreshInterval')"
          :aria-invalid="!!refreshError"
          :aria-describedby="refreshError ? 'sd-refresh-error' : undefined"
          @input="refreshError = ''"
          @blur="commitRefreshInterval"
          @keyup.enter="commitRefreshInterval"
        />
        <span id="sd-refresh-error" v-if="refreshError" class="sd-field-error" role="alert">{{
          refreshError
        }}</span>
      </div>
    </div>

    <div v-if="isDesktopRuntime && servicesSupported" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.defaultServiceMethod') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.defaultServiceMethodDesc') }}</span>
      </div>
      <div class="sd-select-field">
        <LtSelect
          :model-value="store.defaultServiceInstallMethod"
          :options="serviceMethodOptions"
          :aria-label="t('newSettings.defaultServiceMethod')"
          @update:model-value="handleServiceMethodSelect"
        />
      </div>
    </div>

    <label
      v-if="isDesktopRuntime"
      class="sd-row"
      @click="store.defaultEnableAutostart = !store.defaultEnableAutostart"
    >
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.defaultAutostart') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.defaultAutostartDesc') }}</span>
      </div>
      <LtSwitch
        v-model="store.defaultEnableAutostart"
        :aria-label="t('newSettings.defaultAutostart')"
        @click.stop
      />
    </label>

    <!-- agent：服务端运行时设置（noTun / 日志级别） -->
    <template v-if="isAgentMode">
      <label
        class="sd-row"
        :class="{ 'is-disabled': agentSettingsBusy }"
        @click="handleAgentNoTunToggle(!agentNoTun)"
      >
        <div class="sd-row-info">
          <span class="sd-row-title">{{ t('newSettings.agentNoTun') }}</span>
          <span class="sd-row-desc">{{ t('newSettings.agentNoTunDesc') }}</span>
        </div>
        <LtSwitch
          :model-value="agentNoTun"
          :disabled="agentSettingsBusy"
          :aria-label="t('newSettings.agentNoTun')"
          @update:model-value="handleAgentNoTunToggle"
          @click.stop
        />
      </label>

      <div class="sd-row" :class="{ 'is-disabled': agentSettingsBusy }">
        <div class="sd-row-info">
          <span class="sd-row-title">{{ t('newSettings.agentLogLevel') }}</span>
          <span class="sd-row-desc">{{ t('newSettings.agentLogLevelDesc') }}</span>
        </div>
        <div class="sd-select-field">
          <LtSelect
            :model-value="agentLogLevel"
            :options="logLevelOptions"
            :disabled="agentSettingsBusy"
            :aria-label="t('newSettings.agentLogLevel')"
            @update:model-value="handleAgentLogLevelSelect"
          />
        </div>
      </div>

      <div v-if="agentSettingsError" class="sd-row">
        <span class="sd-field-error" role="alert">{{ agentSettingsError }}</span>
      </div>
    </template>

    <!-- P2P 直连通知（5.4） -->
    <label class="sd-row" @click="store.p2pNotifySetting = !store.p2pNotifySetting">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.p2pNotify') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.p2pNotifyDesc') }}</span>
      </div>
      <LtSwitch
        v-model="store.p2pNotifySetting"
        :aria-label="t('newSettings.p2pNotify')"
        @click.stop
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtInput, LtSelect, LtSwitch } from '@/shared/ui'
import { useEasyTierStore } from '@/shared/store/easytier'
import { injectRequired } from '@/shared/lib/inject'
import { SETTINGS_ENV_KEY, SETTINGS_PREFERENCES_KEY } from './context'

defineProps<{ single?: boolean }>()

const store = useEasyTierStore()
const { t } = useI18n()
const { isDesktopRuntime, capabilities } = injectRequired(SETTINGS_ENV_KEY, 'GeneralSection')
// agent 下服务能力关闭时隐藏“默认服务安装方式”（原生/预览始终可见）
const servicesSupported = !capabilities || capabilities.services
const {
  isAgentMode,
  refreshInput,
  refreshError,
  commitRefreshInterval,
  minimizeOnStart,
  setMinimizeOnStart,
  agentNoTun,
  agentLogLevel,
  agentSettingsBusy,
  agentSettingsError,
  logLevelOptions,
  handleAutoRunToggle,
  handleAgentNoTunToggle,
  handleAgentLogLevelSelect,
  autoRunConfigOptions,
  handleAutoRunConfigSelect,
  serviceMethodOptions,
  handleServiceMethodSelect
} = injectRequired(SETTINGS_PREFERENCES_KEY, 'GeneralSection')
</script>

<style scoped lang="less">
@import url('./styles/common.less');

.sd-row.is-disabled {
  opacity: 0.55;
}

/* 下拉选择：固定宽度，避免挤压左侧说明 */
.sd-select-field {
  width: 220px;
  max-width: 100%;
  flex-shrink: 0;
}

/* 数字输入 */
.sd-number-wrap .sd-number {
  width: 90px;
  flex-shrink: 0;
}

.sd-number-wrap .sd-number :deep(.n-input__input-el) {
  font-size: 13px;
  text-align: center;
}

.sd-number-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
</style>
