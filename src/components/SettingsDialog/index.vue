<template>
  <CreamDialog v-model="visible" :title="t('newSettings.settings')" width="700px">
    <div class="sd-body">
      <!-- 左侧分类导航 -->
      <div class="sd-nav">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="sd-nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
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

      <!-- 右侧内容区 -->
      <div class="sd-content">
        <!-- 通用设置 -->
        <div v-if="activeTab === 'general'" class="sd-section">
          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.autoRun') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.autoRunDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input
                type="checkbox"
                v-model="store.autoRunNetworkSetting"
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
            <div class="sd-select-wrapper" ref="configDropdownRef">
              <button
                class="sd-select-trigger"
                ref="configTriggerRef"
                @click="configDropdownOpen = !configDropdownOpen"
              >
                <span>{{ store.autoRunConfigName || t('newSettings.lastRunConfig') }}</span>
                <svg
                  class="sd-select-arrow"
                  :class="{ open: configDropdownOpen }"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <Teleport to="body">
                <div
                  v-if="configDropdownOpen"
                  class="sd-select-dropdown sd-select-dropdown-fixed"
                  :style="configDropdownStyle"
                >
                  <div
                    class="sd-select-option"
                    :class="{ active: !store.autoRunConfigName }"
                    @click="(handleAutoRunConfigChange(''), (configDropdownOpen = false))"
                    >{{ t('newSettings.lastRunConfig') }}</div
                  >
                  <div
                    v-for="item in store.configList"
                    :key="item.configFileName"
                    class="sd-select-option"
                    :class="{ active: store.autoRunConfigName === item.configFileName }"
                    @click="
                      (handleAutoRunConfigChange(item.configFileName), (configDropdownOpen = false))
                    "
                    >{{ item.configFileName }}</div
                  >
                </div>
              </Teleport>
            </div>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.refreshInterval') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.refreshIntervalDesc') }}</span>
            </div>
            <input
              type="number"
              class="sd-number"
              :value="store.refreshInterval"
              @input="store.setRefreshInterval(clampNumber($event, 1, 60))"
              min="1"
              max="60"
              step="1"
            />
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.defaultServiceMethod') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.defaultServiceMethodDesc') }}</span>
            </div>
            <div class="sd-select-wrapper" ref="methodDropdownRef">
              <button
                class="sd-select-trigger"
                ref="methodTriggerRef"
                @click="methodDropdownOpen = !methodDropdownOpen"
              >
                <span>{{
                  store.defaultServiceInstallMethod === 'nssm'
                    ? 'NSSM'
                    : t('newWebConfig.officialCli')
                }}</span>
                <svg
                  class="sd-select-arrow"
                  :class="{ open: methodDropdownOpen }"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <Teleport to="body">
                <div
                  v-if="methodDropdownOpen"
                  class="sd-select-dropdown sd-select-dropdown-fixed"
                  :style="methodDropdownStyle"
                >
                  <div
                    class="sd-select-option"
                    :class="{ active: store.defaultServiceInstallMethod === 'nssm' }"
                    @click="
                      (store.setDefaultServiceInstallMethod('nssm'), (methodDropdownOpen = false))
                    "
                    >NSSM</div
                  >
                  <div
                    class="sd-select-option"
                    :class="{ active: store.defaultServiceInstallMethod === 'official' }"
                    @click="
                      (store.setDefaultServiceInstallMethod('official'),
                      (methodDropdownOpen = false))
                    "
                    >{{ t('newWebConfig.officialCli') }}</div
                  >
                </div>
              </Teleport>
            </div>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.defaultAutostart') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.defaultAutostartDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input type="checkbox" v-model="store.defaultEnableAutostart" />
              <span class="sd-switch-slider"></span>
            </label>
          </div>

          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.errorNotify') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.errorNotifyDesc') }}</span>
            </div>
            <label class="sd-switch">
              <input type="checkbox" v-model="store.errRunNotify" />
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
              <input type="checkbox" v-model="store.p2pNotifySetting" />
              <span class="sd-switch-slider"></span>
            </label>
          </div>
        </div>

        <!-- 核心管理 -->
        <div v-if="activeTab === 'core'" class="sd-section">
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
                v-if="!isAndroidPlatform"
                class="sd-btn sd-btn-ghost"
                @click="handleCheckCore"
                :disabled="checkingCore"
              >
                {{ checkingCore ? t('newCommon.checking') : t('newSettings.recheck') }}
              </button>
            </div>
          </div>

          <!-- 核心路径（Android 内核编译期内置，无独立路径） -->
          <div v-if="!isAndroidPlatform" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.corePath') }}</span>
              <span class="sd-row-desc sd-row-desc-mono">{{ corePath }}</span>
            </div>
          </div>

          <!-- 快捷操作 -->
          <div v-if="!isAndroidPlatform" class="sd-row">
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

          <!-- 5.10：加速源（镜像延迟测试） -->
          <div v-if="!isAndroidPlatform" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.mirrorSource') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.mirrorSourceDesc') }}</span>
            </div>
            <button
              class="sd-btn sd-btn-ghost"
              @click="handleProbeMirrors"
              :disabled="mirrorProbing"
            >
              {{ mirrorProbing ? t('newSettings.mirrorProbing') : t('newSettings.mirrorProbe') }}
            </button>
          </div>
          <div v-if="!isAndroidPlatform" class="sd-mirror-list">
            <div
              v-for="s in mirrorSources"
              :key="s.value"
              class="sd-mirror-item"
              :class="{ active: mirrorSelected === s.value }"
              @click="mirrorSelect(s.value)"
            >
              <span class="sd-mirror-radio"></span>
              <span class="sd-mirror-name">{{ s.label || t('newSettings.mirrorOfficial') }}</span>
              <span class="sd-mirror-lat" :class="latencyClass(s.latency)">{{
                latencyText(s.latency)
              }}</span>
              <span v-if="mirrorSelected === s.value" class="sd-mirror-inuse">{{
                t('newSettings.mirrorInUse')
              }}</span>
            </div>
          </div>

          <!-- 下载与安装（桌面换内核版本；Android 内核随应用更新） -->
          <div v-if="!isAndroidPlatform" class="sd-core-install">
            <div class="sd-core-install-title">{{ t('newSettings.downloadInstall') }}</div>
            <div class="sd-core-install-hint">
              {{ t('newSettings.downloadInstallHint') }}
            </div>
            <div class="sd-core-install-actions">
              <div class="sd-select-wrapper" ref="versionDropdownRef">
                <button
                  class="sd-select-trigger"
                  ref="versionTriggerRef"
                  @click="versionDropdownOpen = !versionDropdownOpen"
                >
                  <span>{{ coreVerSelect }}</span>
                  <svg
                    class="sd-select-arrow"
                    :class="{ open: versionDropdownOpen }"
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path
                      d="M3 4.5L6 7.5L9 4.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
                <Teleport to="body">
                  <div
                    v-if="versionDropdownOpen"
                    class="sd-select-dropdown sd-select-dropdown-fixed"
                    :style="dropdownStyle"
                  >
                    <div
                      v-for="item in coreVerOptions"
                      :key="item.tag_name"
                      class="sd-select-option"
                      :class="{ active: coreVerSelect === item.tag_name }"
                      @click="((coreVerSelect = item.tag_name), (versionDropdownOpen = false))"
                    >
                      {{ item.tag_name }}
                    </div>
                  </div>
                </Teleport>
              </div>
              <button
                class="sd-btn sd-btn-ghost"
                @click="handleRefreshVersions"
                :disabled="refreshingVersions"
              >
                {{
                  refreshingVersions
                    ? t('newSettings.refreshing')
                    : t('newSettings.refreshVersions')
                }}
              </button>
            </div>
            <div class="sd-core-install-actions">
              <button
                class="sd-btn sd-btn-primary"
                @click="handleDownloadCore"
                :disabled="downloadingCore"
              >
                {{ downloadingCore ? t('newSettings.downloading') : t('newSettings.downloadCore') }}
              </button>
              <button
                class="sd-btn sd-btn-success"
                @click="handleInstallCore"
                :disabled="installingCore"
              >
                {{ installingCore ? t('newCommon.installing') : t('newSettings.installCore') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 数据管理 -->
        <div v-if="activeTab === 'data'" class="sd-section">
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
        <div v-if="activeTab === 'security'" class="sd-section">
          <div class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.lockPassword') }}</span>
              <span class="sd-row-desc">{{ t('newSettings.lockPasswordDesc') }}</span>
            </div>
            <div class="sd-lock-wrap">
              <span class="sd-lock-status" :class="{ on: !!store.lockPassword }">
                {{
                  store.lockPassword
                    ? t('newSettings.lockPasswordEnabled')
                    : t('newSettings.lockPasswordDisabled')
                }}
              </span>
              <div class="sd-lock-input-bar">
                <input
                  class="sd-lock-input"
                  :type="lockPwdVisible ? 'text' : 'password'"
                  v-model="lockPwdInput"
                  :placeholder="t('newSettings.lockPasswordPlaceholder')"
                  maxlength="32"
                  @keyup.enter="commitLockPassword"
                  @blur="commitLockPassword"
                />
                <button
                  class="sd-lock-eye"
                  @click="lockPwdVisible = !lockPwdVisible"
                  :title="
                    lockPwdVisible ? t('newSettings.lockPwdHide') : t('newSettings.lockPwdShow')
                  "
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
              <button
                class="sd-btn sd-btn-danger"
                @click="handleClearLockPassword"
                :disabled="!store.lockPassword"
                >{{ t('newSettings.lockPasswordClear') }}</button
              >
            </div>
          </div>
        </div>

        <!-- 关于 -->
        <div v-if="activeTab === 'about'" class="sd-section">
          <div class="sd-about">
            <div class="sd-about-logo">L</div>
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
          <div class="sd-about-core">
            <span class="sd-about-core-label">{{ t('newSettings.coreVer') }}</span>
            <span class="sd-about-core-ver">{{ coreVersion }}</span>
          </div>

          <!-- 检查更新（5.11）：入口暂隐藏，GitHub 发布首个 Release 后开放（UPDATE_CHECK_ENABLED） -->
          <div v-if="UPDATE_CHECK_ENABLED" class="sd-row">
            <div class="sd-row-info">
              <span class="sd-row-title">{{ t('newSettings.checkUpdate') }}</span>
              <span class="sd-row-desc">{{ updateDesc }}</span>
            </div>
            <div class="sd-btn-group">
              <span
                v-if="latestManagerVersion"
                class="sd-core-ver-tag"
                :class="{ 'sd-core-ver-ok': hasManagerUpdate }"
                >{{ latestManagerVersion }}</span
              >
              <button
                v-if="hasManagerUpdate"
                class="sd-btn sd-btn-primary"
                @click="handleOpenManagerReleases"
                >{{ t('newSettings.goDownload') }}</button
              >
              <button
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
 * 路径、5.10 镜像源延迟测试、下载与安装）、数据管理（清缓存/清日志）、
 * 安全（5.12 锁定密码）、关于（检查更新 5.11，入口由 UPDATE_CHECK_ENABLED 控制）。
 * 平台差异：Android 内核编译期内置，核心路径、快捷目录、镜像源与下载安装等
 * 桌面专属项一律隐藏；面板内确认操作统一使用 Promise 化内置确认弹窗替代原生 confirm。
 */
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { useCreamToast } from '@/hooks/useCreamToast'
import { useCoreInstall } from '@/hooks/useCoreInstall'
import { useMirrorProbe, LATENCY_GOOD, LATENCY_BAD } from '@/hooks/useMirrorProbe'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useStorage } from '@/hooks/web/useStorage'
import { clearETLogs, clearLogs, downloadFile, openPath } from '@/utils/fileUtil'
import { getAppVersion, getArch, getOsType, compareVersions } from '@/utils/sysUtil'
import { hashLockPassword } from '@/utils/lockUtil'
import { runEasyTierCli } from '@/utils/shellUtil'
import * as coreApi from '@/utils/coreApi'
import { isAndroid } from '@/utils/platformUtil'
import {
  CORE_PATH,
  GITHUB_EASYTIER,
  GITHUB_DOWN_URL,
  EASYTIER_NAME,
  DEFAULT_VER_OPTIONS,
  BUILTIN_CORE_VERSION,
  MANAGER_REPO_URL,
  MANAGER_REPO_HOME
} from '@/constants/easytier'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { resourceDir, join } from '@tauri-apps/api/path'
import { template } from 'lodash-es'

const props = defineProps<{ modelValue: boolean }>()
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
  if (!v) lockPwdInput.value = ''
})

const store = useEasyTierStore()
const toast = useCreamToast()
const { installing: installingCore, installCore } = useCoreInstall()
const { t } = useI18n()
// Android：内核编译期内置（无独立安装包/路径概念）
const isAndroidPlatform = isAndroid()

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

// 安全：锁定密码（5.12）——输入为本地暂存，失焦/回车时加盐哈希后写入 store
// （store.lockPassword 仅存校验串 sha256$salt$hash，随 pinia persist 持久化，绝不落明文）
const lockPwdVisible = ref(false)
const lockPwdInput = ref('')
const commitLockPassword = () => {
  const pwd = lockPwdInput.value
  // 空输入不回写（解除保护需显式点“清除”，避免误清）
  if (!pwd) return
  store.lockPassword = hashLockPassword(pwd)
  lockPwdInput.value = ''
}
const handleClearLockPassword = () => {
  store.lockPassword = ''
  lockPwdInput.value = ''
  toast.success(t('newSettings.lockPasswordCleared'))
}

// 关于：检查更新（5.11，版本基准用 getAppVersion() 权威值）
// 开关：仓库地址已就绪（BeafJerky/LIghtTier），但 GitHub 上尚未发布 Release，
// releases 接口返回空列表会被下方逻辑判为检查失败，故入口暂时隐藏；
// 发布首个 Release 后改为 true 开放（请求与 UI 代码均已就绪）
const UPDATE_CHECK_ENABLED = false

const checkingUpdate = ref(false)
const latestManagerVersion = ref('')
const hasManagerUpdate = computed(() => {
  if (
    !latestManagerVersion.value ||
    !appVersion.value ||
    appVersion.value === '...' ||
    appVersion.value === t('newSettings.unknown')
  )
    return false
  return compareVersions(latestManagerVersion.value, appVersion.value) > 0
})
const updateDesc = computed(() => {
  if (hasManagerUpdate.value)
    return t('newSettings.updateAvailable', { version: latestManagerVersion.value })
  if (latestManagerVersion.value) return t('newSettings.upToDateDesc')
  return t('newSettings.checkUpdateDesc')
})

const handleCheckUpdate = async () => {
  checkingUpdate.value = true
  try {
    const data = (await store.refreshManagerReleaseInfo()) as any[]
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty release list')
    const latest = data.find((r) => !r.draft) || data[0]
    latestManagerVersion.value = latest.tag_name || ''
    if (hasManagerUpdate.value) {
      toast.info(t('newSettings.updateAvailable', { version: latestManagerVersion.value }))
    } else {
      toast.success(t('newSettings.upToDate'))
    }
  } catch (e) {
    console.error('检查更新失败:', e)
    toast.error(t('newSettings.checkUpdateFail'))
  } finally {
    checkingUpdate.value = false
  }
}

const handleOpenManagerReleases = async () => {
  try {
    await openUrl(MANAGER_REPO_URL)
  } catch (e) {
    console.error('打开下载页失败:', e)
  }
}

// 关于页数据
const appVersion = ref('...')
const coreVersion = ref(t('newCommon.checking'))

// 核心版本下拉：点击外部收起
const versionDropdownRef = ref<HTMLElement | null>(null)
const versionTriggerRef = ref<HTMLButtonElement | null>(null)
const versionDropdownOpen = ref(false)
onClickOutside(versionDropdownRef, () => {
  versionDropdownOpen.value = false
})

// 自动运行配置下拉：点击外部收起
const configDropdownRef = ref<HTMLElement | null>(null)
const configTriggerRef = ref<HTMLButtonElement | null>(null)
const configDropdownOpen = ref(false)
onClickOutside(configDropdownRef, () => {
  configDropdownOpen.value = false
})

// 默认服务方式下拉：点击外部收起
const methodDropdownRef = ref<HTMLElement | null>(null)
const methodTriggerRef = ref<HTMLButtonElement | null>(null)
const methodDropdownOpen = ref(false)
onClickOutside(methodDropdownRef, () => {
  methodDropdownOpen.value = false
})

// 下拉定位：面板 Teleport 到 body 后按触发按钮位置 fixed 定位
//（避免被弹窗内部滚动容器裁剪）
const dropdownStyle = computed(() => {
  if (!versionTriggerRef.value) return {}
  const rect = versionTriggerRef.value.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999
  }
})

// 自动运行配置下拉的定位样式
const configDropdownStyle = computed(() => {
  if (!configTriggerRef.value) return {}
  const rect = configTriggerRef.value.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999
  }
})

// 默认服务方式下拉的定位样式
const methodDropdownStyle = computed(() => {
  if (!methodTriggerRef.value) return {}
  const rect = methodTriggerRef.value.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999
  }
})

// 数据管理状态
const clearingCache = ref(false)
const clearingLogs = ref(false)

// 核心管理状态
const checkingCore = ref(false)
const corePath = ref('')
// 默认选中与安装包内置 core 压缩包版本一致（首次安装免下载）
const coreVerSelect = ref(BUILTIN_CORE_VERSION)
const coreVerOptions = ref<{ name: string; tag_name: string }[]>([...DEFAULT_VER_OPTIONS])
const refreshingVersions = ref(false)
const downloadingCore = ref(false)
const coreFileName = ref('')

// 5.10：镜像延迟测试
const {
  sources: mirrorSources,
  probing: mirrorProbing,
  selected: mirrorSelected,
  probeAll,
  selectSource: mirrorSelect
} = useMirrorProbe()

// 测速全部镜像源，全部失败时给出提示
const handleProbeMirrors = async () => {
  await probeAll()
  if (mirrorSources.value.every((s) => s.latency === null)) {
    toast.warning(t('newSettings.mirrorProbeFail'))
  }
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
    // Android：内核编译期内置，版本直接取内核编译版本；桌面：easytier-cli --version
    if (isAndroidPlatform) {
      try {
        const ver = await coreApi.getCoreVersion()
        coreVersion.value = ver ? `v${ver}` : t('newSettings.notInstalled')
      } catch {
        coreVersion.value = t('newSettings.notInstalled')
      }
    } else {
      try {
        const res = await runEasyTierCli(['--version'])
        coreVersion.value = String(res).trim() || t('newSettings.notInstalled')
      } catch {
        coreVersion.value = t('newSettings.notInstalled')
      }
      // 加载核心路径
      try {
        corePath.value = await join(await resourceDir(), CORE_PATH)
      } catch {
        corePath.value = t('newSettings.unknown')
      }
      // 初始化核心版本列表
      try {
        const data = (await store.getCoreReleaseInfo()) as any[]
        if (data && data.length > 0) {
          coreVerOptions.value = data
          coreVerSelect.value = data[0].tag_name
        }
      } catch {
        /* ignore */
      }
      updateCoreFileName()
    }
  }
})

// 工具函数：解析数字输入并夹取到 [min, max] 区间（非法输入回退 min）
const clampNumber = (e: Event, min: number, max: number): number => {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  if (isNaN(val)) return min
  return Math.max(min, Math.min(max, val))
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

// 清除缓存
const handleClearCache = async () => {
  if (!(await showConfirm(t('newSettings.clearCacheTitle'), t('newSettings.clearCacheMsg')))) return
  clearingCache.value = true
  try {
    const { clear } = useStorage('localStorage')
    clear()
    window.location.reload()
  } catch (e) {
    console.error('清除缓存失败:', e)
  } finally {
    clearingCache.value = false
  }
}

// 清除日志
const handleClearLogs = async () => {
  if (!(await showConfirm(t('newSettings.clearLogsTitle'), t('newSettings.clearLogsMsg')))) return
  clearingLogs.value = true
  try {
    await clearLogs()
    await clearETLogs('easytier')
    toast.success(t('newSettings.logsClearSuccess'))
  } catch (e) {
    console.error('清除日志失败:', e)
    toast.error(t('newSettings.logsClearFail') + ': ' + String(e))
  } finally {
    clearingLogs.value = false
  }
}

// === 核心管理 ===
// 按当前所选版本拼出内核压缩包文件名（模板 EASYTIER_NAME）
const updateCoreFileName = () => {
  try {
    const tpl = template(EASYTIER_NAME)
    // EASYTIER_NAME 以 '/' 开头，去掉前导斜杠，避免拼接 URL 时出现双斜杠（如 v2.5.0//easytier-...zip）
    coreFileName.value = tpl({
      osType: getOsType(),
      osArch: getArch(),
      version: coreVerSelect.value
    }).replace(/^\//, '')
  } catch {
    coreFileName.value = ''
  }
}

// 版本切换后同步刷新下载文件名
watch(coreVerSelect, () => {
  updateCoreFileName()
})

// 手动重新检测内核版本（cli -V；403 等异常值统一视为未安装）
const handleCheckCore = async () => {
  checkingCore.value = true
  try {
    const res = await runEasyTierCli(['-V'])
    coreVersion.value = res && res !== 403 ? String(res).trim() : t('newSettings.notInstalled')
  } catch {
    coreVersion.value = t('newSettings.notInstalled')
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

// 从远端刷新内核版本列表（成功后默认选中最新版）
const handleRefreshVersions = async () => {
  refreshingVersions.value = true
  try {
    const data = (await store.refreshCoreReleaseInfo()) as any[]
    if (data && data.length > 0) {
      coreVerOptions.value = data
      coreVerSelect.value = data[0].tag_name
      toast.success(t('newSettings.versionUpdated'))
    }
  } catch (e) {
    console.error('刷新版本列表失败:', e)
  } finally {
    refreshingVersions.value = false
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
    // 5.10 必改：优先走用户选择的镜像源（无选择时回退官方直链），并规范化尾部斜杠
    const mirrorSource = localStorage.getItem('mirror-source')
    const base = (mirrorSource || GITHUB_EASYTIER).replace(/\/+$/, '')
    const url = base + GITHUB_DOWN_URL + '/' + coreVerSelect.value + '/' + coreFileName.value
    toast.info(t('newSettings.downloadingHint'))
    const ok = await downloadFile(url)
    if (ok) {
      toast.success(t('newSettings.downloadSuccess'))
    } else {
      toast.error(t('newSettings.downloadFail'))
    }
  } catch (e) {
    console.error('下载失败:', e)
    toast.error(t('newSettings.downloadFailFull') + ': ' + String(e))
  } finally {
    downloadingCore.value = false
  }
}

// 安装所选版本内核（先确认，成功后重新检测版本）
const handleInstallCore = async () => {
  if (
    !(await showConfirm(t('newSettings.installConfirmTitle'), t('newSettings.installConfirmMsg')))
  )
    return
  const ok = await installCore(coreVerSelect.value)
  if (ok) {
    toast.success(t('newSettings.installSuccess'))
    // 重新检测版本
    await handleCheckCore()
  } else {
    toast.error(t('newSettings.installFail'))
  }
}
</script>

<style scoped>
.sd-body {
  display: flex;
  gap: var(--theme-space-4);
  min-height: 0;
  flex: 1;
}

/* 左侧导航 */
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
  transition: all 0.15s;
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
  align-items: center;
  justify-content: space-between;
  padding: var(--theme-space-3) 0;
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
  gap: var(--theme-space-3);
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
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-muted, #c8bdb2);
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
  transition: border-color 0.15s;
  align-items: center;
  gap: var(--theme-space-3);
}

.sd-mirror-item.active {
  border-color: var(--theme-color-success, #7fba8a);
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
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sd-mirror-lat {
  font-size: 11px;
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
  font-size: 10px;
  color: var(--theme-color-success, #7fba8a);
  flex-shrink: 0;
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
  transition: all 0.2s;
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
  transition: all 0.2s;
}

.sd-switch input:checked + .sd-switch-slider {
  background: var(--theme-color-success, #7fba8a);
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
  transition: border-color 0.15s;
  flex-shrink: 0;
}

.sd-number:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
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
  transition: border-color 0.15s;
  appearance: none;
  flex-shrink: 0;
}

.sd-select:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

/* 自定义下拉 */
.sd-select-wrapper {
  position: relative;
  flex-shrink: 0;
}

.sd-select-trigger {
  display: flex;
  min-width: 130px;
  padding: var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  cursor: pointer;
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: border-color 0.15s;
  align-items: center;
  gap: var(--theme-space-2);
}

.sd-select-trigger:hover {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-select-arrow {
  margin-left: auto;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.sd-select-arrow.open {
  transform: rotate(180deg);
}

.sd-select-dropdown {
  max-height: 160px;
  padding: var(--theme-space-1);
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-sm, 6px);
  box-shadow: var(--theme-shadow-sm, 0 4px 12px rgb(0 0 0 / 12%));
}

.sd-select-dropdown-fixed {
  position: fixed !important;
}

.sd-select-dropdown::-webkit-scrollbar {
  width: 5px;
}

.sd-select-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.sd-select-dropdown::-webkit-scrollbar-thumb {
  background: var(--theme-border, #ede4db);
  border-radius: 10px;
}

.sd-select-option {
  padding: var(--theme-space-2) var(--theme-space-3);
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.12s;
}

.sd-select-option:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.sd-select-option.active {
  font-weight: 500;
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
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
  transition: all 0.15s;
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
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-sm, 6px);
}

.sd-core-ver-tag.sd-core-ver-ok {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

.sd-row-desc-mono {
  font-family: var(--theme-font-body, 'Sora', monospace);
  font-size: 11px;
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

.sd-core-install-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.sd-core-install-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-core-install-actions {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
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
  display: flex;
  width: 44px;
  height: 44px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 20px;
  font-weight: 700;
  color: var(--theme-text-on-accent, #fff);
  background: linear-gradient(
    135deg,
    var(--theme-accent-primary, #e8a0a0),
    var(--theme-color-success, #7fba8a)
  );
  border-radius: var(--theme-radius-lg, 14px);
  align-items: center;
  justify-content: center;
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
  transition: all 0.15s;
  align-items: center;
  gap: var(--theme-space-2);
}

.sd-about-link:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.sd-about-core {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--theme-space-3) 0;
}

.sd-about-core-label {
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
}

.sd-about-core-ver {
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

/* 安全：锁定密码（5.12） */
.sd-lock-wrap {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-shrink: 0;
}

.sd-lock-status {
  padding: 2px var(--theme-space-3);
  font-size: 11px;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: nowrap;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-pill, 100px);
}

.sd-lock-status.on {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

.sd-lock-input-bar {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

.sd-lock-input {
  width: 140px;
  padding: var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-tag, #f5ede6);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  transition: border-color 0.15s;
}

.sd-lock-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.sd-lock-eye {
  display: flex;
  width: 26px;
  height: 26px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  transition: all 0.15s;
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
    width: 100%;
    flex-direction: row;
    gap: var(--theme-space-1);
    padding: var(--theme-space-2);
    overflow: auto hidden;
    scrollbar-width: none;
  }

  .sd-nav::-webkit-scrollbar {
    display: none;
  }

  .sd-nav-item {
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
}
</style>
