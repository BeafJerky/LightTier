<template>
  <CreamDialog
    v-model="visible"
    :title="t('newSettings.settings')"
    width="700px"
    height="720px"
    :inline="inline"
    :body-scroll="false"
  >
    <div class="sd-body">
      <!-- 左侧分类导航（tablist：方向键移动并激活，roving tabindex） -->
      <div
        ref="navRef"
        class="sd-nav"
        role="tablist"
        aria-orientation="vertical"
        :aria-label="t('newSettings.tabsLabel')"
      >
        <button
          v-for="(tab, idx) in tabs"
          :key="tab.key"
          :id="`sd-tab-${tab.key}`"
          :ref="(el) => setTabRef(el, idx)"
          class="sd-nav-item"
          :class="{ active: activeTab === tab.key }"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`sd-panel-${tab.key}`"
          :tabindex="activeTab === tab.key ? 0 : -1"
          @click="selectTab(tab.key)"
          @keydown="handleTabKeydown($event, idx)"
        >
          <span class="sd-nav-icon">
            <svg
              v-if="tab.key === 'general'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <svg
              v-else-if="tab.key === 'core'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <path d="M6 6h.01M6 18h.01" />
            </svg>
            <svg
              v-else-if="tab.key === 'data'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7" />
              <path d="M16 3H8c-2 0-3 1-3 3v1h14V6c0-2-1-3-3-3z" />
              <path d="M9 12h6M9 16h6" />
            </svg>
            <svg
              v-else-if="tab.key === 'security'"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <svg
              v-else
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </span>
          <span class="sd-nav-label">{{ tab.label }}</span>
        </button>
      </div>

      <!-- 右侧内容区（唯一纵向滚动容器） -->
      <div ref="contentRef" class="sd-content">
        <!-- 通用设置 -->
        <div
          v-if="activeTab === 'general'"
          id="sd-panel-general"
          class="sd-section"
          role="tabpanel"
          aria-labelledby="sd-tab-general"
          tabindex="0"
        >
          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.autoRun') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.autoRunDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input
                type="checkbox"
                v-model="store.autoRunNetworkSetting"
                :aria-label="t('newSettings.autoRun')"
                @change="handleAutoRunToggle"
              />
              <span class="sd-switch-slider"></span>
            </label>
          </div>

          <div v-if="store.autoRunNetworkSetting" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.autoRunConfig') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.autoRunConfigDesc') }}</span>
            </div>
            <select
              class="sd-select"
              :value="store.autoRunConfigName"
              :aria-label="t('newSettings.autoRunConfig')"
              @change="handleAutoRunConfigSelect"
            >
              <option value="">{{ t('newSettings.lastRunConfig') }}</option>
              <option
                v-for="item in store.configList"
                :key="item.configFileName"
                :value="item.configFileName"
              >
                {{ item.configFileName }}
              </option>
            </select>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.refreshInterval') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.refreshIntervalDesc') }}</span>
            </div>
            <div class="sd-number-wrap">
              <input
                v-model="refreshInput"
                type="number"
                class="sd-number"
                :class="{ invalid: !!refreshError }"
                min="1"
                max="60"
                step="1"
                inputmode="numeric"
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

          <div v-if="isDesktopRuntime" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.defaultServiceMethod') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.defaultServiceMethodDesc') }}</span>
            </div>
            <select
              class="sd-select"
              :value="store.defaultServiceInstallMethod"
              :aria-label="t('newSettings.defaultServiceMethod')"
              @change="handleServiceMethodSelect"
            >
              <option value="nssm">NSSM</option>
              <option value="official">{{ t('newWebConfig.officialCli') }}</option>
            </select>
          </div>

          <div v-if="isDesktopRuntime" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.defaultAutostart') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.defaultAutostartDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input
                type="checkbox"
                v-model="store.defaultEnableAutostart"
                :aria-label="t('newSettings.defaultAutostart')"
              />
              <span class="sd-switch-slider"></span>
            </label>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.errorNotify') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.errorNotifyDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input
                type="checkbox"
                v-model="store.errRunNotify"
                :aria-label="t('newSettings.errorNotify')"
              />
              <span class="sd-switch-slider"></span>
            </label>
          </div>

          <!-- P2P 直连通知（5.4） -->
          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.p2pNotify') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.p2pNotifyDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input
                type="checkbox"
                v-model="store.p2pNotifySetting"
                :aria-label="t('newSettings.p2pNotify')"
              />
              <span class="sd-switch-slider"></span>
            </label>
          </div>
        </div>

        <!-- 核心管理 -->
        <div
          v-if="activeTab === 'core'"
          id="sd-panel-core"
          class="sd-section"
          role="tabpanel"
          aria-labelledby="sd-tab-core"
          tabindex="0"
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
              <button
                v-if="isDesktopRuntime"
                class="sd-btn sd-btn-ghost"
                @click="handleCheckCore"
                :disabled="checkingCore"
              >
                {{ checkingCore ? t('newCommon.checking') : t('newSettings.recheck') }}
              </button>
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
              <button class="sd-btn sd-btn-ghost" @click="handleOpenCorePath">{{
                t('newSettings.coreDir')
              }}</button>
              <button class="sd-btn sd-btn-ghost" @click="handleOpenConfigPath">{{
                t('newSettings.configDir')
              }}</button>
            </div>
          </div>

          <!-- 下载与安装（桌面换内核版本；Android 内核随应用更新） -->
          <div v-if="isDesktopRuntime" class="sd-core-install">
            <div class="sd-core-install-head">
              <div class="sd-core-install-title">{{ t('newSettings.downloadInstall') }}</div>
              <!-- 加速源入口：列表/增删放在下级弹窗，避免占用内核面板纵向空间 -->
              <button
                type="button"
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
              </button>
            </div>
            <div class="sd-core-install-hint">
              {{ t('newSettings.downloadInstallHint') }}
            </div>
            <div class="sd-core-install-status" :class="{ ready: selectedCoreReady }">
              {{ corePackageStatusText }}
            </div>
            <div class="sd-core-install-actions">
              <div class="sd-core-version-select">
                <button
                  ref="coreVerTriggerRef"
                  type="button"
                  class="sd-select sd-core-version-trigger"
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
                </button>
                <Teleport to="body">
                  <Transition name="sd-select-drop">
                    <div
                      v-if="coreVerDropdownOpen"
                      ref="coreVerMenuRef"
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
                      <button
                        v-for="(item, idx) in coreVerOptions"
                        :key="item.tag_name"
                        type="button"
                        role="option"
                        class="sd-core-version-option"
                        :class="{ active: item.tag_name === coreVerSelect }"
                        :aria-selected="item.tag_name === coreVerSelect"
                        @click="selectCoreVersion(item.tag_name)"
                        @focus="coreVerHighlighted = idx"
                        @mouseenter="coreVerHighlighted = idx"
                      >
                        {{ coreVerOptionLabel(item.tag_name) }}
                      </button>
                    </div>
                  </Transition>
                </Teleport>
              </div>
            </div>
            <div class="sd-core-install-actions">
              <button
                class="sd-btn sd-btn-primary"
                @click="handleDownloadCore"
                :disabled="downloadingCore || mirrorProbing"
              >
                {{ downloadBtnText }}
              </button>
              <button
                class="sd-btn sd-btn-success"
                @click="handleInstallCore"
                :disabled="installingCore || downloadingCore || !selectedCoreReady"
              >
                {{ installingCore ? t('newCommon.installing') : t('newSettings.installCore') }}
              </button>
              <button
                v-if="isSelectedCoreDownloaded"
                class="sd-btn sd-btn-danger"
                @click="handleDeleteCorePackage"
                :disabled="deletingCore || downloadingCore || installingCore"
              >
                {{
                  deletingCore
                    ? t('newSettings.deletingPackage')
                    : t('newSettings.deleteCorePackage')
                }}
              </button>
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

        <!-- 数据管理 -->
        <div
          v-if="activeTab === 'data'"
          id="sd-panel-data"
          class="sd-section"
          role="tabpanel"
          aria-labelledby="sd-tab-data"
          tabindex="0"
        >
          <!-- 备份与恢复：Android 无可靠的绝对路径保存/读取能力，入口仅桌面与浏览器预览 -->
          <div v-if="!isAndroidPlatform" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.backupRestore') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.backupRestoreDesc') }}</span>
            </div>
            <button class="sd-btn sd-btn-ghost" @click="backupDialogVisible = true">
              {{ t('newSettings.backupRestoreOpen') }}
            </button>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.clearCache') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.clearCacheDesc') }}</span>
            </div>
            <button
              class="sd-btn sd-btn-danger"
              @click="handleClearCache"
              :disabled="clearingCache"
            >
              {{ clearingCache ? t('newSettings.clearing') : t('newSettings.clearCache') }}
            </button>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.clearLogs') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.clearLogsDesc') }}</span>
            </div>
            <button class="sd-btn sd-btn-danger" @click="handleClearLogs" :disabled="clearingLogs">
              {{ clearingLogs ? t('newSettings.clearing') : t('newSettings.clearLogs') }}
            </button>
          </div>
        </div>

        <!-- 安全（锁定密码，5.12） -->
        <div
          v-if="activeTab === 'security'"
          id="sd-panel-security"
          class="sd-section"
          role="tabpanel"
          aria-labelledby="sd-tab-security"
          tabindex="0"
        >
          <div class="sd-security-card">
            <div class="sd-security-head">
              <div class="sd-security-title">
                <span class="sd-row-title">{{ t('newSettings.lockPassword') }}</span>
                <span class="sd-lock-status" :class="{ on: !!store.lockPassword }">
                  {{
                    store.lockPassword
                      ? t('newSettings.lockPasswordEnabled')
                      : t('newSettings.lockPasswordDisabled')
                  }}
                </span>
              </div>
              <span class="sd-row-desc">{{ t('newSettings.lockPasswordDesc') }}</span>
            </div>

            <!-- 未设置密码，或已设置且点击“修改密码”时显示双输入表单 -->
            <div v-if="!store.lockPassword || lockEditMode" class="sd-lock-form">
              <div class="sd-lock-fields">
                <div class="sd-lock-field">
                  <label class="sd-lock-label" for="sd-lock-new">{{
                    t('newSettings.lockPasswordNew')
                  }}</label>
                  <div class="sd-lock-input-bar">
                    <input
                      id="sd-lock-new"
                      ref="lockPwdInputRef"
                      class="sd-lock-input"
                      :type="lockPwdVisible ? 'text' : 'password'"
                      v-model="lockPwdInput"
                      :placeholder="t('newSettings.lockPasswordNewPlaceholder')"
                      :aria-label="t('newSettings.lockPasswordNew')"
                      :aria-invalid="!!lockPwdError"
                      :aria-describedby="lockPwdError ? 'sd-lock-error' : undefined"
                      autocomplete="new-password"
                      maxlength="32"
                      @input="lockPwdError = ''"
                      @keyup.enter="commitLockPassword"
                    />
                    <button
                      class="sd-lock-eye"
                      type="button"
                      @mousedown.prevent
                      @click="lockPwdVisible = !lockPwdVisible"
                      :title="
                        lockPwdVisible ? t('newSettings.lockPwdHide') : t('newSettings.lockPwdShow')
                      "
                      :aria-label="
                        lockPwdVisible ? t('newSettings.lockPwdHide') : t('newSettings.lockPwdShow')
                      "
                      :aria-pressed="lockPwdVisible"
                    >
                      <svg
                        v-if="lockPwdVisible"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                        />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      <svg
                        v-else
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="sd-lock-field">
                  <label class="sd-lock-label" for="sd-lock-confirm">{{
                    t('newSettings.lockPasswordConfirm')
                  }}</label>
                  <input
                    id="sd-lock-confirm"
                    class="sd-lock-input"
                    :type="lockPwdVisible ? 'text' : 'password'"
                    v-model="lockPwdConfirm"
                    :placeholder="t('newSettings.lockPasswordConfirmPlaceholder')"
                    :aria-label="t('newSettings.lockPasswordConfirm')"
                    :aria-invalid="!!lockPwdError"
                    :aria-describedby="lockPwdError ? 'sd-lock-error' : undefined"
                    autocomplete="new-password"
                    maxlength="32"
                    @input="lockPwdError = ''"
                    @keyup.enter="commitLockPassword"
                  />
                </div>
              </div>
              <span v-if="lockPwdError" id="sd-lock-error" class="sd-field-error" role="alert">{{
                lockPwdError
              }}</span>
              <div class="sd-lock-actions">
                <button
                  v-if="store.lockPassword"
                  class="sd-btn sd-btn-ghost"
                  type="button"
                  @click="cancelLockEdit"
                  >{{ t('newCommon.cancel') }}</button
                >
                <button class="sd-btn sd-btn-primary" type="button" @click="commitLockPassword">{{
                  store.lockPassword
                    ? t('newSettings.lockPasswordSave')
                    : t('newSettings.lockPasswordSet')
                }}</button>
              </div>
            </div>
            <div v-else class="sd-lock-actions">
              <button class="sd-btn" type="button" @click="startLockEdit">{{
                t('newSettings.lockPasswordChange')
              }}</button>
              <button class="sd-btn sd-btn-danger" type="button" @click="handleClearLockPassword">{{
                t('newSettings.lockPasswordClear')
              }}</button>
            </div>
          </div>
        </div>

        <!-- 关于 -->
        <div
          v-if="activeTab === 'about'"
          id="sd-panel-about"
          class="sd-section"
          role="tabpanel"
          aria-labelledby="sd-tab-about"
          tabindex="0"
        >
          <div class="sd-about">
            <img class="sd-about-logo" src="/logo.png" alt="" />
            <div class="sd-about-info">
              <h3 class="sd-about-name">LightTier</h3>
              <span class="sd-about-ver">v{{ appVersion }}</span>
            </div>
          </div>
          <div class="sd-about-links">
            <a class="sd-about-link" :href="MANAGER_REPO_HOME" target="_blank" rel="noopener">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              {{ t('newSettings.repo') }}
            </a>
            <a
              class="sd-about-link"
              href="https://github.com/EasyTier/EasyTier"
              target="_blank"
              rel="noopener"
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
              <button
                v-if="hasManagerUpdate"
                type="button"
                class="sd-btn sd-btn-primary"
                @click="handleOpenManagerReleases"
                >{{ t('newSettings.goDownload') }}</button
              >
              <button
                type="button"
                class="sd-btn sd-btn-ghost"
                @click="handleCheckUpdate"
                :disabled="checkingUpdate"
              >
                {{ checkingUpdate ? t('newCommon.checking') : t('newSettings.checkUpdate') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </CreamDialog>

  <!-- 备份与恢复（数据管理的下级弹窗） -->
  <BackupDialog v-model="backupDialogVisible" />

  <!-- 加速源管理（内核下载与安装的下级弹窗） -->
  <CreamDialog v-model="mirrorDialogVisible" :title="t('newSettings.mirrorSource')" width="560px">
    <div class="sd-mirror-dialog">
      <div class="sd-mirror-dialog-head">
        <span class="sd-mirror-dialog-desc">{{ t('newSettings.mirrorSourceDesc') }}</span>
        <div class="sd-btn-group">
          <button
            v-if="canRestoreDefaults"
            type="button"
            class="sd-btn sd-btn-ghost"
            @click="handleRestoreMirrors"
          >
            {{ t('newSettings.mirrorRestoreDefaults') }}
          </button>
          <button
            type="button"
            class="sd-btn sd-btn-ghost"
            :disabled="mirrorProbing"
            @click="handleProbeMirrors"
          >
            {{ mirrorProbing ? t('newSettings.mirrorProbing') : t('newSettings.mirrorProbe') }}
          </button>
        </div>
      </div>

      <div class="sd-mirror-list" role="radiogroup" :aria-label="t('newSettings.mirrorSource')">
        <div
          v-for="s in mirrorSources"
          :key="s.value"
          class="sd-mirror-item"
          :class="{ active: mirrorSelected === s.value }"
          @click="handleMirrorRowClick($event, s.value)"
        >
          <label class="sd-mirror-pick">
            <input
              class="lt-sr-only"
              type="radio"
              name="sd-mirror"
              :value="s.value"
              :checked="mirrorSelected === s.value"
              @change="mirrorSelect(s.value)"
            />
            <span class="sd-mirror-radio" aria-hidden="true"></span>
            <span class="sd-mirror-name" :title="s.label || t('newSettings.mirrorOfficial')">
              <span class="sd-mirror-name-text">{{
                s.label || t('newSettings.mirrorOfficial')
              }}</span>
              <span v-if="s.custom" class="sd-mirror-tag">{{ t('newSettings.mirrorCustom') }}</span>
            </span>
          </label>
          <span class="sd-mirror-lat" :class="latencyClass(s.latency)">{{
            latencyText(s.latency)
          }}</span>
          <span v-if="mirrorSelected === s.value" class="sd-mirror-inuse">{{
            t('newSettings.mirrorInUse')
          }}</span>
          <button
            v-if="!s.official"
            type="button"
            class="sd-mirror-remove"
            :aria-label="t('newSettings.mirrorRemoveSource', { source: s.label || s.value })"
            :title="t('newSettings.mirrorRemoveSource', { source: s.label || s.value })"
            @click="handleRemoveMirror(s.value)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <form class="sd-mirror-add" @submit.prevent="handleAddMirror">
        <input
          v-model="mirrorInput"
          class="sd-mirror-input"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('newSettings.mirrorAddPlaceholder')"
          :aria-label="t('newSettings.mirrorAddLabel')"
          :aria-invalid="mirrorAddError ? 'true' : undefined"
          :aria-describedby="mirrorAddError ? 'sd-mirror-add-error' : 'sd-mirror-add-hint'"
          @input="mirrorAddError = ''"
        />
        <button type="submit" class="sd-btn sd-btn-primary" :disabled="!mirrorInput.trim()">
          {{ t('newSettings.mirrorAdd') }}
        </button>
      </form>
      <div v-if="mirrorAddError" id="sd-mirror-add-error" class="sd-mirror-error" role="alert">
        {{ mirrorAddError }}
      </div>
      <div v-else id="sd-mirror-add-hint" class="sd-mirror-add-hint">
        {{ t('newSettings.mirrorAddHint') }}
      </div>
    </div>
    <template #footer>
      <span class="sd-mirror-footer-hint">{{ t('newSettings.mirrorApplyHint') }}</span>
      <button type="button" class="sd-btn sd-btn-primary" @click="mirrorDialogVisible = false">
        {{ t('newSettings.mirrorDone') }}
      </button>
    </template>
  </CreamDialog>

  <!-- 确认弹窗 -->
  <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="380px">
    <div class="sd-confirm-body">
      <span class="sd-confirm-icon">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4" />
          <path d="M12 17.4h.01" />
        </svg>
      </span>
      <div class="sd-confirm-message">{{ cfmMessage }}</div>
    </div>
    <template #footer>
      <div class="sd-btn-group">
        <button class="sd-btn sd-btn-ghost" @click="resolveConfirm(false)">{{
          t('newCommon.cancel')
        }}</button>
        <button class="sd-btn sd-btn-primary" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</button>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * SettingsDialog — 全局设置弹窗（左侧分类导航 + 右侧设置面板）
 *
 * 分类：通用（自动运行/刷新间隔/默认服务方式/通知）、核心管理（版本检测、
 * 路径、下载与安装及加速源管理下级弹窗）、数据管理（清缓存/清日志）、
 * 安全（5.12 锁定密码）、关于（检查更新 5.11，入口由 UPDATE_CHECK_ENABLED 控制）。
 * 平台差异：Android 内核编译期内置，核心路径、快捷目录、镜像源与下载安装等
 * 桌面专属项一律隐藏；面板内确认操作统一使用 Promise 化内置确认弹窗替代原生 confirm。
 */
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/components/CreamDialog/index.vue'
import BackupDialog from './BackupDialog.vue'
import { useCreamToast } from '@/hooks/useCreamToast'
import { useCoreInstall } from '@/hooks/useCoreInstall'
import {
  useMirrorProbe,
  MIRROR_SOURCE_KEY,
  LATENCY_GOOD,
  LATENCY_BAD
} from '@/hooks/useMirrorProbe'
import { useEasyTierStore } from '@/store/modules/easytier'
import { clearAppCache } from '@/utils/cacheUtil'
import { clearAllLogs, deleteFileOrDir, downloadFile, listFiles, openPath } from '@/utils/fileUtil'
import { formatBytes } from '@/utils/easyTierUtil'
import { getAppVersion, getArch, getOsType, compareVersions } from '@/utils/sysUtil'
import { hashLockPassword } from '@/utils/lockUtil'
import { isAndroid } from '@/utils/platformUtil'
import { CORE_VERSION_OPTIONS, DEFAULT_CORE_VERSION } from '@/constants/kernelCompat'
import {
  CORE_PATH,
  getCoreDownloadUrl,
  getCoreFileName,
  MANAGER_REPO_URL,
  MANAGER_REPO_HOME
} from '@/constants/easytier'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { resourceDir, join } from '@tauri-apps/api/path'

const props = withDefaults(defineProps<{ modelValue: boolean; inline?: boolean }>(), {
  inline: false
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

// 内部可见态：与父组件 v-model 双向同步
const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
  // 关闭时丢弃未提交的密码输入（明文不在内存/界面残留）
  if (!v) {
    resetLockForm()
    // 下级加速源弹窗一并关闭，未提交的输入与错误提示不残留
    mirrorDialogVisible.value = false
    mirrorInput.value = ''
    mirrorAddError.value = ''
    // 备份与恢复同样作为下级弹窗，关闭设置时一并收起
    backupDialogVisible.value = false
  }
})

const store = useEasyTierStore()
const toast = useCreamToast()
const { installing: installingCore, installCore } = useCoreInstall()
const { t } = useI18n()
// Android：内核编译期内置（无独立安装包/路径概念）
const isAndroidPlatform = isAndroid()
// 桌面 Tauri 运行时：浏览器预览不扫描本地内核目录（withGlobalTauri 已关闭，统一用 isTauri()）
const isDesktopRuntime =
  !isAndroidPlatform &&
  (() => {
    try {
      return isTauriRuntime()
    } catch {
      return false
    }
  })()

// 确认弹窗（替代原生 confirm）：将面板内确认操作 Promise 化，
// resolveConfirm 返回用户选择；被其它方式关闭时按“取消”处理
const cfmVisible = ref(false)
const cfmTitle = ref('')
const cfmMessage = ref('')
let cfmResolve: ((val: boolean) => void) | null = null
const showConfirm = (title: string, message: string): Promise<boolean> => {
  cfmTitle.value = title
  cfmMessage.value = message
  cfmVisible.value = true
  return new Promise<boolean>((resolve) => {
    cfmResolve = resolve
  })
}
// 用户点击确认/取消按钮时结算 Promise
const resolveConfirm = (val: boolean) => {
  cfmVisible.value = false
  cfmResolve?.(val)
  cfmResolve = null
}
// 弹窗被遮罩等其它方式关闭时兜底按“取消”结算，避免 Promise 悬挂
watch(cfmVisible, (v) => {
  if (!v && cfmResolve) {
    cfmResolve(false)
    cfmResolve = null
  }
})

// Tab 导航
const activeTab = ref('general')
const tabs = [
  { key: 'general', label: t('newSettings.general') },
  { key: 'core', label: t('newSettings.coreMgmt') },
  { key: 'data', label: t('newSettings.dataMgmt') },
  { key: 'security', label: t('newSettings.security') },
  { key: 'about', label: t('newSettings.about') }
]

// 安全：锁定密码（5.12）——双输入显式提交（设置/修改/清除），失焦不再自动保存
// （store.lockPassword 仅存校验串 sha256$salt$hash，随 pinia persist 持久化，绝不落明文）
const lockPwdVisible = ref(false)
const lockPwdInput = ref('')
const lockPwdConfirm = ref('')
const lockPwdError = ref('')
const lockEditMode = ref(false)
const lockPwdInputRef = ref<HTMLInputElement | null>(null)
const LOCK_PWD_MIN_LENGTH = 6

// 重置为“未在编辑”状态并清空明文
const resetLockForm = () => {
  lockPwdInput.value = ''
  lockPwdConfirm.value = ''
  lockPwdError.value = ''
  lockPwdVisible.value = false
  lockEditMode.value = false
}

// 已设置密码时，点“修改密码”展开双输入
const startLockEdit = () => {
  resetLockForm()
  lockEditMode.value = true
  nextTick(() => lockPwdInputRef.value?.focus())
}

const cancelLockEdit = () => {
  resetLockForm()
}

// 显式提交：非空、至少 6 位、两次一致；错误就地展示并阻止写入
const commitLockPassword = () => {
  const pwd = lockPwdInput.value
  if (!pwd) {
    lockPwdError.value = t('newSettings.lockPasswordRequired')
    return
  }
  if (pwd.length < LOCK_PWD_MIN_LENGTH) {
    lockPwdError.value = t('newSettings.lockPasswordTooShort')
    return
  }
  if (pwd !== lockPwdConfirm.value) {
    lockPwdError.value = t('newSettings.lockPasswordMismatch')
    return
  }
  const wasSet = !!store.lockPassword
  store.lockPassword = hashLockPassword(pwd)
  toast.success(
    wasSet ? t('newSettings.lockPasswordChanged') : t('newSettings.lockPasswordSetSuccess')
  )
  resetLockForm()
}

// 清除需二次确认，避免误触解除保护
const handleClearLockPassword = async () => {
  if (
    !(await showConfirm(
      t('newSettings.lockPasswordClearTitle'),
      t('newSettings.lockPasswordClearConfirm')
    ))
  )
    return
  store.lockPassword = ''
  resetLockForm()
  toast.success(t('newSettings.lockPasswordCleared'))
}

// 关于：检查更新（5.11，版本基准用 getAppVersion() 权威值）
// 三态：有更新（版本号 + 前往下载）/ 已是最新 / 请求失败或空列表（错误提示，重试按钮复用检查按钮）
const UPDATE_CHECK_ENABLED = true

const checkingUpdate = ref(false)
const updateCheckError = ref(false)
const latestManagerVersion = ref('')
const hasManagerUpdate = computed(() => {
  if (
    updateCheckError.value ||
    !latestManagerVersion.value ||
    !appVersion.value ||
    appVersion.value === '...' ||
    appVersion.value === t('newSettings.unknown')
  )
    return false
  return compareVersions(latestManagerVersion.value, appVersion.value) > 0
})
const updateDesc = computed(() => {
  if (updateCheckError.value) return t('newSettings.checkUpdateFail')
  if (hasManagerUpdate.value)
    return t('newSettings.updateAvailable', { version: latestManagerVersion.value })
  if (latestManagerVersion.value) return t('newSettings.upToDateDesc')
  return t('newSettings.checkUpdateDesc')
})

const handleCheckUpdate = async () => {
  checkingUpdate.value = true
  updateCheckError.value = false
  try {
    const data = (await store.refreshManagerReleaseInfo(mirrorSelected.value)) as any[]
    // 空列表是接口异常，不能误报“已是最新”
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty release list')
    const latest = data.find((r) => !r.draft) || data[0]
    const latestVersion = latest?.tag_name || ''
    if (!latestVersion) throw new Error('missing tag_name')
    latestManagerVersion.value = latestVersion
    if (hasManagerUpdate.value) {
      toast.info(t('newSettings.updateAvailable', { version: latestManagerVersion.value }))
    } else {
      toast.success(t('newSettings.upToDate'))
    }
  } catch (e) {
    console.error('检查更新失败:', e)
    latestManagerVersion.value = ''
    updateCheckError.value = true
    toast.error(t('newSettings.checkUpdateFail'))
  } finally {
    checkingUpdate.value = false
  }
}

const handleOpenManagerReleases = async () => {
  // 浏览器预览没有 plugin-shell：直接用新标签页打开，避免静默失败
  if (!isTauriRuntime()) {
    window.open(MANAGER_REPO_URL, '_blank', 'noopener')
    return
  }
  try {
    await openUrl(MANAGER_REPO_URL)
  } catch (e) {
    console.error('打开下载页失败:', e)
  }
}

// 关于页数据
const appVersion = ref('...')
// 内核版本展示：优先用全局探测结果（规范化前原文），探测中显示占位
const coreVersion = computed(() => {
  if (store.coreVersionDetecting) return t('newCommon.checking')
  return store.coreVersionRaw || t('newSettings.notInstalled')
})

// Tab 导航键盘操作：Up/Down/Left/Right 循环，Home/End 跳首尾（UX-104）
const tabRefs = ref<HTMLButtonElement[]>([])
const navRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
const setTabRef = (el: unknown, idx: number) => {
  if (el) tabRefs.value[idx] = el as HTMLButtonElement
}
// 窄屏横向 tab：切换后把当前分类滚入可视区。
// 只滚动导航自身，避免 scrollIntoView 连带滚动弹窗或内容区等祖先容器。
const scrollActiveTabIntoView = () => {
  nextTick(() => {
    const nav = navRef.value
    const idx = tabs.findIndex((tab) => tab.key === activeTab.value)
    const item = tabRefs.value[idx]
    if (!nav || !item) return
    const navRect = nav.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    let left = nav.scrollLeft
    let top = nav.scrollTop
    if (itemRect.left < navRect.left) left += itemRect.left - navRect.left - 8
    else if (itemRect.right > navRect.right) left += itemRect.right - navRect.right + 8
    if (itemRect.top < navRect.top) top += itemRect.top - navRect.top - 8
    else if (itemRect.bottom > navRect.bottom) top += itemRect.bottom - navRect.bottom + 8
    if (left !== nav.scrollLeft || top !== nav.scrollTop) {
      nav.scrollTo({ left, top, behavior: 'smooth' })
    }
  })
}
const selectTab = (key: string) => {
  activeTab.value = key
  // 切换分类后内容区回到顶部，避免沿用上一个分类的滚动位置
  nextTick(() => contentRef.value?.scrollTo({ top: 0 }))
  scrollActiveTabIntoView()
}
const handleTabKeydown = (e: KeyboardEvent, idx: number) => {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  let next = idx
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1
  selectTab(tabs[next].key)
  nextTick(() => tabRefs.value[next]?.focus())
}

// 原生下拉/单选的 change 处理器（替代自定义 dropdown 的点击逻辑）
const handleAutoRunConfigSelect = (e: Event) => {
  handleAutoRunConfigChange((e.target as HTMLSelectElement).value)
}
const handleServiceMethodSelect = (e: Event) => {
  const val = (e.target as HTMLSelectElement).value
  store.setDefaultServiceInstallMethod(val === 'nssm' ? 'nssm' : 'official')
}
// 内核版本自定义下拉：原生 <select> 的弹层由系统绘制，无法跟随主题
const coreVerTriggerRef = ref<HTMLButtonElement | null>(null)
const coreVerMenuRef = ref<HTMLElement | null>(null)
const coreVerDropdownOpen = ref(false)
const coreVerHighlighted = ref(0)
const coreVerMenuStyle = ref<Record<string, string>>({})

const coreVerOptionLabel = (tag: string) => {
  const item = coreVerOptions.find((o) => o.tag_name === tag)
  if (!item) return tag
  const channel =
    item.channel === 'prerelease'
      ? t('newSettings.channelPrerelease')
      : t('newSettings.channelStable')
  const downloaded = downloadedCoreVersions.value.includes(tag)
    ? ` · ${t('newSettings.downloadedBadge')}`
    : ''
  const installed = tag === store.detectedCoreVersion ? ` · ${t('newSettings.installedBadge')}` : ''
  return `${tag} · ${channel}${downloaded}${installed}`
}

// 弹层 Teleport 到 body，用 fixed 坐标贴合触发器；空间不足时向上展开
const positionCoreVerMenu = () => {
  const trigger = coreVerTriggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const menuHeight = coreVerMenuRef.value?.offsetHeight || coreVerOptions.length * 32 + 10
  // WebView 在极端情况下可能报告 0 视口，回退到触发器尺寸避免负数宽度
  const viewportWidth = window.innerWidth || rect.width + 16
  const viewportHeight = window.innerHeight || rect.bottom + menuHeight + 8
  const openUp = viewportHeight - rect.bottom < menuHeight + 8 && rect.top > menuHeight + 8
  const width = Math.max(120, Math.min(rect.width, viewportWidth - 16))
  coreVerMenuStyle.value = {
    left: `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`,
    width: `${width}px`,
    ...(openUp ? { bottom: `${viewportHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` })
  }
}

const focusCoreVerOption = (idx: number) => {
  const options = coreVerMenuRef.value?.querySelectorAll<HTMLElement>('[role="option"]')
  if (!options?.length) return
  const next = ((idx % options.length) + options.length) % options.length
  coreVerHighlighted.value = next
  options[next].focus()
}

const openCoreVerDropdown = async (direction = 0) => {
  if (downloadingCore.value) return
  coreVerDropdownOpen.value = true
  const selectedIdx = Math.max(
    0,
    coreVerOptions.findIndex((o) => o.tag_name === coreVerSelect.value)
  )
  coreVerHighlighted.value =
    direction === 0
      ? selectedIdx
      : (selectedIdx + direction + coreVerOptions.length) % coreVerOptions.length
  await nextTick()
  positionCoreVerMenu()
  focusCoreVerOption(coreVerHighlighted.value)
}

const closeCoreVerDropdown = (restoreFocus = false) => {
  if (!coreVerDropdownOpen.value) return
  coreVerDropdownOpen.value = false
  if (restoreFocus) nextTick(() => coreVerTriggerRef.value?.focus())
}

const toggleCoreVerDropdown = () => {
  if (coreVerDropdownOpen.value) closeCoreVerDropdown()
  else void openCoreVerDropdown()
}

const selectCoreVersion = (tag: string) => {
  coreVerSelect.value = tag
  closeCoreVerDropdown(true)
}

const handleCoreVerOutsideClick = (e: MouseEvent) => {
  if (!coreVerDropdownOpen.value) return
  const target = e.target as Node
  if (coreVerTriggerRef.value?.contains(target) || coreVerMenuRef.value?.contains(target)) return
  closeCoreVerDropdown()
}

// 内容区滚动或窗口尺寸变化时关闭，避免弹层与触发器分离
const handleCoreVerViewportChange = () => closeCoreVerDropdown()

onMounted(() => {
  document.addEventListener('click', handleCoreVerOutsideClick)
  window.addEventListener('resize', handleCoreVerViewportChange)
  window.addEventListener('scroll', handleCoreVerViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleCoreVerOutsideClick)
  window.removeEventListener('resize', handleCoreVerViewportChange)
  window.removeEventListener('scroll', handleCoreVerViewportChange, true)
})

// 数据管理状态
const clearingCache = ref(false)
const clearingLogs = ref(false)
const backupDialogVisible = ref(false)

// 核心管理状态
const checkingCore = ref(false)
const corePath = ref('')
// 可下载版本为固定列表（constants/kernelCompat.ts），默认选中最新正式版（需自行下载）
const coreVerOptions = CORE_VERSION_OPTIONS
const coreVerSelect = ref(DEFAULT_CORE_VERSION)
const downloadingCore = ref(false)
const deletingCore = ref(false)
// 是否已进入实际下载阶段（自动测速阶段不展示 0% 进度条）
const downloadActive = ref(false)
// 下载进度：total 为 null 表示服务端未返回 Content-Length（进度条转为不确定态）
const downloadReceived = ref(0)
const downloadTotal = ref<number | null>(null)
const downloadPercent = computed<number | null>(() => {
  if (!downloadTotal.value) return null
  return Math.min(
    100,
    Math.max(0, Math.round((downloadReceived.value / downloadTotal.value) * 100))
  )
})
const downloadProgressText = computed(() => {
  const total = downloadTotal.value
  if (downloadPercent.value === null || !total) {
    return t('newSettings.downloadProgressReceived', { size: formatBytes(downloadReceived.value) })
  }
  return t('newSettings.downloadProgressPercent', {
    percent: downloadPercent.value,
    received: formatBytes(downloadReceived.value),
    total: formatBytes(total)
  })
})
const coreFileName = ref('')
// 已下载的内核安装包版本（扫描 resource/core 下的 zip；安装后仍保留）
const downloadedCoreVersions = ref<string[]>([])
const isSelectedCoreDownloaded = computed(() =>
  downloadedCoreVersions.value.includes(coreVerSelect.value)
)
// 以本地 zip 实际存在为准：安装包不再内置，必须先下载
const selectedCoreReady = computed(() => isSelectedCoreDownloaded.value)
const corePackageStatusText = computed(() =>
  isSelectedCoreDownloaded.value
    ? t('newSettings.corePackageDownloaded')
    : t('newSettings.corePackageNotDownloaded')
)

// 扫描 core 目录，按当前平台/架构的压缩包名判断各版本下载状态
const refreshDownloadedCores = async () => {
  if (!isDesktopRuntime) return
  try {
    const files = new Set(await listFiles(CORE_PATH))
    downloadedCoreVersions.value = coreVerOptions
      .filter((o) => files.has(getCoreFileName(getOsType(), getArch(), o.tag_name)))
      .map((o) => o.tag_name)
  } catch (e) {
    console.error('扫描内核安装包失败:', e)
    downloadedCoreVersions.value = []
  }
}

// 切到内核页时重新扫描，外部新增/删除安装包也能及时反映
watch(activeTab, (tab) => {
  closeCoreVerDropdown()
  if (tab === 'core') void refreshDownloadedCores()
})

// 当前内核的适配档案说明：让用户确认切换后表单/命令会跟随版本变化
const compatProfileDesc = computed(() => {
  if (store.coreVersionDetecting) return t('newCommon.checking')
  const caps = store.coreCaps
  const version = store.detectedCoreVersion
  if (!version) return t('newSettings.compatUnknown')
  if (!caps) return t('newSettings.compatUnknown')
  if (!caps.known) return t('newSettings.compatOutOfRange', { version })
  return t('newSettings.compatKnown', {
    version,
    flags: caps.flags?.size ?? 0,
    strict: caps.flagsStrict ? t('newSettings.compatStrict') : ''
  })
})

// 5.10：加速源管理（下载安装区块的下级弹窗）
const {
  sources: mirrorSources,
  probing: mirrorProbing,
  selected: mirrorSelected,
  probeAll,
  probeSource,
  waitForProbe,
  selectSource: mirrorSelect,
  addSource: mirrorAddSource,
  removeSource: mirrorRemoveSource,
  canRestoreDefaults,
  restoreDefaults: mirrorRestoreDefaults
} = useMirrorProbe()

// 加速源弹窗：入口按钮展示当前选中的源名，新增输入与错误提示随弹窗关闭清空
const mirrorDialogVisible = ref(false)
const mirrorInput = ref('')
const mirrorAddError = ref('')
// 未指定加速源时的自动测速每个设置会话只尝试一次，失败后直接回退官方源
let autoMirrorProbeAttempted = false

const currentMirrorLabel = computed(() => {
  if (mirrorProbing.value) return t('newSettings.mirrorProbing')
  const current = mirrorSources.value.find((s) => s.value === mirrorSelected.value)
  return current
    ? current.label || t('newSettings.mirrorOfficial')
    : t('newSettings.mirrorOfficial')
})

// 下载按钮文案：自动测速阶段优先展示“测速中…”，避免误以为已在下载
const downloadBtnText = computed(() => {
  if (mirrorProbing.value) return t('newSettings.mirrorProbing')
  return downloadingCore.value ? t('newSettings.downloading') : t('newSettings.downloadCore')
})

const openMirrorDialog = () => {
  mirrorAddError.value = ''
  mirrorDialogVisible.value = true
  // 未指定加速源时，打开弹窗即自动测速并选用最快源；已显式选择则保留原选择
  if (!localStorage.getItem(MIRROR_SOURCE_KEY) && coreFileName.value && !autoMirrorProbeAttempted) {
    autoMirrorProbeAttempted = true
    void probeAll(coreVerSelect.value, coreFileName.value)
  }
}

// 测速全部镜像源（目标为所选版本的真实内核包），全部失败时给出提示
const handleProbeMirrors = async () => {
  if (!coreFileName.value) {
    toast.warning(t('newSettings.selectVersionFirst'))
    return
  }
  await probeAll(coreVerSelect.value, coreFileName.value)
  if (mirrorSources.value.every((s) => s.latency === null)) {
    toast.warning(t('newSettings.mirrorProbeFail'))
  }
}

// 新增自定义加速源：成功后自动选中并即时测速；不可达则回落到新增前的选择
const handleAddMirror = async () => {
  const previous = mirrorSelected.value
  const result = mirrorAddSource(mirrorInput.value)
  if (!result.ok) {
    mirrorAddError.value =
      result.reason === 'duplicate'
        ? t('newSettings.mirrorAddDuplicate')
        : t('newSettings.mirrorAddInvalid')
    return
  }
  mirrorInput.value = ''
  mirrorAddError.value = ''
  // 无版本目标或已有测速任务时跳过即时测速（未测不视为不可达）
  if (!coreFileName.value || mirrorProbing.value) return
  const latency = await probeSource(result.value, coreVerSelect.value, coreFileName.value)
  if (latency === null) {
    mirrorSelect(previous)
    toast.warning(t('newSettings.mirrorAddUnreachable'))
  }
}

// 删除加速源：内置源可通过“恢复内置源”找回，自定义源需重新添加
const handleRemoveMirror = (value: string) => {
  mirrorRemoveSource(value)
}

// 整行可点选（删除按钮除外），与旧版整行 label 的点击范围保持一致
const handleMirrorRowClick = (e: MouseEvent, value: string) => {
  if ((e.target as HTMLElement).closest('button')) return
  mirrorSelect(value)
}

// 恢复被删除的内置镜像（保留自定义源与已有测速结果）
const handleRestoreMirrors = () => {
  mirrorRestoreDefaults()
}

// 延迟展示：null 显示占位符，否则套用毫秒文案模板
const latencyText = (lat: number | null): string => {
  if (lat === null) return '—'
  return t('newSettings.mirrorLatencyMs', { ms: lat })
}

// 延迟着色：优/中/差三档（阈值常量来自 useMirrorProbe）
const latencyClass = (lat: number | null): string => {
  if (lat === null) return 'lat-unknown'
  if (lat < LATENCY_GOOD) return 'lat-good'
  if (lat >= LATENCY_BAD) return 'lat-bad'
  return 'lat-mid'
}

// 弹窗打开时：重置到通用 tab、恢复持久化的自动运行设置，并加载应用/内核版本信息
//（Android 版本取编译期内核；桌面走 easytier-cli 与资源目录）
watch(visible, async (v) => {
  if (v) {
    activeTab.value = 'general'
    autoMirrorProbeAttempted = false
    // 打开时让当前分类在窄屏横向 tab 中自动可见
    scrollActiveTabIntoView()
    syncRefreshInput()
    // 恢复持久化的自动运行设置
    const savedAutoRun = localStorage.getItem('settings.autoRunNetwork')
    if (savedAutoRun !== null) {
      store.setAutoRunNetworkSetting(savedAutoRun === 'true')
    }
    const savedConfigName = localStorage.getItem('settings.autoRunConfigName')
    if (savedConfigName) {
      store.setAutoRunConfigName(savedConfigName)
    }
    try {
      appVersion.value = await getAppVersion()
    } catch {
      appVersion.value = t('newSettings.unknown')
    }
    // 内核版本探测走全局 store：桌面 easytier-cli -V / Android 编译期内置版本
    try {
      await store.detectCoreVersion()
    } catch {
      /* 探测失败按未安装处理，表单保持宽松展示 */
    }
    if (isDesktopRuntime) {
      // 加载核心路径（仅桌面 Tauri；浏览器预览避免调用 plugin-os/path）
      try {
        corePath.value = await join(await resourceDir(), CORE_PATH)
      } catch {
        corePath.value = t('newSettings.unknown')
      }
      // 固定版本列表：已安装版本在列表内则默认选中它，否则回退最新正式版
      const installed = store.detectedCoreVersion
      const match = coreVerOptions.find((o) => o.tag_name === installed)
      coreVerSelect.value = match ? match.tag_name : DEFAULT_CORE_VERSION
      updateCoreFileName()
      await refreshDownloadedCores()
    }
  } else {
    closeCoreVerDropdown()
  }
})

// 刷新间隔：本地文本承接输入，失焦/回车校验 1–60 的整数后再写回 store；
// 非法输入保留原样并提示，不再逐键静默 clamp（UX-303）
const refreshInput = ref(String(store.refreshInterval || 3))
const refreshError = ref('')
const syncRefreshInput = () => {
  refreshInput.value = String(store.refreshInterval || 3)
  refreshError.value = ''
}
const commitRefreshInterval = () => {
  const raw = refreshInput.value.trim()
  const val = Number(raw)
  if (!raw || !Number.isInteger(val) || val < 1 || val > 60) {
    refreshError.value = t('newSettings.refreshIntervalInvalid')
    return
  }
  refreshError.value = ''
  store.setRefreshInterval(val)
  refreshInput.value = String(val)
}

// 自动运行设置：关闭开关时同步清除已选配置，并持久化到 localStorage
const handleAutoRunToggle = () => {
  localStorage.setItem('settings.autoRunNetwork', String(store.autoRunNetworkSetting))
  if (!store.autoRunNetworkSetting) {
    store.setAutoRunConfigName('')
    localStorage.removeItem('settings.autoRunConfigName')
  }
}

// 选择/清除自动运行的默认配置（空字符串表示“上次运行的配置”）
const handleAutoRunConfigChange = (val: string) => {
  store.setAutoRunConfigName(val)
  if (val) {
    localStorage.setItem('settings.autoRunConfigName', val)
  } else {
    localStorage.removeItem('settings.autoRunConfigName')
  }
}

// 清除临时缓存：仅清除 STUN/公共节点等可再取的远端缓存，保留配置、主题、语言、锁屏密码等
const handleClearCache = async () => {
  if (!(await showConfirm(t('newSettings.clearCacheTitle'), t('newSettings.clearCacheMsg')))) return
  clearingCache.value = true
  try {
    clearAppCache()
    // 同步清空内存副本，下一次使用时会自然重新拉取
    store.resetRemoteCache()
    toast.success(t('newSettings.cacheCleared'))
  } catch (e) {
    console.error('清除缓存失败:', e)
    toast.error(t('newCommon.loadFailed') + ': ' + String(e))
  } finally {
    clearingCache.value = false
  }
}

// 清除日志：删除应用日志与内核日志的历史分段，正在写入的当前日志保留
const handleClearLogs = async () => {
  if (!(await showConfirm(t('newSettings.clearLogsTitle'), t('newSettings.clearLogsMsg')))) return
  clearingLogs.value = true
  try {
    const result = await clearAllLogs()
    if (result.failed > 0) {
      toast.error(t('newSettings.logsClearPartial', { n: result.removed, m: result.failed }))
    } else if (result.removed > 0) {
      toast.success(t('newSettings.logsClearSuccess', { n: result.removed }))
    } else {
      toast.info(t('newSettings.logsClearNothing'))
    }
  } catch (e) {
    console.error('清除日志失败:', e)
    toast.error(t('newSettings.logsClearFail') + ': ' + String(e))
  } finally {
    clearingLogs.value = false
  }
}

// === 核心管理 ===
// 按当前所选版本拼出内核压缩包文件名（纯字符串拼接，避免 CSP 拦截 lodash.template 的 new Function）
const updateCoreFileName = () => {
  try {
    coreFileName.value = getCoreFileName(getOsType(), getArch(), coreVerSelect.value)
  } catch (e) {
    console.error('生成内核文件名失败:', e)
    coreFileName.value = ''
  }
}

// 版本切换后同步刷新下载文件名
watch(coreVerSelect, () => {
  updateCoreFileName()
})

// 手动重新检测内核版本（403 等异常值在 store 内统一视为未安装）
const handleCheckCore = async () => {
  checkingCore.value = true
  try {
    await store.detectCoreVersion()
  } finally {
    checkingCore.value = false
  }
}

// 打开内核所在目录（资源目录下的 CORE_PATH）
const handleOpenCorePath = async () => {
  try {
    const resDir = await resourceDir()
    await openPath(await join(resDir, CORE_PATH))
  } catch (e) {
    console.error(e)
  }
}

// 打开配置文件所在目录
const handleOpenConfigPath = async () => {
  try {
    const resDir = await resourceDir()
    await openPath(await join(resDir, 'config'))
  } catch (e) {
    console.error(e)
  }
}

// 下载所选版本内核安装包（优先镜像源加速，见 5.10）
const handleDownloadCore = async () => {
  if (!coreFileName.value) {
    toast.warning(t('newSettings.selectVersionFirst'))
    return
  }
  downloadingCore.value = true
  try {
    // 未指定加速源：先测速并自动选用最快源，再按该源下载
    if (
      !localStorage.getItem(MIRROR_SOURCE_KEY) &&
      coreFileName.value &&
      !autoMirrorProbeAttempted
    ) {
      autoMirrorProbeAttempted = true
      toast.info(t('newSettings.mirrorAutoSelecting'))
      await probeAll(coreVerSelect.value, coreFileName.value)
      await waitForProbe()
    }
    // 镜像前缀需要拼接完整 GitHub URL（官方源直链），与测速使用同一拼接规则
    const url = getCoreDownloadUrl(mirrorSelected.value, coreVerSelect.value, coreFileName.value)
    downloadReceived.value = 0
    downloadTotal.value = null
    downloadActive.value = true
    // 进度条已常驻展示，不再重复弹“正在下载”提示
    const ok = await downloadFile(url, (progress) => {
      downloadReceived.value = progress.received
      downloadTotal.value = progress.total
    })
    if (ok) {
      toast.success(t('newSettings.downloadSuccess'))
      // 安装包保留在 core 目录，立即刷新“已下载”状态
      await refreshDownloadedCores()
    } else {
      toast.error(t('newSettings.downloadFail'))
    }
  } catch (e) {
    console.error('下载失败:', e)
    toast.error(t('newSettings.downloadFailFull') + ': ' + String(e))
  } finally {
    downloadingCore.value = false
    downloadActive.value = false
  }
}

// 删除所选版本的本地安装包；已安装的内核文件与运行状态不受影响
const handleDeleteCorePackage = async () => {
  if (!isSelectedCoreDownloaded.value || !coreFileName.value) return
  const version = coreVerSelect.value
  if (
    !(await showConfirm(
      t('newSettings.deleteCorePackageTitle'),
      t('newSettings.deleteCorePackageMsg', { version })
    ))
  )
    return
  deletingCore.value = true
  try {
    await deleteFileOrDir(await join(CORE_PATH, coreFileName.value))
    await refreshDownloadedCores()
    toast.success(t('newSettings.deleteCorePackageSuccess', { version }))
  } catch (e) {
    console.error('删除内核安装包失败:', e)
    toast.error(t('newSettings.deleteCorePackageFail') + ': ' + String(e))
  } finally {
    deletingCore.value = false
  }
}

// 安装所选版本内核（切换前停止全部实例与服务，成功后重新检测版本）
const handleInstallCore = async () => {
  const target = coreVerSelect.value
  // 只有已下载的 zip 才能安装（按钮已禁用，这里兜底提示）
  if (!selectedCoreReady.value) {
    toast.warning(t('newSettings.corePackageNotDownloaded'))
    return
  }
  const runningCount = store.runningList.length
  const serviceHint = isAndroidPlatform ? '' : t('newSettings.installConfirmServiceHint')
  if (
    !(await showConfirm(
      t('newSettings.installConfirmTitle'),
      t('newSettings.installConfirmMsg', { version: target, count: runningCount, serviceHint })
    ))
  )
    return
  const ok = await installCore(target)
  if (ok) {
    toast.success(t('newSettings.installSuccess', { version: target }))
    // installCore 内部已重新探测；这里兜底刷新一次展示态
    await handleCheckCore()
    // 切换后恢复自动运行循环的停止标记，允许后续手动启动新实例
    store.setStopLoop(false)
  } else {
    toast.error(t('newSettings.installFail'))
  }
}
</script>

<style scoped>
.sd-body {
  display: flex;
  min-height: 0;
  overflow: hidden;
  flex: 1;
  gap: var(--theme-space-4);
}

/* 左侧导航：独立滚动，不随右侧内容滚动 */
.sd-nav {
  display: flex;
  width: 140px;
  min-height: 0;
  padding: var(--theme-space-3);
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex-shrink: 0;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.sd-nav::-webkit-scrollbar {
  width: 4px;
}

.sd-nav::-webkit-scrollbar-track {
  background: transparent;
}

.sd-nav::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.sd-nav-item {
  display: flex;
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-md, 10px);
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: var(--theme-space-2);
}

.sd-nav-item:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.sd-nav-item.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.sd-nav-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.7;
}

.sd-nav-item.active .sd-nav-icon {
  opacity: 1;
}

.sd-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧内容 */
.sd-content {
  min-width: 0;
  min-height: 0;
  padding: var(--theme-space-3) var(--theme-space-4) var(--theme-space-3) var(--theme-space-3);
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex: 1;
  overscroll-behavior: contain;
}

.sd-content::-webkit-scrollbar {
  width: 4px;
}

.sd-content::-webkit-scrollbar-track {
  background: transparent;
}

.sd-content::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.sd-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 设置行 */
.sd-row {
  display: flex;
  min-width: 0;
  padding: var(--theme-space-3) 0;
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
}

.sd-row:last-child {
  border-bottom: none;
}

.sd-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.sd-row-title {
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-primary, #4a3728);
}

.sd-row-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
  overflow-wrap: anywhere;
}

/* 加速源列表（5.10） */
.sd-mirror-list {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-2);
  padding: var(--theme-space-2) 0 var(--theme-space-3);
}

.sd-mirror-item {
  display: flex;
  padding: var(--theme-space-2) var(--theme-space-3);
  cursor: pointer;
  background: var(--theme-bg-tag, rgb(245 237 230 / 50%));
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 12px);
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: var(--theme-space-3);
}

.sd-mirror-pick {
  position: relative;
  display: flex;
  min-width: 0;
  cursor: pointer;
  align-items: center;
  gap: var(--theme-space-3);
  flex: 1;
}

.sd-mirror-item.active {
  border-color: var(--theme-color-success, #7fba8a);
}

/* 原生 radio 键盘聚焦：给自定义圆点画焦点环 */
.sd-mirror-item input:focus-visible + .sd-mirror-radio {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.sd-mirror-radio {
  width: 14px;
  height: 14px;
  border: 2px solid var(--theme-border, #e8ddd3);
  border-radius: 50%;
  flex-shrink: 0;
}

.sd-mirror-item.active .sd-mirror-radio {
  background: var(--theme-color-success, #7fba8a);
  border-color: var(--theme-color-success, #7fba8a);
  box-shadow: inset 0 0 0 2px var(--theme-bg-tag, #fff);
}

.sd-mirror-name {
  display: flex;
  min-width: 0;
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  align-items: center;
  gap: 6px;
  flex: 1;
}

.sd-mirror-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 自定义源标签：与内置镜像区分 */
.sd-mirror-tag {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #e8ddd3);
  border-radius: var(--theme-radius-pill, 100px);
  flex-shrink: 0;
}

.sd-mirror-lat {
  font-size: 12px;
  font-weight: 600;
}

.sd-mirror-lat.lat-good {
  color: var(--theme-color-success, #7fba8a);
}

.sd-mirror-lat.lat-bad {
  color: var(--theme-color-danger, #e8a0a0);
}

.sd-mirror-lat.lat-mid {
  color: var(--theme-color-warning, #e6a23c);
}

.sd-mirror-lat.lat-unknown {
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-mirror-inuse {
  font-size: 11px;
  color: var(--theme-color-success, #7fba8a);
  flex-shrink: 0;
}

/* 删除加速源：官方源不渲染，内置/自定义源可删 */
.sd-mirror-remove {
  display: flex;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm, 6px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sd-mirror-remove:hover {
  color: var(--theme-color-danger, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 8%));
}

.sd-mirror-remove:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 1px;
}

/* 加速源下级弹窗 */
.sd-mirror-dialog {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.sd-mirror-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
}

.sd-mirror-dialog-desc {
  min-width: 200px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
  flex: 1;
}

.sd-mirror-add {
  display: flex;
  margin-top: var(--theme-space-2);
  gap: var(--theme-space-2);
}

.sd-mirror-input {
  min-width: 0;
  padding: var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 10px);
  outline: none;
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
  flex: 1;
}

.sd-mirror-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-mirror-input[aria-invalid='true'] {
  border-color: var(--theme-color-danger, #e8a0a0);
}

.sd-mirror-error {
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-color-danger, #e8a0a0);
}

.sd-mirror-add-hint,
.sd-mirror-footer-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-mirror-footer-hint {
  min-width: 0;
  flex: 1;
}

/* 纯 CSS 开关 */
.sd-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
}

.sd-switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.sd-switch-slider {
  position: absolute;
  inset: 0;
  background: var(--theme-border, #ede4db);
  border-radius: 20px;
  transition: background-color var(--theme-duration) var(--theme-ease-out);
}

.sd-switch-slider::before {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--theme-text-white, #fff);
  border-radius: 50%;
  content: '';
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
  transition: transform var(--theme-duration) var(--theme-ease-out);
}

.sd-switch input:checked + .sd-switch-slider {
  background: var(--theme-color-success, #7fba8a);
}

.sd-switch input:focus-visible + .sd-switch-slider {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.sd-switch input:checked + .sd-switch-slider::before {
  transform: translateX(16px);
}

/* 数字输入 */
.sd-number {
  width: 72px;
  padding: var(--theme-space-1) var(--theme-space-2);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
  text-align: center;
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
  flex-shrink: 0;
}

.sd-number:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-number.invalid {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-number-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.sd-field-error {
  max-width: 200px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--theme-accent-primary, #e8a0a0);
  text-align: right;
}

/* 下拉选择 */
.sd-select {
  padding: var(--theme-space-1) var(--theme-space-6) var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  cursor: pointer;
  background: var(--theme-bg-tag, #f5ede6);
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237a6e5e' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-position: right 8px center;
  background-repeat: no-repeat;
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
  appearance: none;
  flex-shrink: 0;
}

.sd-select:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

/* 内核版本自定义下拉：需容纳版本号 + 渠道/已安装标记文本 */
.sd-core-version-select {
  max-width: 280px;
  min-width: 200px;
}

.sd-core-version-trigger {
  display: flex;
  width: 100%;
  color: var(--theme-text-primary, #4a3728);
  background-image: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-2);
}

.sd-core-version-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

/* 确认弹窗内容 */
.sd-confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-space-3);
  padding: var(--theme-space-3) 0 var(--theme-space-2);
  text-align: center;
}

.sd-confirm-icon {
  color: var(--theme-accent-primary, #e8a0a0);
}

.sd-confirm-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #8b7355);
}

/* 数据管理按钮 */
.sd-btn {
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: var(--theme-transition-interactive);
  flex-shrink: 0;
}

.sd-btn-danger {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.sd-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 8%, transparent);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.sd-btn-ghost {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-surface-secondary, #f5ede4);
  border-color: var(--theme-border, #e8ddd3);
}

.sd-btn-ghost:hover:not(:disabled) {
  background: var(--theme-surface-hover, #efe5d9);
}

.sd-btn-primary {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.sd-btn-primary:hover:not(:disabled) {
  background: var(--theme-accent-hover, #c9955f);
}

.sd-btn-success {
  color: var(--theme-text-white, #fff);
  background: var(--theme-color-success, #7fba8a);
}

.sd-btn-success:hover:not(:disabled) {
  background: var(--theme-color-success-dark, #6aaa78);
}

.sd-btn-group {
  display: flex;
  gap: var(--theme-space-2);
  flex-shrink: 0;
}

/* 核心管理 */
.sd-core-ver-row {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-shrink: 0;
}

.sd-core-ver-tag {
  padding: 2px var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: nowrap;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-sm, 6px);
  align-self: center;
}

.sd-core-ver-tag.sd-core-ver-ok {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
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
  display: flex;
  max-width: 100%;
  padding: 3px 10px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-secondary, #8b7355);
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #e8ddd3);
  border-radius: var(--theme-radius-pill, 100px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: 6px;
}

.sd-mirror-open:hover {
  color: var(--theme-accent-primary, #d4a574);
  border-color: var(--theme-accent-primary, #d4a574);
}

.sd-mirror-open:focus-visible {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.sd-mirror-open-value {
  max-width: 190px;
  overflow: hidden;
  color: var(--theme-text-muted, #c8bdb2);
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
  color: var(--theme-text-muted, #c8bdb2);
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

/* 内核下载进度：轨道用卡片底色，填充跟随主题强调色；无总大小时走不确定态 */
.sd-download-progress {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.sd-download-progress-track {
  position: relative;
  flex: 1;
  height: 6px;
  overflow: hidden;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
}

.sd-download-progress-fill {
  height: 100%;
  background: var(--theme-accent-primary, #d4a574);
  border-radius: inherit;
  transition: width 0.12s linear;
}

.sd-download-progress-fill.is-indeterminate {
  width: 30%;
  animation: sd-download-indeterminate 1.1s ease-in-out infinite;
}

.sd-download-progress-text {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@keyframes sd-download-indeterminate {
  from {
    transform: translateX(-110%);
  }

  to {
    transform: translateX(370%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sd-download-progress-fill {
    transition: none;
  }

  .sd-download-progress-fill.is-indeterminate {
    width: 100%;
    opacity: 0.5;
    animation: none;
  }
}

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

/* 安全：锁定密码（5.12） */
.sd-security-card {
  display: flex;
  padding: var(--theme-space-4);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex-direction: column;
  gap: var(--theme-space-4);
}

.sd-security-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd-security-title {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

.sd-lock-status {
  padding: 2px var(--theme-space-2);
  font-size: 11px;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: nowrap;
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
}

.sd-lock-status.on {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

/* 双输入表单：新密码 / 确认密码两列对齐，按钮右对齐 */
.sd-lock-form {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.sd-lock-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--theme-space-3);
}

.sd-lock-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.sd-lock-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-lock-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--theme-space-2);
}

.sd-lock-input-bar {
  position: relative;
  display: flex;
  align-items: center;
}

.sd-lock-input {
  width: 100%;
  min-height: 34px;
  padding: var(--theme-space-2) 34px var(--theme-space-2) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--theme-duration-fast) var(--theme-ease-out);
}

/* 确认密码没有眼睛按钮，右侧留白收窄 */
.sd-lock-field > .sd-lock-input {
  padding-right: var(--theme-space-3);
}

/* WebView2/Edge 自带密码揭示按钮，会与自定义眼睛图标重复，隐藏之 */
.sd-lock-input::-ms-reveal,
.sd-lock-input::-ms-clear {
  display: none;
}

.sd-lock-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-lock-eye {
  position: absolute;
  top: 50%;
  right: 6px;
  display: flex;
  width: 22px;
  height: 22px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  transform: translateY(-50%);
  transition: var(--theme-transition-interactive);
  align-items: center;
  justify-content: center;
}

.sd-lock-eye:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

/* 移动端（含 Android 二级页面）：导航转为顶部横向滚动 tab，内容区占满全宽 */
@media (width <= 640px) {
  .sd-body {
    flex-direction: column;
    gap: var(--theme-space-3);
  }

  .sd-nav {
    width: auto;
    flex-direction: row;
    gap: var(--theme-space-1);
    padding: var(--theme-space-2);
    overflow: auto hidden;
    scrollbar-width: none;
    flex-shrink: 0;

    /* 左右渐隐提示可横向滚动 */
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 10px,
      #000 calc(100% - 10px),
      transparent 100%
    );
  }

  .sd-nav::-webkit-scrollbar {
    display: none;
  }

  .sd-nav-item {
    width: auto;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .sd-content {
    padding: var(--theme-space-3);
  }

  /* 行内控件过宽时允许换行，避免挤压描述文案 */
  .sd-row {
    flex-wrap: wrap;
  }

  /* 密码双输入在窄屏改为单列，避免字段被压缩 */
  .sd-lock-fields {
    grid-template-columns: 1fr;
  }
}
</style>
