<template>
  <!-- 关于 -->
  <div
    id="sd-panel-about"
    class="sd-section"
    :role="single ? undefined : 'tabpanel'"
    :aria-labelledby="single ? undefined : 'sd-tab-about'"
    :tabindex="single ? undefined : 0"
  >
    <div class="sd-about">
      <img class="sd-about-logo" src="/logo.png" alt="" />
      <div class="sd-about-info">
        <h3 class="sd-about-name">LightTier</h3>
        <span class="sd-about-ver">v{{ appVersion }}</span>
      </div>
    </div>
    <div class="sd-about-links">
      <a
        class="sd-about-link"
        :href="MANAGER_REPO_HOME"
        target="_blank"
        rel="noopener"
        @click.prevent="openExternalLink(MANAGER_REPO_HOME)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          />
        </svg>
        {{ t('newSettings.repo') }}
      </a>
      <a
        class="sd-about-link"
        :href="GITHUB_EASYTIER"
        target="_blank"
        rel="noopener"
        @click.prevent="openExternalLink(GITHUB_EASYTIER)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          />
        </svg>
        {{ t('newSettings.easytierCore') }}
      </a>
    </div>
    <!-- 内核版本已移至“核心管理”（随安装/切换实时变化），关于页只保留应用自身信息 -->

    <!-- 检查更新（5.11）：GitHub Release 已发布，入口开放 -->
    <div v-if="UPDATE_CHECK_ENABLED" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.checkUpdate') }}</span>
        <span class="sd-row-desc">{{ updateDesc }}</span>
      </div>
      <div class="sd-btn-group">
        <span
          v-if="latestManagerVersion && !updateCheckError"
          class="sd-core-ver-tag"
          :class="{ 'sd-core-ver-ok': hasManagerUpdate }"
          >{{ latestManagerVersion }}</span
        >
        <LtButton
          v-if="hasManagerUpdate"
          type="button"
          variant="primary"
          @click="handleOpenManagerReleases"
          >{{ t('newSettings.goDownload') }}</LtButton
        >
        <LtButton
          type="button"
          variant="ghost"
          @click="handleCheckUpdate"
          :disabled="checkingUpdate"
        >
          {{ checkingUpdate ? t('newCommon.checking') : t('newSettings.checkUpdate') }}
        </LtButton>
      </div>
    </div>

    <!-- 应用内更新：按加速源下载安装包到应用目录（resource/update），下载完一键拉起安装器 -->
    <div v-if="canInAppUpdate" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.inAppUpdate') }}</span>
        <span class="sd-row-desc">{{ inAppUpdateDesc }}</span>
      </div>
      <div class="sd-core-install-actions">
        <LtButton
          v-if="!updateDownloaded"
          variant="primary"
          @click="handleDownloadManagerUpdate"
          :disabled="updating || mirrorProbing"
        >
          {{ updateDownloadBtnText }}
        </LtButton>
        <LtButton
          v-else
          variant="success"
          @click="handleRunManagerInstaller"
          :disabled="launchingInstaller"
        >
          {{
            launchingInstaller ? t('newSettings.installingUpdate') : t('newSettings.runInstaller')
          }}
        </LtButton>
        <!-- 进度条已下载完不再展示 -->
        <div v-if="updateActive && !updateDownloaded" class="sd-download-progress">
          <div
            class="sd-download-progress-track"
            role="progressbar"
            :aria-label="t('newSettings.updateProgressLabel')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="updatePercent ?? undefined"
            :aria-valuetext="updateProgressText"
          >
            <div
              class="sd-download-progress-fill"
              :class="{ 'is-indeterminate': updatePercent === null }"
              :style="updatePercent === null ? undefined : { width: `${updatePercent}%` }"
            ></div>
          </div>
          <span class="sd-download-progress-text">{{ updateProgressText }}</span>
        </div>
      </div>
    </div>

    <label
      v-if="UPDATE_CHECK_ENABLED"
      class="sd-row"
      @click="handleUpdateStableOnlyToggle(!store.updateStableOnly)"
    >
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.updateStableOnly') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.updateStableOnlyDesc') }}</span>
      </div>
      <LtSwitch
        :model-value="store.updateStableOnly"
        :aria-label="t('newSettings.updateStableOnly')"
        @update:model-value="handleUpdateStableOnlyToggle"
        @click.stop
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtSwitch } from '@/shared/ui'
import { useEasyTierStore } from '@/shared/store/easytier'
import { GITHUB_EASYTIER, MANAGER_REPO_HOME } from '@/shared/constants/easytier'
import { SETTINGS_UPDATE_KEY } from './context'
import { UPDATE_CHECK_ENABLED } from '../../composables/useSettingsUpdate'

defineProps<{ single?: boolean }>()

const store = useEasyTierStore()
const { t } = useI18n()
const {
  appVersion,
  checkingUpdate,
  updateCheckError,
  latestManagerVersion,
  hasManagerUpdate,
  updateDesc,
  handleUpdateStableOnlyToggle,
  handleCheckUpdate,
  openExternalLink,
  handleOpenManagerReleases,
  canInAppUpdate,
  updating,
  launchingInstaller,
  updateActive,
  updateDownloaded,
  updatePercent,
  updateProgressText,
  updateDownloadBtnText,
  inAppUpdateDesc,
  handleDownloadManagerUpdate,
  handleRunManagerInstaller,
  mirrorProbing
} = inject(SETTINGS_UPDATE_KEY)!
</script>

<style scoped lang="less">
@import url('./styles/common.less');

/* 关于页 */
.sd-about {
  display: flex;
  padding: var(--theme-space-4) 0;
  margin-bottom: var(--theme-space-2);
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
  align-items: center;
  gap: var(--theme-space-4);
}

.sd-about-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.sd-about-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sd-about-name {
  margin: 0;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.sd-about-ver {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-about-links {
  display: flex;
  padding: var(--theme-space-2) 0;
  margin-bottom: var(--theme-space-2);
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
  gap: var(--theme-space-2);
}

.sd-about-link {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  text-decoration: none;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-sm, 6px);
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: var(--theme-space-2);
}

.sd-about-link:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

/* 应用内更新的动作行与内核安装一致 */
.sd-core-install-actions {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}
</style>
