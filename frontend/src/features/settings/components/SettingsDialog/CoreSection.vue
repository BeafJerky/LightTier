<template>
  <!-- 核心管理 -->
  <div
    id="sd-panel-core"
    class="sd-section"
    :role="single ? undefined : 'tabpanel'"
    :aria-labelledby="single ? undefined : 'sd-tab-core'"
    :tabindex="single ? undefined : 0"
  >
    <!-- 浏览器预览：无 Tauri 运行时，内核检测/路径/下载安装等桌面能力不可用 -->
    <div v-if="!isDesktopRuntime && !isAndroidPlatform" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.mockModeTitle') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.mockModeDesc') }}</span>
      </div>
    </div>

    <!-- 核心版本 -->
    <div class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.coreVersion') }}</span>
        <span class="sd-row-desc">{{
          isAndroidPlatform
            ? t('newSettings.androidBuiltinCoreDesc')
            : t('newSettings.coreVersionDesc')
        }}</span>
      </div>
      <div class="sd-core-ver-row">
        <span
          class="sd-core-ver-tag"
          :class="{
            'sd-core-ver-ok':
              coreVersion !== t('newSettings.notInstalled') &&
              coreVersion !== t('newCommon.checking')
          }"
          >{{ coreVersion }}</span
        >
        <LtButton
          v-if="isDesktopRuntime"
          variant="ghost"
          @click="handleCheckCore"
          :disabled="checkingCore"
        >
          {{ checkingCore ? t('newCommon.checking') : t('newSettings.recheck') }}
        </LtButton>
      </div>
    </div>

    <!-- 版本适配档案：表单字段 / CLI / 服务参数均按已安装内核切换 -->
    <div v-if="isDesktopRuntime" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.compatProfile') }}</span>
        <span class="sd-row-desc">{{ compatProfileDesc }}</span>
      </div>
    </div>

    <!-- 核心路径（Android 内核编译期内置，无独立路径） -->
    <div v-if="isDesktopRuntime" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.corePath') }}</span>
        <span class="sd-row-desc sd-row-desc-mono">{{ corePath }}</span>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div v-if="isDesktopRuntime" class="sd-row">
      <div class="sd-row-info">
        <span class="sd-row-title">{{ t('newSettings.openDir') }}</span>
        <span class="sd-row-desc">{{ t('newSettings.openDirDesc') }}</span>
      </div>
      <div class="sd-btn-group">
        <LtButton variant="ghost" @click="handleOpenCorePath">{{
          t('newSettings.coreDir')
        }}</LtButton>
        <LtButton variant="ghost" @click="handleOpenConfigPath">{{
          t('newSettings.configDir')
        }}</LtButton>
      </div>
    </div>

    <!-- 下载与安装（桌面换内核版本；Android 内核随应用更新） -->
    <div v-if="isDesktopRuntime" class="sd-core-install">
      <div class="sd-core-install-head">
        <div class="sd-core-install-title">{{ t('newSettings.downloadInstall') }}</div>
        <!-- 加速源入口：列表/增删放在下级弹窗，避免占用内核面板纵向空间 -->
        <LtButton
          type="button"
          variant="secondary"
          size="sm"
          class="sd-mirror-open"
          :title="t('newSettings.mirrorSourceDesc')"
          @click="openMirrorDialog"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h13l-3-3" />
            <path d="M20 17H7l3 3" />
          </svg>
          <span>{{ t('newSettings.mirrorSource') }}</span>
          <span class="sd-mirror-open-value" :title="currentMirrorLabel">{{
            currentMirrorLabel
          }}</span>
        </LtButton>
      </div>
      <div class="sd-core-install-hint">
        {{ t('newSettings.downloadInstallHint') }}
      </div>
      <div class="sd-core-install-status" :class="{ ready: selectedCoreReady }">
        {{ corePackageStatusText }}
      </div>
      <div class="sd-core-install-actions">
        <div class="sd-core-version-select">
          <LtButton
            :ref="setCoreVerTriggerRef"
            type="button"
            variant="ghost"
            size="sm"
            class="sd-core-version-trigger"
            :aria-label="t('newSettings.coreVersion')"
            aria-haspopup="listbox"
            :aria-expanded="coreVerDropdownOpen"
            :disabled="downloadingCore"
            @click.stop="toggleCoreVerDropdown"
            @keydown.down.prevent="openCoreVerDropdown(1)"
            @keydown.up.prevent="openCoreVerDropdown(-1)"
            @keydown.esc="closeCoreVerDropdown()"
          >
            <span class="sd-core-version-label">{{ coreVerOptionLabel(coreVerSelect) }}</span>
            <svg
              class="sd-core-version-caret"
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1l4 4 4-4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </LtButton>
          <Teleport to="body">
            <Transition name="sd-select-drop">
              <div
                v-if="coreVerDropdownOpen"
                :ref="setCoreVerMenuRef"
                class="sd-core-version-menu"
                :style="coreVerMenuStyle"
                role="listbox"
                :aria-label="t('newSettings.coreVersion')"
                @keydown.down.prevent="focusCoreVerOption(coreVerHighlighted + 1)"
                @keydown.up.prevent="focusCoreVerOption(coreVerHighlighted - 1)"
                @keydown.home.prevent="focusCoreVerOption(0)"
                @keydown.end.prevent="focusCoreVerOption(coreVerOptions.length - 1)"
                @keydown.esc.prevent="closeCoreVerDropdown(true)"
                @keydown.tab="closeCoreVerDropdown()"
              >
                <LtButton
                  v-for="(item, idx) in coreVerOptions"
                  :key="item.tag_name"
                  type="button"
                  variant="bare"
                  role="option"
                  class="sd-core-version-option"
                  :class="{ active: item.tag_name === coreVerSelect }"
                  :aria-selected="item.tag_name === coreVerSelect"
                  @click="selectCoreVersion(item.tag_name)"
                  @focus="coreVerHighlighted = idx"
                  @mouseenter="coreVerHighlighted = idx"
                >
                  {{ coreVerOptionLabel(item.tag_name) }}
                </LtButton>
              </div>
            </Transition>
          </Teleport>
        </div>
      </div>
      <div class="sd-core-install-actions">
        <LtButton
          variant="primary"
          @click="handleDownloadCore"
          :disabled="downloadingCore || mirrorProbing"
        >
          {{ downloadBtnText }}
        </LtButton>
        <LtButton
          variant="success"
          @click="handleInstallCore"
          :disabled="installingCore || downloadingCore || !selectedCoreReady"
        >
          {{ installingCore ? t('newCommon.installing') : t('newSettings.installCore') }}
        </LtButton>
        <LtButton
          v-if="isSelectedCoreDownloaded"
          variant="danger"
          @click="handleDeleteCorePackage"
          :disabled="deletingCore || downloadingCore || installingCore"
        >
          {{ deletingCore ? t('newSettings.deletingPackage') : t('newSettings.deleteCorePackage') }}
        </LtButton>
      </div>
      <!-- 下载进度：已知总大小时显示百分比进度条，缺失 Content-Length 时显示不确定态 -->
      <div v-if="downloadActive" class="sd-download-progress">
        <div
          class="sd-download-progress-track"
          role="progressbar"
          :aria-label="t('newSettings.downloadProgressLabel')"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="downloadPercent ?? undefined"
          :aria-valuetext="downloadProgressText"
        >
          <div
            class="sd-download-progress-fill"
            :class="{ 'is-indeterminate': downloadPercent === null }"
            :style="downloadPercent === null ? undefined : { width: `${downloadPercent}%` }"
          ></div>
        </div>
        <span class="sd-download-progress-text">{{ downloadProgressText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton } from '@/shared/ui'
import { SETTINGS_ENV_KEY, SETTINGS_KERNEL_KEY } from './context'

defineProps<{ single?: boolean }>()

const { t } = useI18n()
const { isDesktopRuntime, isAndroidPlatform } = inject(SETTINGS_ENV_KEY)!
const {
  checkingCore,
  corePath,
  coreVerOptions,
  coreVerSelect,
  downloadingCore,
  deletingCore,
  downloadActive,
  downloadPercent,
  downloadProgressText,
  isSelectedCoreDownloaded,
  selectedCoreReady,
  corePackageStatusText,
  coreVersion,
  compatProfileDesc,
  setCoreVerTriggerRef,
  setCoreVerMenuRef,
  coreVerDropdownOpen,
  coreVerHighlighted,
  coreVerMenuStyle,
  coreVerOptionLabel,
  focusCoreVerOption,
  openCoreVerDropdown,
  closeCoreVerDropdown,
  toggleCoreVerDropdown,
  selectCoreVersion,
  handleCheckCore,
  handleOpenCorePath,
  handleOpenConfigPath,
  handleDownloadCore,
  handleDeleteCorePackage,
  handleInstallCore,
  installingCore,
  mirrorProbing,
  currentMirrorLabel,
  downloadBtnText,
  openMirrorDialog
} = inject(SETTINGS_KERNEL_KEY)!
</script>

<style scoped lang="less">
@import url('./styles/common.less');

/* 核心管理 */
.sd-core-ver-row {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-shrink: 0;
}

.sd-row-desc-mono {
  font-family: var(--theme-font-body, 'Sora', monospace);
  font-size: 12px;
  word-break: break-all;
}

.sd-core-install {
  display: flex;
  padding: var(--theme-space-3);
  margin-top: var(--theme-space-3);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-md, 10px);
  flex-direction: column;
  gap: var(--theme-space-3);
}

.sd-core-install-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

/* 加速源入口：按钮内展示当前选中源，列表收进下级弹窗 */
.sd-mirror-open {
  max-width: 100%;
}

.sd-mirror-open-value {
  max-width: 190px;
  overflow: hidden;
  color: var(--theme-text-secondary, #7a6e5e);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sd-core-install-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.sd-core-install-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-secondary, #7a6e5e);
}

/* 所选版本安装包状态：已下载/内置为绿色，未下载提示先下载 */
.sd-core-install-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-color-warning, #d9a441);
}

.sd-core-install-status::before {
  width: 6px;
  height: 6px;
  background: currentcolor;
  border-radius: 50%;
  content: '';
  flex-shrink: 0;
}

.sd-core-install-status.ready {
  color: var(--theme-color-success, #7fba8a);
}

.sd-core-install-actions {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

/* 内核版本自定义下拉：需容纳版本号 + 渠道/已安装标记文本 */
.sd-core-version-select {
  max-width: 280px;
  min-width: 200px;
}

.sd-core-version-trigger {
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-2);
}

.sd-core-version-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sd-core-version-caret {
  color: var(--theme-text-secondary, #7a6e5e);
  transition: transform var(--theme-duration-fast) var(--theme-ease-out);
  flex-shrink: 0;
}

.sd-core-version-trigger[aria-expanded='true'] .sd-core-version-caret {
  transform: rotate(180deg);
}

/* 弹层 Teleport 到 body：避免被 .sd-content 的滚动容器裁剪 */
.sd-core-version-menu {
  position: fixed;
  z-index: 2100;
  display: flex;
  max-height: 240px;
  padding: 4px;
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
  box-shadow: var(--theme-shadow-md);
  box-sizing: border-box;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.sd-core-version-option {
  display: flex;
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm, 6px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  justify-content: flex-start;
}

.sd-core-version-option:hover,
.sd-core-version-option:focus-visible {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  outline: none;
}

.sd-core-version-option.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.sd-select-drop-enter-active {
  transition: opacity var(--theme-duration-fast) var(--theme-ease-out);
}

.sd-select-drop-leave-active {
  transition: opacity var(--theme-duration-fast) var(--theme-ease-in);
}

.sd-select-drop-enter-from,
.sd-select-drop-leave-to {
  opacity: 0;
}
</style>
